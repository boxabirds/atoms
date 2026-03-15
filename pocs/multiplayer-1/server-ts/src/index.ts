// Atoms multiplayer server — SpacetimeDB TypeScript module
// Physics from shared/physics.ts, machines from shared/machines.ts.

import spacetimedb from './schema';
import {
  scheduledReducerHolder, TickSchedule, MACHINE_BY_KEY,
  TICK_INTERVAL_MICROS, DT,
  GROUND_Y, ATOM_RADIUS,
  PULSE_FIRE_INTERVAL, PULSE_FORCE_STRENGTH, PULSE_RECOIL_FACTOR,
  PULSE_PHASE_JITTER, SENSE_DETECTION_RANGE, SENSE_CONE_ANGLE,
  SENSE_COOLDOWN, SIGNAL_SPEED, SIGNAL_CHARGE_DECAY,
  GROUND_KICK_THRESHOLD_OFFSET, GROUND_KICK_STRENGTH,
  stepPhysics, quatRotate, vecAngle, vecLen,
} from './schema';
import { t } from 'spacetimedb/server';
import { ScheduleAt } from 'spacetimedb';

export default spacetimedb;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Ctx = Parameters<Parameters<typeof spacetimedb.reducer>[1]>[0];
type AtomRow = any;
type ConnRow = any;
type SignalRow = any;

// ---------------------------------------------------------------------------
// Atom insertion helper
// ---------------------------------------------------------------------------

function insertAtom(
  ctx: Ctx, atomType: string,
  x: number, y: number, z: number,
  phaseOffset?: number,
): AtomRow {
  const yClamped = Math.max(y, GROUND_Y + ATOM_RADIUS);
  const phase = phaseOffset ?? (x * 17.3 + z * 31.7) % (Math.PI * 2);

  const state = ctx.db.arenaState.id.find(0);
  const simTime = state ? Number(state.tickCount) * DT : 0;
  const lastFire = phaseOffset !== undefined
    ? simTime - (PULSE_FIRE_INTERVAL * (phaseOffset / (Math.PI * 2)))
    : simTime;

  return ctx.db.atom.insert({
    id: 0n,
    atomType,
    x, y: yClamped, z,
    vx: 0, vy: 0, vz: 0,
    rx: 0, ry: 0, rz: 0, rw: 1,
    avx: 0, avy: 0, avz: 0,
    grounded: false,
    signalCharge: 0,
    relayMode: 'pass',
    holdOn: false,
    flexElastic: false,
    lastFireTime: lastFire,
    pulsePhase: phase,
    senseCooldown: 0,
  });
}

