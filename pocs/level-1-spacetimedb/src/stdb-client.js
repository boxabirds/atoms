// SpacetimeDB client connection and reactive state sync.
// Subscribes to atom/connection/signal/arena_state tables and exposes
// reactive maps with prev/curr positions for interpolation.

import { DbConnection } from './module_bindings/index.ts';

// ── Constants ──────────────────────────────────────────────
const STDB_URI = `ws://${window.location.hostname || 'localhost'}:3000`;
const STDB_DATABASE = 'atoms-multi';
const AUTH_TOKEN_KEY = 'atoms_multi_token';
const TICK_INTERVAL_MS = 50; // 20Hz server ticks
const RECONNECT_DELAY_MS = 2000;

// ── Reactive state ─────────────────────────────────────────

/** @type {Map<bigint, AtomEntry>} */
export const atomEntries = new Map();

/** @type {Map<bigint, {id: bigint, fromAtomId: bigint, toAtomId: bigint, fromNodeIdx: number, toNodeIdx: number}>} */
export const connectionRows = new Map();

/** @type {Map<bigint, {id: bigint, fromAtomId: bigint, toAtomId: bigint, connectionId: bigint, progress: number}>} */
export const signalEntries = new Map();

let _connStatus = 'Connecting...';
let _frozen = true;
let _serverAtomCount = 0;
let _lastTickTime = performance.now();

export function getConnStatus() { return _connStatus; }
export function getServerFrozen() { return _frozen; }
export function getServerAtomCount() { return _serverAtomCount; }
export function getLastTickTime() { return _lastTickTime; }

/** @type {InstanceType<typeof DbConnection> | null} */
let conn = null;

// ── Change listeners ───────────────────────────────────────
let listeners = [];

export function subscribe(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

function notify() {
  for (const fn of listeners) fn();
}

// ── Connection ─────────────────────────────────────────────
export function connectToSTDB() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY) || undefined;

  conn = DbConnection.builder()
    .withUri(STDB_URI)
    .withDatabaseName(STDB_DATABASE)
    .withToken(token)
    .onConnect((connection, _identity, newToken) => {
      localStorage.setItem(AUTH_TOKEN_KEY, newToken);
      // Clear stale state from previous connection/session
      atomEntries.clear();
      connectionRows.clear();
      signalEntries.clear();
      _connStatus = 'Connected';
      notify();

      connection.subscriptionBuilder()
        .onApplied(() => { console.log('[STDB] Subscriptions active'); notify(); })
        .onError((_ctx, err) => console.error('[STDB] Sub error:', err))
        .subscribe([
          'SELECT * FROM atom',
          'SELECT * FROM connection',
          'SELECT * FROM arena_state',
          'SELECT * FROM signal',
        ]);
    })
    .onConnectError((_ctx, err) => {
      console.error('[STDB] Connect error:', err);
      _connStatus = 'Reconnecting...';
      notify();
      if (token) localStorage.removeItem(AUTH_TOKEN_KEY);
      setTimeout(() => connectToSTDB(), RECONNECT_DELAY_MS);
    })
    .onDisconnect(() => {
      _connStatus = 'Disconnected';
      notify();
      setTimeout(() => connectToSTDB(), RECONNECT_DELAY_MS);
    })
    .build();

  // ── Table callbacks ────────────────────────────────────────

  conn.db.atom.onInsert((_ctx, row) => {
    const snap = {
      x: row.x, y: row.y, z: row.z,
      rx: row.rx, ry: row.ry, rz: row.rz, rw: row.rw,
    };
    atomEntries.set(row.id, {
      id: row.id,
      atomType: row.atomType,
      prev: { ...snap },
      curr: { ...snap },
      signalCharge: row.signalCharge,
      holdOn: row.holdOn,
      flexElastic: row.flexElastic,
      relayMode: row.relayMode,
      lastFireTime: row.lastFireTime,
      pulsePhase: row.pulsePhase,
      spawnTime: performance.now(),
    });
    _serverAtomCount = atomEntries.size;
    notify();
  });

  conn.db.atom.onUpdate((_ctx, _old, row) => {
    const entry = atomEntries.get(row.id);
    if (!entry) return;
    // Shift curr → prev for interpolation
    Object.assign(entry.prev, entry.curr);
    entry.curr = {
      x: row.x, y: row.y, z: row.z,
      rx: row.rx, ry: row.ry, rz: row.rz, rw: row.rw,
    };
    entry.signalCharge = row.signalCharge;
    entry.holdOn = row.holdOn;
    entry.flexElastic = row.flexElastic;
    entry.relayMode = row.relayMode;
    entry.lastFireTime = row.lastFireTime;
    entry.pulsePhase = row.pulsePhase;
    _lastTickTime = performance.now();
  });

  conn.db.atom.onDelete((_ctx, row) => {
    atomEntries.delete(row.id);
    _serverAtomCount = atomEntries.size;
    notify();
  });

  conn.db.connection.onInsert((_ctx, row) => {
    connectionRows.set(row.id, {
      id: row.id,
      fromAtomId: row.fromAtomId,
      toAtomId: row.toAtomId,
      fromNodeIdx: row.fromNodeIdx,
      toNodeIdx: row.toNodeIdx,
    });
    notify();
  });

  conn.db.connection.onDelete((_ctx, row) => {
    connectionRows.delete(row.id);
    notify();
  });

  conn.db.signal.onInsert((_ctx, row) => {
    signalEntries.set(row.id, {
      id: row.id,
      fromAtomId: row.fromAtomId,
      toAtomId: row.toAtomId,
      connectionId: row.connectionId,
      progress: row.progress,
    });
    notify();
  });

  conn.db.signal.onUpdate((_ctx, _old, row) => {
    const entry = signalEntries.get(row.id);
    if (entry) entry.progress = row.progress;
  });

  conn.db.signal.onDelete((_ctx, row) => {
    signalEntries.delete(row.id);
    notify();
  });

  conn.db.arenaState.onInsert((_ctx, row) => {
    _frozen = row.frozen;
    notify();
  });

  conn.db.arenaState.onUpdate((_ctx, _old, row) => {
    _frozen = row.frozen;
    _serverAtomCount = Number(row.atomCount);
    notify();
  });
}

