# ATOM — Baseline Specification

## Vision

A 3D world-building game where a tiny set of atomic components snap together like spheres with joints. The elegance is in the simplicity — 5 building blocks, zero tutorials needed. The magic is in emergent behaviour: players build machines that walk, sense, decide, remember, and evolve.

Built for modern hardware (M2 Mac renders 200,000+ 3D shapes at 60fps). Real-time multiplayer collaboration via SpacetimeDB in shared environments called **Labs**.

---

## Architecture: Two Orders

### Order 1 — Atomic Blocks
Five fundamental building blocks. Mechanically complete (can express any motion) and computationally complete (can express any logic). A child can learn all five in five minutes.

### Order 2 — Learning System
Machines built from atoms collaborate, compete, and evolve. Complex systems emerge from simple rules. This layer sits on top of Order 1 and is out of scope for this document.

---

## The Five Atoms

### 1. PULSE — Energy Source
**Function:** Emits a linear force impulse when triggered, or free-runs at a configurable frequency. This is the muscle.

**Key design decisions:**
- Linear force only — rotation emerges from topology (two pulses offset on a rigid body = spin)
- Configurable parameters: impulse strength, frequency, trigger mode (free-run vs signal-activated)

**Visual identity:**
- **Shape:** Sphere
- **Colour:** Warm orange-red
- **Idle state:** Rhythmic breathing — gentle expand/contract cycle, never fully still
- **Active state:** Visible *kick* — fast expansion with a ring ripple emanating along the impulse direction
- **Directionality:** Subtle nozzle dimple on one side (like a reversed belly button) indicating thrust direction

**Design intent:** You look at it and think "this thing pushes."

---

### 2. SENSE — Detector
**Function:** Activates when a condition is met: contact, proximity threshold, or reading another atom's state. This is the nerve ending. Closes the loop between output and input — without closed loops there is no emergence.

**Key design decisions:**
- Tunable parameters: range, cone angle, trigger condition (contact / proximity / state-read)
- Proximity detection operates through space (field-based), enabling flocking and swarm behaviours without explicit wiring

**Visual identity:**
- **Shape:** Sphere
- **Colour:** Cool blue
- **Idle state:** Single iris-like aperture on the surface, contracted. Faint translucent detection cone projecting outward like a torch beam, with soft particle shimmer at the boundary
- **Active state:** Iris dilates. Cone brightens and flares. Subtle sweep/flicker animation on detection
- **Directionality:** The cone makes range and field-of-view immediately legible — you can see exactly what it's paying attention to

**Design intent:** You look at it and think "this thing watches."

---

### 3. RELAY — Logic Gate
**Function:** Passes, blocks, or inverts a signal depending on its input state. One relay is a NOT gate. Two relays wired together produce NAND — which is functionally complete (any logic circuit can be built from NAND). This is the synapse. It makes the system Turing-complete.

**Key design decisions:**
- Modes: pass, block, invert
- Signal routing is spatial — inputs and outputs are positional on the surface
- Signals propagate through structure (wired), complementing SENSE's field-based detection

**Visual identity:**
- **Shape:** Sphere
- **Colour:** Bright yellow-green
- **Key feature:** Visible groove/channel running across the surface from one connection point to another, like a gate valve
- **Passing state:** Channel glows. Visible energy trace flows through like current in a wire
- **Blocking state:** Channel dims. Small barrier appears at the midpoint — a visible shut gate
- **Inverted state:** Channel colour shifts to indicate inversion

**Design intent:** You look at it and think "stuff flows through this, or doesn't."

---

### 4. HOLD — State Memory
**Function:** Toggles between on/off when it receives a pulse. Retains state until toggled again. This is what separates reactive machines (sense → act) from sequential machines (sense → remember → act differently next time). Without it you can build reflex robots but not learning ones. This is the neuron.

**Key design decisions:**
- Binary toggle only — simplest possible memory primitive
- State persists indefinitely until explicitly toggled
- Readable by SENSE atoms (other atoms can detect whether a HOLD is on or off)

**Visual identity:**
- **Shape:** Sphere
- **Colour:** Deep violet
- **Key feature:** Translucent outer shell revealing an inner nucleus
- **Off state:** Dim dormant core inside the lantern-like shell
- **On state:** Bright glowing core — a satisfying *snap* transition (not a fade, a distinct click) with a brief flash
- **State legibility:** Binary nature is visually unambiguous — it's either lit or it isn't

**Design intent:** You look at it and think "this thing remembers."

---

### 5. FLEX — Structural Joint
**Function:** Structural connector with variable rigidity. Behaves as a rigid bone or an elastic spring — set at build time or toggled by signal. This is the skeleton. Two rigid flexes make a lever. A chain of elastic flexes makes a tentacle. Rigid lattices make frames.

**Key design decisions:**
- Deliberately breaks the sphere convention — its function IS shape and structure
- Rigidity can be toggled by incoming signal, enabling machines that change shape
- Connection points at each end
- Parameters: length, rigidity, damping