function insertConnection(ctx: Ctx, fromId: bigint, toId: bigint, fromNode: number, toNode: number) {
  ctx.db.connection.insert({
    id: 0n,
    fromAtomId: fromId,
    toAtomId: toId,
    fromNodeIdx: fromNode,
    toNodeIdx: toNode,
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export const init = spacetimedb.init((ctx) => {
  ctx.db.tickSchedule.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.interval(TICK_INTERVAL_MICROS),
  });

  ctx.db.arenaState.insert({
    id: 0,
    frozen: false,
    tickCount: 0n,
    tickDurationUs: 0n,
    atomCount: 0,
  });

  console.log(`Atoms server initialized. Tick interval: ${TICK_INTERVAL_MICROS}us`);
});

// ---------------------------------------------------------------------------
// Tick — behavior system + shared physics
// ---------------------------------------------------------------------------

export const tick_physics = spacetimedb.reducer(
  { arg: TickSchedule.rowType },
  (ctx, { arg: _scheduleRow }) => {
    const state = ctx.db.arenaState.id.find(0);
    if (!state || state.frozen) return;

    const simTime = Number(state.tickCount) * DT;

    // ── Collect all state from DB ──────────────────────────────────
    const atoms: AtomRow[] = [...ctx.db.atom.iter()];
    const connections: ConnRow[] = [...ctx.db.connection.iter()];
    const signals: SignalRow[] = [...ctx.db.signal.iter()];

    if (atoms.length === 0) {
      ctx.db.arenaState.id.update({ ...state, tickCount: state.tickCount + 1n, atomCount: 0 });
      return;
    }

    // Build lookup structures
    const atomIdx = new Map<bigint, number>();
    for (let i = 0; i < atoms.length; i++) atomIdx.set(atoms[i].id, i);

    const atomConns = new Map<bigint, Array<{ connId: bigint; otherId: bigint }>>();
    for (const conn of connections) {
      if (!atomConns.has(conn.fromAtomId)) atomConns.set(conn.fromAtomId, []);
      if (!atomConns.has(conn.toAtomId)) atomConns.set(conn.toAtomId, []);
      atomConns.get(conn.fromAtomId)!.push({ connId: conn.id, otherId: conn.toAtomId });
      atomConns.get(conn.toAtomId)!.push({ connId: conn.id, otherId: conn.fromAtomId });
    }

    const connectedPairs = new Set<string>();
    for (const conn of connections) {
      connectedPairs.add(`${conn.fromAtomId},${conn.toAtomId}`);
      connectedPairs.add(`${conn.toAtomId},${conn.fromAtomId}`);
    }

    // ── Phase 1: Advance signals, collect deliveries ───────────────
    interface Impulse { atomId: bigint; fx: number; fy: number; fz: number }
    const impulses: Impulse[] = [];
    const newSignals: Array<{ from: bigint; to: bigint; connId: bigint }> = [];
    const signalsToDelete: bigint[] = [];
    const deliveries: Array<{ targetId: bigint; sourceId: bigint }> = [];

    for (const sig of signals) {
      sig.progress += DT * SIGNAL_SPEED;
      if (sig.progress >= 1.0) {
        signalsToDelete.push(sig.id);
        deliveries.push({ targetId: sig.toAtomId, sourceId: sig.fromAtomId });
      }
    }

    function hasSignalOnConn(fromId: bigint, connId: bigint): boolean {
      if (signals.some(s => s.connectionId === connId && s.fromAtomId === fromId)) return true;
      if (newSignals.some(ns => ns.connId === connId && ns.from === fromId)) return true;
      return false;
    }

    function firePulse(atom: AtomRow) {
      const atomId = atom.id;
      const [nx, ny, nz] = quatRotate(atom.rx, atom.ry, atom.rz, atom.rw, 0, 0, 1);
      const recoil = -PULSE_FORCE_STRENGTH * PULSE_RECOIL_FACTOR;
      impulses.push({ atomId, fx: nx * recoil, fy: ny * recoil, fz: nz * recoil });

      const conns = atomConns.get(atomId);
      if (conns) {
        for (const { connId, otherId } of conns) {
          let iy = ny * PULSE_FORCE_STRENGTH;
          if (atom.y < GROUND_Y + GROUND_KICK_THRESHOLD_OFFSET) {
            iy += GROUND_KICK_STRENGTH;
          }
          impulses.push({ atomId: otherId, fx: nx * PULSE_FORCE_STRENGTH, fy: iy, fz: nz * PULSE_FORCE_STRENGTH });
          if (!hasSignalOnConn(atomId, connId)) {
            newSignals.push({ from: atomId, to: otherId, connId });
          }
        }
      }
      atom.lastFireTime = simTime;
      atom.signalCharge = 1;
    }

    // ── Phase 2: Process signal deliveries ─────────────────────────
    for (const delivery of deliveries) {
      const idx = atomIdx.get(delivery.targetId);
      if (idx === undefined) continue;
      const target = atoms[idx];
      target.signalCharge = 1;

      switch (target.atomType) {
        case 'relay': {
          if (target.relayMode === 'block') break;
          const conns = atomConns.get(delivery.targetId);
          if (!conns) break;
          for (const { connId, otherId } of conns) {
            if (otherId === delivery.sourceId) continue;
            if (hasSignalOnConn(delivery.targetId, connId)) continue;
            newSignals.push({ from: delivery.targetId, to: otherId, connId });
          }
          break;
        }
        case 'hold': target.holdOn = !target.holdOn; break;
        case 'pulse': firePulse(target); break;
        case 'flex': target.flexElastic = !target.flexElastic; break;
      }
    }

    // ── Phase 3: PULSE autonomous fire ─────────────────────────────
    for (const atom of atoms) {
      if (atom.atomType !== 'pulse') continue;
      const interval = PULSE_FIRE_INTERVAL + Math.sin(atom.pulsePhase) * PULSE_PHASE_JITTER;
      if (simTime - atom.lastFireTime < interval) continue;
      firePulse(atom);
    }

    // ── Phase 4: SENSE autonomous detection ────────────────────────
    for (let i = 0; i < atoms.length; i++) {
      const atom = atoms[i];
      if (atom.atomType !== 'sense') continue;
      if (atom.senseCooldown > 0) { atom.senseCooldown -= DT; continue; }

      const [fx, fy, fz] = quatRotate(atom.rx, atom.ry, atom.rz, atom.rw, 0, 0, 1);
      let detected = false;
      for (let j = 0; j < atoms.length; j++) {
        if (i === j) continue;
        if (connectedPairs.has(`${atom.id},${atoms[j].id}`)) continue;
        const dx = atoms[j].x - atom.x;
        const dy = atoms[j].y - atom.y;
        const dz = atoms[j].z - atom.z;
        const dist = vecLen(dx, dy, dz);
        if (dist > SENSE_DETECTION_RANGE || dist < 0.001) continue;
        if (vecAngle(fx, fy, fz, dx, dy, dz) < SENSE_CONE_ANGLE) { detected = true; break; }
      }

      if (detected) {
        atom.signalCharge = 1;
        atom.senseCooldown = SENSE_COOLDOWN;
        const conns = atomConns.get(atom.id);
        if (conns) {
          for (const { connId, otherId } of conns) {
            if (!hasSignalOnConn(atom.id, connId)) {
              newSignals.push({ from: atom.id, to: otherId, connId });
            }
          }
        }
      }
    }

    // ── Phase 5: Signal charge decay ───────────────────────────────
    for (const atom of atoms) {
      if (atom.signalCharge > 0) {
        atom.signalCharge = Math.max(0, atom.signalCharge - DT * SIGNAL_CHARGE_DECAY);
      }
    }

    // ── Phase 6: Update signals in DB ──────────────────────────────
    for (const sigId of signalsToDelete) ctx.db.signal.id.delete(sigId);
    for (const sig of signals) {
      if (signalsToDelete.includes(sig.id)) continue;
      ctx.db.signal.id.update(sig);
    }
    for (const ns of newSignals) {
      ctx.db.signal.insert({ id: 0n, fromAtomId: ns.from, toAtomId: ns.to, connectionId: ns.connId, progress: 0 });
    }

    // ── Phase 7: Apply behavior impulses ───────────────────────────
    for (const imp of impulses) {
      const idx = atomIdx.get(imp.atomId);
      if (idx === undefined) continue;
      atoms[idx].vx += imp.fx;
      atoms[idx].vy += imp.fy;
      atoms[idx].vz += imp.fz;
    }

    // ── Phase 8-9: Physics (shared) ────────────────────────────────
    stepPhysics(
      atoms,
      connections.map(c => ({ fromId: c.fromAtomId, toId: c.toAtomId })),
      DT,
      atomIdx,
    );

    // ── Phase 10: Write back to DB ─────────────────────────────────
    for (const atom of atoms) ctx.db.atom.id.update(atom);

    ctx.db.arenaState.id.update({
      ...state,
      tickCount: state.tickCount + 1n,
      atomCount: atoms.length,
    });
  }
);

scheduledReducerHolder.ref = tick_physics;

// ---------------------------------------------------------------------------
// Reducers — user actions
// ---------------------------------------------------------------------------

export const add_atom = spacetimedb.reducer(
  { atomType: t.string(), x: t.f32(), y: t.f32(), z: t.f32() },
  (ctx, { atomType, x, y, z }) => { insertAtom(ctx, atomType, x, y, z); }
);

export const drag_atom = spacetimedb.reducer(
  { atomId: t.u64(), x: t.f32(), y: t.f32(), z: t.f32() },
  (ctx, { atomId, x, y, z }) => {
    const atom = ctx.db.atom.id.find(atomId);
    if (!atom) return;
    ctx.db.atom.id.update({ ...atom, x, y, z, vx: 0, vy: 0, vz: 0, avx: 0, avy: 0, avz: 0 });
  }
);

export const remove_atom = spacetimedb.reducer(
  { atomId: t.u64() },
  (ctx, { atomId }) => {
    for (const conn of ctx.db.connection.iter()) {
      if (conn.fromAtomId === atomId || conn.toAtomId === atomId) ctx.db.connection.id.delete(conn.id);
    }
    for (const sig of ctx.db.signal.iter()) {
      if (sig.fromAtomId === atomId || sig.toAtomId === atomId) ctx.db.signal.id.delete(sig.id);
    }
    ctx.db.atom.id.delete(atomId);
  }
);

export const toggle_freeze = spacetimedb.reducer({}, (ctx) => {
  const state = ctx.db.arenaState.id.find(0);
  if (!state) return;
  ctx.db.arenaState.id.update({ ...state, frozen: !state.frozen });
});

export const toggle_hold = spacetimedb.reducer(
  { atomId: t.u64() },
  (ctx, { atomId }) => {
    const atom = ctx.db.atom.id.find(atomId);
    if (!atom || atom.atomType !== 'hold') return;
    ctx.db.atom.id.update({ ...atom, holdOn: !atom.holdOn });
  }
);

export const toggle_relay_mode = spacetimedb.reducer(
  { atomId: t.u64() },
  (ctx, { atomId }) => {
    const atom = ctx.db.atom.id.find(atomId);
    if (!atom || atom.atomType !== 'relay') return;
    const nextMode = atom.relayMode === 'pass' ? 'invert'
      : atom.relayMode === 'invert' ? 'block' : 'pass';
    ctx.db.atom.id.update({ ...atom, relayMode: nextMode });
  }
);

export const spawn_machine = spacetimedb.reducer(
  { machineType: t.string(), x: t.f32(), y: t.f32(), z: t.f32() },
  (ctx, { machineType, x, y, z }) => {
    const machine = MACHINE_BY_KEY[machineType];
    if (!machine) { console.log(`Unknown machine type: ${machineType}`); return; }

    const ids: bigint[] = [];
    for (const def of machine.atoms) {
      const atom = insertAtom(ctx, def.type, x + def.offset[0], y + def.offset[1], z + def.offset[2], def.phaseOffset);
      ids.push(atom.id);
    }
    for (const [fromIdx, toIdx] of machine.autoConnect) {
      insertConnection(ctx, ids[fromIdx], ids[toIdx], 0, 0);
    }
  }
);

export const clear_arena = spacetimedb.reducer({}, (ctx) => {
  for (const atom of ctx.db.atom.iter()) ctx.db.atom.id.delete(atom.id);
  for (const conn of ctx.db.connection.iter()) ctx.db.connection.id.delete(conn.id);
  for (const sig of ctx.db.signal.iter()) ctx.db.signal.id.delete(sig.id);
});
