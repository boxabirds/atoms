// Re-export shared constants as single source of truth.
// Client-only aliases and additions below.

export {
  GROUND_Y, GROUND_SIZE, ARENA_HALF,
  ATOM_RADIUS, FLEX_RADIUS, FLEX_LENGTH, BRIDGE_RADIUS,
  NODE_RADIUS, NODE_SEGMENTS, SHOW_TENDRIL_DISTANCE,
  SIGNAL_DOT_RADIUS, SENSE_DETECTION_RANGE,
  RAYCAST_THRESHOLD, GHOST_OPACITY,
  SNAP_DURATION_MS,
  ATOM_DEFS,
  // Skin system
  SKIN_DEFAULT_OPACITY, SKIN_MIN_ATOMS, SKIN_SPHERE_INFLATE,
  MC_DIRTY_THRESHOLD, DEFAULT_PNG_DISPLACEMENT_SCALE,
  DISPLACEMENT_SCALE_MULTIPLIER, ENV_INTENSITY, TONE_MAP_EXPOSURE,
  SKIN_REGISTRY, SKIN_INDEX, AVAILABLE_SKINS,
} from '../../shared/constants';

export type { AtomDef, SkinEntry } from '../../shared/constants';

export {
  MACHINES, MACHINE_BY_KEY,
} from '../../shared/machines';
export type { MachineDef, MachineAtomDef } from '../../shared/machines';

// Shared uses numeric hex for colors; client needs CSS strings in some places.
// Convert at the boundary rather than duplicating definitions.
function hexStr(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

import {
  BG_COLOR as BG_COLOR_NUM,
  TENDRIL_COLOR as TENDRIL_COLOR_NUM,
  SIGNAL_DOT_COLOR as SIGNAL_DOT_COLOR_NUM,
  BREATH_SPEED, BREATH_AMPLITUDE, KICK_VIS_DURATION,
  SENSE_CONE_ANGLE, SNAP_DURATION_MS as _SNAP_MS,
} from '../../shared/constants';

export const BG_COLOR = hexStr(BG_COLOR_NUM);
export const TENDRIL_COLOR = hexStr(TENDRIL_COLOR_NUM);
export const SIGNAL_DOT_COLOR = hexStr(SIGNAL_DOT_COLOR_NUM);

// Client aliases — match existing names used in App.tsx
export const BREATHING_SPEED = BREATH_SPEED;
export const BREATHING_AMPLITUDE = BREATH_AMPLITUDE;
export const KICK_DURATION = KICK_VIS_DURATION;
export const SNAP_DURATION = _SNAP_MS / 1000; // shared is ms, client uses seconds
export const SENSE_CONE_HALF_ANGLE = SENSE_CONE_ANGLE;
export const SIGNAL_CHARGE_GLOW_FACTOR = 1.5;

// Tick interval for interpolation
export const TICK_INTERVAL_MS = 50; // 20Hz server ticks

// Client-only interaction constants
export const CLICK_THRESHOLD = 5; // pixels — above this it's a drag not a click
export const TOAST_DURATION_MS = 1800;

// Machine defs for the UI palette (simplified from shared MACHINES)
import { MACHINES as MACHINES_FULL } from '../../shared/machines';
export const MACHINE_DEFS = MACHINES_FULL.map(m => ({
  name: m.name,
  key: m.name.toLowerCase().replace(/\s+/g, '_'),
  desc: m.desc,
  atoms: m.atoms.map(a => a.type),
}));

// SpacetimeDB connection
export const STDB_HOST = window.location.hostname || 'localhost';
export const STDB_URI = `ws://${STDB_HOST}:3000`;
export const STDB_DATABASE = 'atoms-multi';
export const AUTH_TOKEN_KEY = 'atoms_multi_token';
