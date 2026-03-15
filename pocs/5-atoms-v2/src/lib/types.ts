import type RAPIER from '@dimforge/rapier3d-compat';
import type * as THREE from 'three';

// ---------------------------------------------------------------------------
// Atom kinds
// ---------------------------------------------------------------------------

export const ATOM_KINDS = ['shell', 'flex', 'push', 'sense', 'zap'] as const;
export type AtomKind = (typeof ATOM_KINDS)[number];

// ---------------------------------------------------------------------------
// Per-kind parameter interfaces
// ---------------------------------------------------------------------------

export type ShellShape = 'box' | 'sphere' | 'cylinder' | 'wedge' | 'plate';

export interface ShellParams {
  shape: ShellShape;
  size: number;       // 0.3 – 1.5
  density: number;    // 0.5 – 5.0
}

export interface FlexParams {
  dof: 1 | 2 | 3;        // 1=hinge, 2=universal, 3=ball
  stiffness: number;      // 0 – 100
  damping: number;        // 0 – 10
  angleLimit: number;     // radians, 0 – π
}

export type PushMode = 'continuous' | 'burst' | 'oscillating' | 'spin';

export interface PushParams {
  magnitude: number;      // 1 – 100
  mode: PushMode;
  direction: [number, number, number]; // local-space unit vector
  responsiveness: number; // 0 (instant) – 1 (slow ramp-up)
}

export type SenseDetection = 'proximity' | 'contact' | 'speed' | 'angle' | 'altitude' | 'light-level' | 'player-input';
export type SenseTrigger = 'continuous' | 'threshold' | 'toggle';

export interface SenseParams {
  range: number;          // 1 – 20
  detection: SenseDetection;
  triggerThreshold: number; // 0 – 1
  trigger: SenseTrigger;
}

export type ZapEffect = 'projectile' | 'grab' | 'push-field' | 'damage-zone' | 'heal' | 'emit-particles';
export type ZapShape = 'sphere' | 'cone' | 'beam' | 'targeted';

export interface ZapParams {
  effect: ZapEffect;
  range: number;          // 1 – 30
  intensity: number;      // 1 – 50
  cooldown: number;       // seconds between activations
  shape: ZapShape;
}

export type AtomParams = ShellParams | FlexParams | PushParams | SenseParams | ZapParams;

// ---------------------------------------------------------------------------
// Runtime atom instance
// ---------------------------------------------------------------------------

export interface AtomInstance {
  id: number;
  kind: AtomKind;
  params: AtomParams;
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  /** IDs of atoms this one is connected to */
  connections: number[];
  /** For Sense: currently detecting something */
  active: boolean;
  /** For Zap: cooldown timer */
  cooldownRemaining: number;
  /** For Push: oscillation phase */
  phase: number;
  /** For Flex: the Rapier joint handle */
  joint?: RAPIER.ImpulseJoint;
  /** For Flex: the two atom IDs it connects */
  bridgedAtoms?: [number, number];
  /** Selection outline mesh */
  outline?: THREE.Mesh;
}

// ---------------------------------------------------------------------------
// Connection record (for visual lines)
// ---------------------------------------------------------------------------

export interface ConnectionRecord {
  atomA: number;
  atomB: number;
  line: THREE.Line;
  isFlexJoint: boolean;
}

// ---------------------------------------------------------------------------
// Colors per atom kind
// ---------------------------------------------------------------------------

export const ATOM_COLORS: Record<AtomKind, number> = {
  shell: 0xd4a574,   // warm stone beige
  flex: 0x2dd4bf,    // teal
  push: 0xf97316,    // orange
  sense: 0x3b82f6,   // electric blue
  zap: 0xc084fc,     // purple/magenta
};

export const ATOM_EMISSIVE: Record<AtomKind, number> = {
  shell: 0x000000,
  flex: 0x0a3a30,
  push: 0x3a1800,
  sense: 0x0a1a3a,
  zap: 0x2a1a3a,
};

// ---------------------------------------------------------------------------
// Default params per kind
// ---------------------------------------------------------------------------

export const DEFAULT_PARAMS: Record<AtomKind, AtomParams> = {
  shell: { shape: 'box', size: 0.6, density: 2.0 } as ShellParams,
  flex: { dof: 1, stiffness: 30, damping: 2, angleLimit: Math.PI * 0.75 } as FlexParams,
  push: { magnitude: 15, mode: 'continuous', direction: [0, 0, -1], responsiveness: 0 } as PushParams,
  sense: { range: 8, detection: 'proximity', triggerThreshold: 0.3, trigger: 'continuous' } as SenseParams,
  zap: { effect: 'push-field', range: 6, intensity: 20, cooldown: 0.5, shape: 'sphere' } as ZapParams,
};

// ---------------------------------------------------------------------------
// Interaction modes
// ---------------------------------------------------------------------------

export type InteractionMode = 'place' | 'select' | 'connect';
