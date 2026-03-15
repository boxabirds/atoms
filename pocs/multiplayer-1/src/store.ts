// Reactive store for SpacetimeDB state
import { DbConnection } from './module_bindings';
import type { Atom, Connection as ConnRow, ArenaState, Signal } from './module_bindings/types';
import { STDB_URI, STDB_DATABASE, AUTH_TOKEN_KEY, TICK_INTERVAL_MS } from './constants';

// --- Types ---
export interface AtomEntry {
  id: bigint;
  atomType: string;
  prev: { x: number; y: number; z: number; rx: number; ry: number; rz: number; rw: number };
  curr: { x: number; y: number; z: number; rx: number; ry: number; rz: number; rw: number };
  signalCharge: number;
  holdOn: boolean;
  flexElastic: boolean;
  relayMode: string;
  spawnTime: number;
}

export interface SignalEntry {
  id: bigint;
  fromAtomId: bigint;
  toAtomId: bigint;
  connectionId: bigint;
  progress: number;
}

// --- State ---
export const atomEntries = new Map<bigint, AtomEntry>();
export const connectionRows = new Map<bigint, ConnRow>();
export const signalEntries = new Map<bigint, SignalEntry>();
export let frozen = true;
export let atomCount = 0;
export let connStatus = 'Connecting...';
export let lastTickTime = performance.now();

let conn: InstanceType<typeof DbConnection> | null = null;
let listeners: Array<() => void> = [];

export function subscribe(fn: () => void) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

function notify() {
  for (const fn of listeners) fn();
}

// --- SpacetimeDB connection ---
export function connectToSTDB() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY) || undefined;

  conn = DbConnection.builder()
    .withUri(STDB_URI)
    .withDatabaseName(STDB_DATABASE)
    .withToken(token)
    .onConnect((connection, _identity, newToken) => {
      localStorage.setItem(AUTH_TOKEN_KEY, newToken);
      connStatus = 'Connected';
      notify();

      connection.subscriptionBuilder()
        .onApplied(() => { console.log('Subscriptions active'); notify(); })
        .onError((_ctx: unknown, err: unknown) => console.error('Sub error:', err))
        .subscribe([
          'SELECT * FROM atom',
          'SELECT * FROM connection',
          'SELECT * FROM arena_state',
          'SELECT * FROM signal',
        ]);
    })
    .onConnectError((_ctx: unknown, err: unknown) => {
      console.error('Connect error:', err);
      connStatus = 'Reconnecting...';
      notify();
      if (token) localStorage.removeItem(AUTH_TOKEN_KEY);
      setTimeout(() => connectToSTDB(), 2000);
    })
    .onDisconnect(() => {
      connStatus = 'Disconnected';
      notify();
      setTimeout(() => connectToSTDB(), 2000);
    })
    .build();

  // Table callbacks
  conn.db.atom.onInsert((_ctx: unknown, row: Atom) => {
    const snap = { x: row.x, y: row.y, z: row.z, rx: row.rx, ry: row.ry, rz: row.rz, rw: row.rw };
    atomEntries.set(row.id, {
      id: row.id, atomType: row.atomType,
      prev: { ...snap }, curr: { ...snap },
      signalCharge: row.signalCharge, holdOn: row.holdOn,
      flexElastic: row.flexElastic, relayMode: row.relayMode,
      spawnTime: performance.now(),
    });
    atomCount = atomEntries.size;
    notify();
  });

  conn.db.atom.onUpdate((_ctx: unknown, _old: Atom, row: Atom) => {
    const entry = atomEntries.get(row.id);
    if (!entry) return;
    Object.assign(entry.prev, entry.curr);
    entry.curr = { x: row.x, y: row.y, z: row.z, rx: row.rx, ry: row.ry, rz: row.rz, rw: row.rw };
    entry.atomType = row.atomType;
    entry.signalCharge = row.signalCharge;
    entry.holdOn = row.holdOn;
    entry.flexElastic = row.flexElastic;
    entry.relayMode = row.relayMode;
    lastTickTime = performance.now();
  });

  conn.db.atom.onDelete((_ctx: unknown, row: Atom) => {
    atomEntries.delete(row.id);
    atomCount = atomEntries.size;
    notify();
  });

  conn.db.connection.onInsert((_ctx: unknown, row: ConnRow) => {
    connectionRows.set(row.id, row);
    notify();
  });

  conn.db.connection.onDelete((_ctx: unknown, row: ConnRow) => {
    connectionRows.delete(row.id);
    notify();
  });

  conn.db.signal.onInsert((_ctx: unknown, row: Signal) => {
    signalEntries.set(row.id, {
      id: row.id, fromAtomId: row.fromAtomId, toAtomId: row.toAtomId,
      connectionId: row.connectionId, progress: row.progress,
    });
    notify();
  });

  conn.db.signal.onUpdate((_ctx: unknown, _old: Signal, row: Signal) => {
    const entry = signalEntries.get(row.id);
    if (entry) entry.progress = row.progress;
  });

  conn.db.signal.onDelete((_ctx: unknown, row: Signal) => {
    signalEntries.delete(row.id);
    notify();
  });

  conn.db.arenaState.onInsert((_ctx: unknown, row: ArenaState) => {
    frozen = row.frozen;
    notify();
  });

  conn.db.arenaState.onUpdate((_ctx: unknown, _old: ArenaState, row: ArenaState) => {
    frozen = row.frozen;
    atomCount = Number(row.atomCount);
    notify();
  });
}

// --- Reducer calls ---
export function addAtom(atomType: string, x: number, y: number, z: number) {
  conn?.reducers.addAtom({ atomType, x, y, z });
}

export function spawnMachine(machineType: string, x: number, y: number, z: number) {
  conn?.reducers.spawnMachine({ machineType, x, y, z });
}

export function dragAtom(atomId: bigint, x: number, y: number, z: number) {
  conn?.reducers.dragAtom({ atomId, x, y, z });
}

export function removeAtom(atomId: bigint) {
  conn?.reducers.removeAtom({ atomId });
}

export function toggleFreeze() {
  conn?.reducers.toggleFreeze({});
}

export function clearArena() {
  conn?.reducers.clearArena({});
}

export function toggleRelayMode(atomId: bigint) {
  conn?.reducers.toggleRelayMode({ atomId });
}

export function toggleHold(atomId: bigint) {
  conn?.reducers.toggleHold({ atomId });
}
