// Atoms v2 server — Schema
// Table definitions + re-exports from shared constants/machines/physics.

import { schema, table, t } from 'spacetimedb/server';
import type { ReducerExport } from 'spacetimedb/server';

// Re-export shared modules so index.ts has one import source
export * from '../../../shared/constants';
export { MACHINES, MACHINE_BY_KEY } from '../../../shared/machines';
export { stepPhysics, quatRotate, vecAngle, vecLen, getCollisionRadius } from '../../../shared/physics';

// Server-only constants
export const TICK_INTERVAL_MICROS = 50_000n; // 20Hz = 50ms
export const DT = 0.05; // 50ms tick

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const Atom = table(
  { name: 'atom', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    atomType: t.string(),
    x: t.f32(), y: t.f32(), z: t.f32(),
    vx: t.f32(), vy: t.f32(), vz: t.f32(),
    rx: t.f32(), ry: t.f32(), rz: t.f32(), rw: t.f32(),
    avx: t.f32(), avy: t.f32(), avz: t.f32(),
    grounded: t.bool(),
    signalCharge: t.f32(),
    relayMode: t.string(),
    holdOn: t.bool(),
    flexElastic: t.bool(),
    lastFireTime: t.f32(),
    pulsePhase: t.f32(),
    senseCooldown: t.f32(),
  }
);

export const Connection = table(
  { name: 'connection', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    fromAtomId: t.u64(),
    toAtomId: t.u64(),
    fromNodeIdx: t.u32(),
    toNodeIdx: t.u32(),
  }
);

export const Signal = table(
  { name: 'signal', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    fromAtomId: t.u64(),
    toAtomId: t.u64(),
    connectionId: t.u64(),
    progress: t.f32(),
  }
);

export const ArenaState = table(
  { name: 'arena_state', public: true },
  {
    id: t.u32().primaryKey(),
    frozen: t.bool(),
    tickCount: t.u64(),
    tickDurationUs: t.u64(),
    atomCount: t.u32(),
  }
);

export const scheduledReducerHolder: { ref: ReducerExport<any, any> | null } = {
  ref: null,
};

export const TickSchedule = table(
  {
    name: 'tick_schedule',
    scheduled: () => scheduledReducerHolder.ref!,
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

// ---------------------------------------------------------------------------
// Schema export
// ---------------------------------------------------------------------------

const spacetimedb = schema({
  atom: Atom,
  connection: Connection,
  signal: Signal,
  arenaState: ArenaState,
  tickSchedule: TickSchedule,
});

export default spacetimedb;
