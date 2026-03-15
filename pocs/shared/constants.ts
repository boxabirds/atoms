// Shared constants for atoms simulation — single source of truth.
// Extracted verbatim from level-1/index.html lines 344-447.
// Used by: level-1, multiplayer-1 client, multiplayer-1 server.

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export const BG_COLOR = 0x0a0a14;
export const FOG_NEAR = 15;
export const FOG_FAR = 60;

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

export const GROUND_SIZE = 40;
export const GROUND_DIVISIONS = 40;
export const GROUND_GRID_LINE_COLOR = '#4a4a8a';
export const GROUND_GRID_BG_COLOR = '#181838';
export const GROUND_Y = -2;

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export const CAMERA_FOV = 50;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 100;
export const CAMERA_INITIAL_POS = [3, 2.5, 5] as const;
export const ORBIT_DAMPING = 0.08;

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

export const AMBIENT_INTENSITY = 0.4;
export const HEMI_SKY = 0x4466aa;
export const HEMI_GROUND = 0x1a1a2e;
export const HEMI_INTENSITY = 0.5;

export const KEY_LIGHT_INTENSITY = 3.0;
export const KEY_LIGHT_POS = [4, 4, 5] as const;
export const KEY_LIGHT_COLOR = 0xfff4e0;
export const FILL_LIGHT_INTENSITY = 1.5;
export const FILL_LIGHT_POS = [-4, 2, 3] as const;
export const FILL_LIGHT_COLOR = 0xc0d0ff;
export const RIM_LIGHT_INTENSITY = 2.0;
export const RIM_LIGHT_POS = [0, 3, -6] as const;
export const RIM_LIGHT_COLOR = 0xffffff;

// ---------------------------------------------------------------------------
// Atom geometry
// ---------------------------------------------------------------------------

export const ATOM_RADIUS = 0.25;
export const ATOM_SEGMENTS = 28;
export const FLEX_RADIUS = 0.12;
export const FLEX_LENGTH = 0.6;
export const FLEX_CAP_SEGMENTS = 12;

// ---------------------------------------------------------------------------
// Connections & tendrils
// ---------------------------------------------------------------------------

export const SNAP_DISTANCE = 0.55;
export const SHOW_TENDRIL_DISTANCE = 1.2;
export const NODE_RADIUS = 0.045;
export const NODE_SEGMENTS = 10;
export const BRIDGE_RADIUS = 0.015;
export const BRIDGE_COLOR = 0x88ddff;
export const TENDRIL_COLOR = 0x44aadd;

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

export const GHOST_OPACITY = 0.35;
export const SNAP_DURATION_MS = 250;
export const SNAP_OVERSHOOT = 1.15;
export const BREATH_SPEED = 1.5;
export const BREATH_AMPLITUDE = 0.02;

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

export const GRAVITY = -9.8;
export const DAMPING = 0.95;
export const GROUND_BOUNCE = 0.3;
export const SPRING_K = 50;
export const REST_LENGTH_FACTOR = 2.2;
export const GROUND_FRICTION = 0.92;

export const COLLISION_REPULSION = 80;
export const ATOM_COLLISION_RADIUS = 0.24;
export const FLEX_COLLISION_RADIUS = 0.11;

export const ARENA_HALF = GROUND_SIZE * 0.5;
export const WALL_BOUNCE = 0.5;
export const VELOCITY_CAP = 8.0;
export const POSITION_CORRECTION = 0.4;

// ---------------------------------------------------------------------------
// Skin system — GPU marching cubes isosurface
// ---------------------------------------------------------------------------

export const SKIN_DEFAULT_OPACITY = 0.5;
export const SKIN_MIN_ATOMS = 2;
export const SKIN_SPHERE_INFLATE = 1.15;
export const MC_DIRTY_THRESHOLD = 0.001;
export const DEFAULT_PNG_DISPLACEMENT_SCALE = 0.3;
export const DISPLACEMENT_SCALE_MULTIPLIER = 5.0;
export const ENV_INTENSITY = 3.0;
export const TONE_MAP_EXPOSURE = 0.4;

export interface SkinEntry {
  name: string;
  index: number;
  type?: string;
  path?: string;
}

export const SKIN_REGISTRY: SkinEntry[] = [
  { name: 'none', index: 0 },
  { name: 'rusty-and-warped', index: 1, type: 'png', path: './skins/rusty-and-warped/' },
  { name: 'lumpy-translucent-gold', index: 2, type: 'json', path: './skins-json/lumpy-translucent-gold.shader.json' },
  { name: 'aquamarine-glass', index: 3, type: 'json', path: './skins-json/aquamarine-glass.json' },
  { name: 'flickering-flame', index: 4, type: 'json', path: './skins-json/flickering-flame.shader.json' },
  { name: 'rainbow-marshmallow', index: 5, type: 'json', path: './skins-json/rainbow-marshmallow.shader.json' },
  { name: 'william-slime', index: 6, type: 'json', path: './skins-json/william slime.json' },
  { name: 'xmas-decorations', index: 7, type: 'json', path: './skins-json/xmas decorations.json' },
];

export const SKIN_INDEX: Record<string, number> = Object.fromEntries(
  SKIN_REGISTRY.map(s => [s.name, s.index])
);
export const AVAILABLE_SKINS: string[] = SKIN_REGISTRY.map(s => s.name);

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

export const RAYCAST_THRESHOLD = 0.4;

// ---------------------------------------------------------------------------
// Behavior / signals
// ---------------------------------------------------------------------------

export const SIGNAL_SPEED = 4.0;
export const PULSE_FIRE_INTERVAL = 1.2;
export const PULSE_FORCE_STRENGTH = 1.5;
export const PULSE_RECOIL_FACTOR = 0.3;
export const PULSE_PHASE_JITTER = 0.2;
export const SENSE_DETECTION_RANGE = 2.0;
export const SENSE_CONE_ANGLE = Math.PI / 3; // 60°
export const SENSE_COOLDOWN = 0.5;
export const SIGNAL_DOT_RADIUS = 0.035;
export const SIGNAL_DOT_COLOR = 0xffee44;
export const SIGNAL_CHARGE_DECAY = 1.5;
export const KICK_VIS_DURATION = 0.3;
export const GROUND_KICK_THRESHOLD_OFFSET = ATOM_RADIUS * 3;
export const GROUND_KICK_STRENGTH = 0.4;

// ---------------------------------------------------------------------------
// Atom type definitions
// ---------------------------------------------------------------------------

export interface AtomDef {
  name: string;
  hint: string;
  color: number;
  emissive: number;
  emissiveIntensity: number;
  rgb: string;
}

export const ATOM_DEFS: Record<string, AtomDef> = {
  pulse: { name: 'PULSE', hint: 'Force',  color: 0xe8603c, emissive: 0xcc4422, emissiveIntensity: 0.3, rgb: '232,96,60' },
  sense: { name: 'SENSE', hint: 'Detect', color: 0x3498db, emissive: 0x2277bb, emissiveIntensity: 0.4, rgb: '52,152,219' },
  relay: { name: 'RELAY', hint: 'Logic',  color: 0xa8c744, emissive: 0x88aa22, emissiveIntensity: 0.25, rgb: '168,199,68' },
  hold:  { name: 'HOLD',  hint: 'Memory', color: 0x8844cc, emissive: 0x7733bb, emissiveIntensity: 0.35, rgb: '136,68,204' },
  flex:  { name: 'FLEX',  hint: 'Joint',  color: 0xc0c0c8, emissive: 0x888890, emissiveIntensity: 0.15, rgb: '192,192,200' },
};
