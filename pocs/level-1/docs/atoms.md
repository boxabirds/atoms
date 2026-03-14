# Atoms System

A creature construction kit. Atoms are neurons/muscles/bones, connections are axons/tendons, and machines are pre-wired organisms.

## Atom Types

There are **5 atom types**, each with a distinct role:

| Type | Role |
|------|------|
| **PULSE** | Self-firing oscillator. Every ~1.2s it fires a force impulse along its nozzle direction, pushing connected atoms forward and recoiling itself backward. |
| **SENSE** | Detector. Spots non-connected atoms within a 60-degree cone at range 2.0, then fires a signal to its neighbors. |
| **RELAY** | Signal router. Forwards incoming signals to all connected atoms (except the sender). Can be toggled to pass/block/invert mode via double-click. |
| **HOLD** | Memory toggle. Each incoming signal flips its internal state on/off. |
| **FLEX** | Structural joint. A capsule with connection nodes at each end — the connective tissue between functional atoms. |

## Physics

Each frame, `updatePhysics(dt)` runs:

1. **O(n²) sphere collisions** — overlapping atoms repel with force 80
2. **Per-atom**: gravity (-9.8), velocity damping (×0.95), velocity cap (8.0)
3. **Spring constraints** on connections — spring constant 50, rest length ~2.2× atom radius (shorter for FLEX)
4. **Ground** at y=-2 with bounce (0.3) and friction (0.92)
5. **Arena walls** at ±20 with bounce (0.5)

### Key Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| ATOM_RADIUS | 0.25 | Regular atom size |
| FLEX_RADIUS | 0.12 | Joint radius |
| FLEX_LENGTH | 0.6 | Joint connector length |
| GRAVITY | -9.8 | Downward acceleration |
| DAMPING | 0.95 | Per-frame velocity decay |
| SPRING_K | 50 | Connection stiffness |
| REST_LENGTH_FACTOR | 2.2 | Rest length multiplier for springs |
| COLLISION_REPULSION | 80 | Repulsion between atoms |
| VELOCITY_CAP | 8.0 | Max speed |
| GROUND_Y | -2 | Ground plane level |
| GROUND_BOUNCE | 0.3 | Ground restitution |
| GROUND_FRICTION | 0.92 | Ground damping |
| WALL_BOUNCE | 0.5 | Wall restitution |
| ARENA_HALF | 20 | Arena half-size (±20 in X and Z) |

## Connections

Atoms have **nodes** — 6 cardinal directions for regular atoms, 2 ends for FLEX. When you drop an atom near another, `checkAndFormConnections` finds the closest unoccupied node pair within `SNAP_DISTANCE = 0.55` and creates a directed link.

Connections:
- Apply spring forces (structural)
- Carry signals (functional)
- Break if stretched beyond 2.5× snap distance
- Visualized as glowing cyan bridges

Connection data:
```
{
  fromAtomId, toAtomId,
  fromNodeIdx, toNodeIdx,   // which node on each atom
  bridgeMesh                // cyan cylinder visualization
}
```

## Signal System

The "nervous system" of the simulation:

- **PULSE** fires on a timer → emits a force impulse AND a signal to all connected atoms
- **Signals** travel along connections as yellow dots at speed 4.0 units/sec
- When a signal **arrives** at its target:
  - **RELAY**: forwards to all other neighbors
  - **HOLD**: toggles state
  - **PULSE**: fires immediately (enables cascading)
  - **FLEX**: toggles elasticity

### Signal Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| PULSE_FIRE_INTERVAL | 1.2 | Oscillation period (seconds) |
| PULSE_FORCE_STRENGTH | 1.5 | Push magnitude |
| GROUND_KICK_STRENGTH | 0.4 | Upward impulse when PULSE fires near ground |
| SENSE_DETECTION_RANGE | 2.0 | Detection radius |
| SENSE_CONE_ANGLE | π/3 | 60-degree detection cone |
| SENSE_COOLDOWN | 0.5 | Rate limit between detections (seconds) |
| SIGNAL_SPEED | 4.0 | Signal travel speed along connections |
| SIGNAL_CHARGE_DECAY | 1.5 | Visual glow decay rate |

### PULSE Ground Interaction

When a PULSE fires near the ground (within `GROUND_KICK_THRESHOLD = GROUND_Y + ATOM_RADIUS × 3`), connected atoms get an extra upward impulse. This enables hopping/walking behavior.

### RELAY Modes

RELAY atoms can be toggled (double-click) between:
- **pass** (yellow groove) — forward signals
- **invert** (magenta groove) — planned negation
- **block** (gray groove) — stop signals

## Molecules

A molecule is any **connected component** of 2+ atoms, found via BFS each frame (`findMolecules`). Minimum size for a skin mesh: `SKIN_MIN_ATOMS = 2`.

When molecules merge (atoms from two groups connect), the new molecule inherits the skin from the larger contributor.

## Machines (Prebuilt Creatures)

7 prefab machines built from the atom primitives:

| Machine | Atoms | What it does |
|---------|-------|-------------|
| **Oscillator** | 1 PULSE, 2 FLEX | Rhythmic pushing |
| **Walker** | 1 FLEX spine, 4 PULSE legs + hips | Walks via alternating impulses |
| **Tracker** | 1 SENSE, 1 RELAY, 1 PULSE, 2 FLEX | Detects and kicks toward target |
| **Memory Toggle** | 1 SENSE, 1 RELAY, 1 HOLD | Detection flips memory state |
| **Signal Chain** | 1 PULSE, 3 RELAYs | Signal cascade demo |
| **Reflex Arc** | 1 SENSE, 1 RELAY, 1 PULSE, 3 FLEX | Detect-then-kick reflex |
| **Crawler** | 1 SENSE, 1 RELAY, 1 HOLD, 2 PULSE, 4 FLEX | Full locomotion with sensing |

Machines are spawned via the UI. Each defines atom offsets and `autoConnect` pairs that wire up on spawn.

## Frozen State

Spacebar toggles `isFrozen` — pauses physics and signal propagation so you can build without things falling apart.