// ── Reducer calls ──────────────────────────────────────────

export function serverAddAtom(atomType, x, y, z) {
  conn?.reducers.addAtom({ atomType, x, y, z });
}

export function serverSpawnMachine(machineType, x, y, z) {
  conn?.reducers.spawnMachine({ machineType, x, y, z });
}

export function serverDragAtom(atomId, x, y, z) {
  conn?.reducers.dragAtom({ atomId, x, y, z });
}

export function serverRemoveAtom(atomId) {
  conn?.reducers.removeAtom({ atomId });
}

export function serverToggleFreeze() {
  conn?.reducers.toggleFreeze({});
}

export function serverClearArena() {
  conn?.reducers.clearArena({});
}

export function serverToggleRelayMode(atomId) {
  conn?.reducers.toggleRelayMode({ atomId });
}

export function serverToggleHold(atomId) {
  conn?.reducers.toggleHold({ atomId });
}

// ── Interpolation helper ───────────────────────────────────

/**
 * Returns interpolated position for an atom entry.
 * t = fraction through current tick (0..1, clamped)
 */
export function getInterpolatedPos(entry) {
  const elapsed = performance.now() - _lastTickTime;
  const t = Math.min(elapsed / TICK_INTERVAL_MS, 1.0);
  return {
    x: entry.prev.x + (entry.curr.x - entry.prev.x) * t,
    y: entry.prev.y + (entry.curr.y - entry.prev.y) * t,
    z: entry.prev.z + (entry.curr.z - entry.prev.z) * t,
  };
}

/**
 * Returns interpolated quaternion for an atom entry.
 * Simple lerp (not slerp) — fine for small per-tick rotations.
 */
export function getInterpolatedRot(entry) {
  const elapsed = performance.now() - _lastTickTime;
  const t = Math.min(elapsed / TICK_INTERVAL_MS, 1.0);
  return {
    rx: entry.prev.rx + (entry.curr.rx - entry.prev.rx) * t,
    ry: entry.prev.ry + (entry.curr.ry - entry.prev.ry) * t,
    rz: entry.prev.rz + (entry.curr.rz - entry.prev.rz) * t,
    rw: entry.prev.rw + (entry.curr.rw - entry.prev.rw) * t,
  };
}

// ── Exports for TICK_INTERVAL_MS ───────────────────────────
export { TICK_INTERVAL_MS };