**Visual identity:**
- **Shape:** Elongated capsule (the only non-sphere, deliberately)
- **Colour:** Warm silver-white
- **Rigid state:** Brushed metal surface texture with sharp highlights
- **Elastic state:** Visible stretch lines appear, surface becomes slightly translucent and rubbery
- **Under load:** Visually deforms — you can see bending, compressing, stretching in real time
- **Connection points:** Soft glow at each end

**Design intent:** You look at it and think "this thing connects and bends."

---

## Cross-Cutting Visual Principles

### Shape is Behaviour, Colour is Role, Animation is State

This is the foundational design rule. If a six-year-old can't look at an atom and guess what it does, the visual language has failed.

### Connection Language
- Every atom has small magnetic-looking attachment nodes — subtle raised bumps with a faint glow
- When two atoms approach connection range, nodes reach toward each other with a small tendril arc (like static electricity jumping)
- Connected nodes show a visible bridge
- Machine topology is always visible at a glance — where signals flow, where forces transfer

### Colour Taxonomy
| Role | Colour | Atoms |
|---|---|---|
| Energy output | Warm (orange-red) | PULSE |
| Information input | Cool (blue) | SENSE |
| Logic processing | Mid-spectrum (yellow-green) | RELAY |
| Memory | Violet | HOLD |
| Structure | Neutral silver | FLEX |

A player scanning a complex machine can instantly parse functional clusters by colour.

### Animation as State
- Every atom is always subtly alive — gentle bobbing, pulsing, shimmering. Nothing ever looks dead.
- Animation *intensity* maps to activity level (idle = gentle, active = pronounced)
- A running machine looks like a living organism — energy and information cascading visibly through it in real time
- Emergence becomes *visible*, not just theoretical

### Scale Consistency
- All sphere atoms are roughly the same diameter
- FLEX is the only elongated form
- Machines have readable visual density — complexity is estimable by visual mass
- Individual atoms remain distinguishable even in assemblies of hundreds

---

## Signal Model: Fields vs Wires

The system supports two complementary signal propagation modes:

| Mode | Mechanism | Atom | Enables |
|---|---|---|---|
| **Field** (implicit) | SENSE detects nearby atoms through open space | SENSE | Flocking, swarm behaviour, environmental awareness |
| **Wire** (explicit) | Signals propagate through connected RELAY chains | RELAY | Circuits, logic, deliberate signal routing |

This duality — field vs wire — is where much of the emergent complexity lives. Machines can react to their environment (field) AND run internal logic (wire) simultaneously.

---

## Emergence Validation

### Coverage Test
| Capability | Atoms Required |
|---|---|
| Oscillators, walkers, crawlers, swimmers | PULSE + FLEX |
| Reactive behaviour (following, fleeing, obstacle avoidance) | + SENSE |
| Conditional behaviour (if-then, signal routing, decisions) | + RELAY |
| State machines, counters, sequential logic | + HOLD |

### Acid Test
Can a player build a creature that:
1. Walks toward light — PULSE + FLEX (locomotion) + SENSE (light detection)
2. Picks up an object — RELAY (decision logic) + FLEX (gripper)
3. Carries it somewhere — HOLD (state: "am I carrying?") + SENSE (navigation)
4. Puts it down — RELAY (conditional on arrival) + HOLD (state toggle)

All five atoms used. None redundant.

### Completeness Claims
- **Mechanically complete:** Any motion expressible through linear force + variable-rigidity joints
- **Computationally complete:** RELAY provides NAND; HOLD provides state; together they are Turing-complete

---

## Environment Model

Mass, gravity, friction, and buoyancy are NOT atoms — they are **Lab properties**. The same five atoms produce wildly different emergent behaviour across different environments:
- Standard gravity lab
- Underwater / high-drag lab
- Zero-G lab
- High-friction surface lab

Labs are the shared multiplayer spaces hosted via SpacetimeDB for real-time collaboration.

---

## Technical Assumptions

- **Rendering target:** 200,000+ 3D shapes at 60fps (M2 Mac baseline)
- **Multiplayer backend:** SpacetimeDB for real-time state synchronisation
- **Shared spaces:** Labs — persistent collaborative environments
- **Physics:** Simplified rigid/soft body simulation, not full PhysX fidelity. Tuned for emergence and playability over realism.

---

## Open Questions

1. **SENSE dual-mode:** Should a single SENSE atom support both contact and proximity, or should these be distinct configurations?
2. **FLEX signal control:** When FLEX rigidity is toggled by signal, what's the transition speed? Instant snap or damped transition?
3. **Connection limits:** Maximum connections per atom? Unlimited risks visual noise; limited risks artificial constraint.
4. **Signal speed:** Do signals propagate instantly through RELAY chains, or is there a per-hop delay? Delay enables timing-based circuits but adds complexity.
5. **PULSE recoil:** Does firing a PULSE impart equal-and-opposite force on the atom itself (Newton's third law), or is it a "magic" thruster? Recoil enables more realistic locomotion but complicates simple builds.
6. **Order 2 interface:** How does the learning system (Order 2) read and modify Order 1 machines? Does it add/remove atoms, retune parameters, or both?
