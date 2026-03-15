// Machine definitions — single source of truth.
// Used by: level-1, multiplayer-1 client, multiplayer-1 server.

export interface MachineAtomDef {
  type: string;
  offset: [number, number, number];
  phaseOffset?: number;
}

export interface MachineDef {
  name: string;
  desc: string;
  atoms: MachineAtomDef[];
  autoConnect: [number, number][];
}

export const MACHINES: MachineDef[] = [
  {
    name: 'Oscillator',
    desc: 'PULSE pushes through FLEX — watch it bounce rhythmically',
    atoms: [
      { type: 'pulse', offset: [0, 0, 0] },
      { type: 'flex',  offset: [0.55, 0, 0] },
      { type: 'flex',  offset: [-0.55, 0, 0] },
    ],
    autoConnect: [[0, 1], [0, 2]],
  },
  {
    name: 'Walker',
    desc: 'Alternating PULSEs on FLEX legs — lurches forward',
    atoms: [
      { type: 'flex',  offset: [0, 0.15, 0] },
      { type: 'pulse', offset: [0.35, -0.25, 0.2], phaseOffset: 0 },
      { type: 'pulse', offset: [-0.35, -0.25, 0.2], phaseOffset: Math.PI },
      { type: 'pulse', offset: [0.35, -0.25, -0.2], phaseOffset: Math.PI },
      { type: 'pulse', offset: [-0.35, -0.25, -0.2], phaseOffset: 0 },
      { type: 'flex',  offset: [0.35, 0.05, 0.2] },
      { type: 'flex',  offset: [-0.35, 0.05, 0.2] },
      { type: 'flex',  offset: [0.35, 0.05, -0.2] },
      { type: 'flex',  offset: [-0.35, 0.05, -0.2] },
    ],
    autoConnect: [[0, 5], [0, 6], [0, 7], [0, 8], [5, 1], [6, 2], [7, 3], [8, 4]],
  },
  {
    name: 'Tracker',
    desc: 'SENSE detects nearby atoms, RELAY routes signal, PULSE kicks toward them',
    atoms: [
      { type: 'sense', offset: [0, 0, 0.3] },
      { type: 'relay', offset: [0, 0, 0] },
      { type: 'pulse', offset: [0, 0, -0.3] },
      { type: 'flex',  offset: [0.45, -0.2, 0] },
      { type: 'flex',  offset: [-0.45, -0.2, 0] },
    ],
    autoConnect: [[0, 1], [1, 2], [1, 3], [1, 4]],
  },
  {
    name: 'Memory Toggle',
    desc: 'SENSE triggers HOLD — watch the nucleus snap on/off as things pass near',
    atoms: [
      { type: 'sense', offset: [0, 0, 0.3] },
      { type: 'relay', offset: [0, 0, 0] },
      { type: 'hold',  offset: [0, 0, -0.3] },
    ],
    autoConnect: [[0, 1], [1, 2]],
  },
  {
    name: 'Signal Chain',
    desc: 'PULSE fires through 3 RELAYs — watch the yellow dot travel link by link',
    atoms: [
      { type: 'pulse', offset: [-0.8, 0, 0] },
      { type: 'relay', offset: [-0.27, 0, 0] },
      { type: 'relay', offset: [0.27, 0, 0] },
      { type: 'relay', offset: [0.8, 0, 0] },
    ],
    autoConnect: [[0, 1], [1, 2], [2, 3]],
  },
  {
    name: 'Reflex Arc',
    desc: 'SENSE -> RELAY -> PULSE -> FLEX. Touch it and it kicks!',
    atoms: [
      { type: 'sense', offset: [0, 0, 0.55] },
      { type: 'relay', offset: [0, 0, 0] },
      { type: 'pulse', offset: [0, 0, -0.55] },
      { type: 'flex',  offset: [0, -0.4, -0.55] },
      { type: 'flex',  offset: [0.35, -0.3, 0] },
      { type: 'flex',  offset: [-0.35, -0.3, 0] },
    ],
    autoConnect: [[0, 1], [1, 2], [2, 3], [1, 4], [1, 5]],
  },
  {
    name: 'Crawler',
    desc: 'SENSE-driven PULSE chain on FLEX skeleton. Moves toward things it sees.',
    atoms: [
      { type: 'sense', offset: [0, 0.15, 0.7] },
      { type: 'relay', offset: [0, 0, 0.35] },
      { type: 'hold',  offset: [0, 0, 0] },
      { type: 'pulse', offset: [0.3, 0, -0.35], phaseOffset: 0 },
      { type: 'pulse', offset: [-0.3, 0, -0.35], phaseOffset: Math.PI },
      { type: 'flex',  offset: [0.5, -0.3, 0.2] },
      { type: 'flex',  offset: [-0.5, -0.3, 0.2] },
      { type: 'flex',  offset: [0.5, -0.3, -0.3] },
      { type: 'flex',  offset: [-0.5, -0.3, -0.3] },
    ],
    autoConnect: [[0, 1], [1, 2], [2, 3], [2, 4], [1, 5], [1, 6], [3, 7], [4, 8]],
  },
];

/** Lookup by kebab-cased key (oscillator, walker, etc.) */
export const MACHINE_BY_KEY: Record<string, MachineDef> = Object.fromEntries(
  MACHINES.map(m => [m.name.toLowerCase().replace(/\s+/g, '_'), m])
);
