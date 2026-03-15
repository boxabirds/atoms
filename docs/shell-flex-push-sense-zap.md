# Five atoms that build everything

**A set of five abstract, parameterizable building blocks — Shell, Flex, Push, Sense, and Zap — can compose into virtually any robot, creature, vehicle, or art object, while each remaining individually fun as a physics toy.** This conclusion emerges from analyzing the primitive systems of 12+ constructor games, modular design theory, emergent systems research, and the new design space opened by AI-generated materials. The key architectural insight: decouple *function* from *appearance* entirely, letting AI handle cosmetics while five orthogonal functional atoms handle everything structural, mechanical, and behavioral.

The strongest constructor games — Besiege, Trailmakers, Spore, Tiny Glade — all converge on the same **six functional categories** (structure, propulsion, articulation, control, interaction, utility), but most pad these out to 50–228 specific parts. With AI-generated PBR materials handling visual identity, those six categories compress into five atoms that are MECE across the functional space and produce rich emergence through composition.

---

## Every constructor game secretly uses the same six categories

Across Besiege (~62 blocks), Trailmakers (100+ parts), Spore (228 parts), Kerbal Space Program (300+ parts), Robocraft, Scrap Mechanic, Crossout, Banjo-Kazooie: Nuts & Bolts (1,600+ components), Garry's Mod, and LEGO (3,764+ elements), the same functional taxonomy appears without exception:

| Role | What it does | Found in |
|------|-------------|----------|
| **Structure** | Passive mass, shape, collision | Every game — wood blocks, chassis cubes, bricks, armor |
| **Propulsion** | Creates movement force | Wheels, engines, jets, propellers — universal |
| **Articulation** | Relative motion between parts | Hinges, bearings, pistons, ball joints, springs |
| **Control** | Player input → machine action | Seats, steering, logic gates, controllers |
| **Interaction** | Affects the external world | Weapons, grabbers, tools, cannons |
| **Utility** | Modifiers and special behaviors | Fuel tanks, sensors, lights, balloons, gyroscopes |

The structural *shape grammar* also converges: **cube, wedge, plate, cylinder, pole** appear in every game. Besiege's minimum viable machine needs just five parts (starting block, wood block, motor wheel, hinge, brace). Trailmakers' developers explicitly state their philosophy as "complexity through simplicity — individually blocks are fairly simple, but combined the possibilities are endless." LEGO's functional minimum is five elements (1×1 brick, 1×2 brick, 2×4 brick, 1×2 plate, 1×1 tile). The pattern is unmistakable: **functional variety matters far more than visual variety**, and 4–7 functional categories suffice for nearly unlimited creative expression.

The most revealing comparison is between Spore and Besiege. Spore uses 228 concrete parts across 7 categories, but its procedural animation system reasons about them *abstractly* — queries like "find the highest pair of arms" and "all left feet, then all right feet" treat parts as functional roles, not specific shapes. Besiege is maximally concrete (~62 specific parts), yet players discover emergent "technologies" (bracecubes, ballast guns, return-to-center mechanisms) through creative misuse. Both paths produce deep emergence, but Spore's abstract-function approach achieves it with a smaller effective primitive count.

## AI-generated materials collapse the design space from N×M to M

The single most important architectural decision for a new constructor game is recognizing that **form and appearance are now fully separable**. AI PBR material generation has reached production quality: Ubisoft's CHORD system converts text prompts to complete PBR maps (base color, normal, height, roughness, metalness) using chained diffusion decomposition. Scenario.com offers real-time text-to-PBR workflows with direct Unity integration. Brown University's ProcTex (January 2025) solves the critical problem of maintaining texture consistency as procedural geometry changes dynamically — exactly the challenge a building game faces.

This means the old model of needing separate "wooden beam," "stone beam," and "metal beam" blocks collapses. Where traditional games required **N materials × M shapes = N×M block types**, AI cosmetics reduce this to just **M functional shapes**. The reduction factor is 10–50×. Minecraft already hints at this — resource packs re-skin every block, but the game still needs ~800+ block types because each encodes *functional* differences (crafting recipes, tool interactions, redstone behavior), not just visual ones. A pure constructor game with AI texturing needs only the functional primitives.

The remaining M primitives must therefore carry *more* functional weight. Each atom needs rich parameterization, clear physics behavior, strong connectivity rules, and enough semantic metadata for procedural systems to act intelligently. When a player types "weathered copper with verdigris" and every Shell block transforms accordingly, the atoms' structural and behavioral identity becomes the *only* meaningful differentiator between creations. This pushes strongly toward abstract, parameterizable primitives with visual skins layered on top.

## The five atoms: Shell, Flex, Push, Sense, Zap

Based on the convergent evidence from game analysis, modular design theory, ECS architecture, and mathematical completeness (the primitives must span the functional space like basis vectors span a vector space), five atoms achieve MECE coverage:

### 1. Shell — structure, mass, and form
The passive building material. Defines shape, weight, collision volume, and visual surface. Parameterizable along **size** (from fingertip to body-length), **shape** (cube, wedge, cylinder, plate — the universal CSG primitives), and **density** (light/medium/heavy, affecting physics and buoyancy). Every Shell has connection points on all faces (grid-based, like Trailmakers' knob system), making rigid attachment the default. **Fun alone**: drop it and it bounces with satisfying weight. Resize it and it wobbles with squash-and-stretch. Apply an AI material ("alien bone," "glowing crystal") and it becomes beautiful. Stack them and physics creates drama. The Tiny Glade principle applies: placement triggers procedural elaboration — edges get bevels, surfaces get weathering, adjacent Shells generate mortar lines or weld seams automatically.

### 2. Flex — articulation and connection with degrees of freedom
The joint. Creates a physics boundary between two sub-assemblies, enabling relative motion. Parameterizable along **degrees of freedom** (1-axis = hinge, 2-axis = universal, 3-axis = ball joint), **stiffness** (rigid lock → free swing, with spring behavior in between), **limits** (angle constraints), and **damping**. One parameter setting makes it a door hinge; another makes it a shock absorber; another makes it a floppy ragdoll neck. **Fun alone**: it swings, bounces, oscillates. Attach it to a surface and flick it — satisfying pendulum physics. The spring behavior at medium stiffness creates inherently playful motion. Besiege's research confirms that separate articulation atoms enable the most emergence: players combine hinges, ball joints, and pistons to create 2D turrets, walking legs, thrust-vectoring systems, and mechanisms the designers never anticipated. Garry's Mod's seven constraint types (weld, rope, axis, ballsocket, slider, motor, hydraulic) validate that articulation deserves its own rich primitive.

### 3. Push — force application and locomotion
The mover. Applies a directional force vector to whatever it's attached to. Parameterizable along **direction** (relative to attachment surface), **magnitude** (gentle nudge → rocket thrust), **mode** (continuous spin, continuous linear, burst/impulse, oscillating), and **responsiveness** (instant → gradual ramp-up). A Push in continuous-spin mode with a wheel skin *is* a wheel. In continuous-linear mode with a jet skin, it's a thruster. In burst mode aimed downward, it's a jumping leg. In oscillating mode, it's a flapping wing. **Fun alone**: place it on a surface and it zooms away. Sparks, exhaust, particle trails. Immediate kinetic satisfaction — the game feel research shows that objects creating movement are inherently rewarding because they demonstrate cause-and-effect with proportional impact feedback. The sound design shifts with the mode parameter: spin mode hums, linear mode whooshes, burst mode pops.

### 4. Sense — detection, logic, and control
The brain. Detects environmental conditions and routes signals to other atoms. Parameterizable along **detection type** (proximity, contact, angle, speed, altitude, light level, player input), **trigger condition** (threshold, continuous, toggle), and **signal routing** (which connected atoms receive its output). Chaining Senses creates logic circuits without requiring explicit AND/OR/XOR gates — two proximity Senses feeding the same Push creates an implicit AND gate. **Fun alone**: it *watches*. An eye-like Sense visually tracks nearby objects, glowing when it detects something. This single behavior creates uncanny personality — the "juice" research confirms that adding eyes to objects makes them feel alive. Place one Sense on a Shell and it transforms from inert block to attentive creature. Spore's procedural animation system proved that even minimal sensing (legs detect ground, eyes track objects) generates the illusion of life. The Sense atom makes every creation feel aware.

### 5. Zap — world interaction and effects
The effector. Acts upon the external environment rather than the creation itself. Parameterizable along **effect type** (projectile, grab/hold, push/pull field, damage zone, heal/repair, emit particles), **range** (contact → long-range), **shape** (beam, cone, sphere, targeted), and **intensity**. A grab-type Zap is a hand/claw. A projectile-type Zap is a cannon. A push-field Zap is a force shield. A damage-zone Zap is a blade or saw. **Fun alone**: it does things to the world immediately. Fire a projectile Zap and watch it arc, impact, create effects. A grab Zap picks up objects with satisfying physics. The interaction with the environment creates the feedback loop that game feel research identifies as critical: action → visible world-state change → satisfaction.

### Why these five are MECE

Each atom maps to an orthogonal functional dimension, like basis vectors spanning a space:

- **Shell** = passive (mass, form, surface) — the noun
- **Flex** = relative motion (degrees of freedom between parts) — the grammar
- **Push** = active force (self-locomotion, internal energy) — the verb
- **Sense** = information (detection, logic, routing) — the adjective
- **Zap** = external action (affecting the world beyond the creation) — the transitive verb

No two atoms overlap in function. Together they cover every behavior observed across all 12+ constructor games analyzed. A car is Shells + Flexes (suspension) + Pushes (wheels) + Senses (steering input). A creature is Shells (body) + Flexes (joints) + Pushes (legs/locomotion) + Senses (eyes/awareness) + Zaps (mouth/claws). A turret is Shells (base) + Flexes (rotation) + Senses (target tracking) + Zaps (projectile). An art sculpture is just Shells — beautiful on their own with AI materials and procedural elaboration.

## Emergence requires orthogonal mechanics at the edge of chaos

Conway's Game of Life produces Turing-complete computation from four rules because it operates at the **edge of chaos** — the boundary between static order and random noise where complex, self-organizing behavior lives. Conway deliberately rejected rule sets that produced explosive growth (too chaotic) or inevitable death (too ordered). The same principle applies to building block atoms.

Each atom should interact with others along independent axes to maximize the combinatorial possibility space. If Shell affects *form*, Flex affects *degrees of freedom*, and Push affects *force*, then combining all three creates a three-dimensional possibility space rather than a one-dimensional one. The game design literature calls this **orthogonal mechanics**: "each building block should interact with others along independent axes." Keith Burgun's "elegance" metric captures the goal precisely — **maximize the gap between component complexity (5 simple atoms) and emergent complexity (infinite machines)**.

The critical design pattern from successful constructor games is what Josh Bycer calls **tools vs. keys**: a tool has a specific purpose but wide applications; a key has a specific purpose and limited application. Push must be a *tool* — its continuous-spin mode propels wheels, but players should discover it can also act as a gyroscopic stabilizer, a grinding surface, or a centrifugal launcher. Besiege validates this: its steering hinge (a concrete part) gets creatively misused as a reaction wheel, a clock mechanism, a return-to-center spring, and a flip recovery system. Abstract parameterization makes every atom inherently a tool rather than a key.

Feedback loops between atoms create the richest emergence. **Sense → Push** creates reactive locomotion (creature walks toward food). **Sense → Zap** creates autonomous weapons (turret tracks and fires). **Sense → Flex** creates adaptive suspension (joint stiffens on rough terrain). **Sense → Sense** creates logic chains (compound conditions, state machines). The MDA framework (Mechanics, Dynamics, Aesthetics) predicts that these mechanical interactions produce *dynamics* — runtime behaviors — that neither the designer nor the player explicitly programmed. Breath of the Wild's weather system exemplifies this: rain interacts with climbing, combat, stealth, and fire mechanics simultaneously, creating emergent gameplay from one simple system. Five atoms with rich cross-interactions should produce similar emergent density.

## Component-scale granularity maximizes fun per click

The granularity analysis reveals stark tradeoffs across three scales:

**Voxel-scale** (Minecraft) offers maximum aesthetic freedom but minimum functional emergence and terrible "fun per click" — building a working car requires thousands of placements. **Limb-scale** (Spore) offers maximum accessibility and speed-to-first-cool-thing but shallow engineering depth and limited emergence. **Component-scale** (Besiege, Trailmakers) hits the sweet spot: every placement meaningfully changes the creation's behavior, the build-test-iterate loop is fast, and the engineering depth supports years of mastery.

For an 11-year-old target audience, component-scale scores highest across the factors that matter most: **fun per click** (★★★★★), **engineering depth** (★★★★★), **accessibility** (★★★★), and **speed to first cool thing** (★★★★). Each atom should be roughly fist-sized to arm-length in the game world, with **15–50 blocks per creation** as the target sweet spot — enough for expressive machines, few enough to iterate in minutes.

The Tiny Glade precedent adds a crucial refinement: **procedural amplification** of player intent. When a player places Shells adjacent to each other, the system should procedurally generate architectural detail (bevels, seams, weathering) just as Tiny Glade generates stonework from simple wall gestures. This creates Tiny Glade's "a lot from little effort" feeling at component scale — each placement produces rich visual results without requiring voxel-level manual detailing. Anastasia Opara (Tiny Glade co-creator) describes this as giving players "tools and letting them have fun, akin to giving a child a bunch of LEGO bricks."

Complexity budgets are essential. Every successful constructor game constrains total complexity: Robocraft uses CPU limits, Trailmakers uses Power Cores, Spore uses DNA points, Crossout uses energy and weight caps. For five atoms, a simple **energy budget** works naturally: Shells are free (passive), but Flexes, Pushes, Senses, and Zaps each cost energy proportional to their parameter intensity. This forces meaningful tradeoffs (fast but fragile vs. slow but armored) and prevents multiplayer performance issues from unlimited part counts.

## Making each atom feel alive before it's connected to anything

Tiny Glade's three pillars — "a lot from little effort," "no wrong answers," and "it's alive" — define what individual atom satisfaction should feel like. The game sold **616,000 copies in its first month** built by two developers, proving that pure building satisfaction (no goals, no combat, no progression) can carry an entire product.

Steve Swink's game feel framework identifies the core requirement: **"the game should feel engaging even after plot, points, level design, music, and graphics are removed."** Each atom must pass this test in isolation. The "Juice It or Lose It" GDC talk demonstrated that adding squash-and-stretch, particle effects, sound, screen shake, and eyes transforms identical mechanics from boring to compelling.

Concrete recommendations per atom:

- **Shell**: Procedural idle breathing (subtle sine-wave scale oscillation), satisfying drop-and-bounce physics with material-appropriate sound, AI-generated material that shimmers or reacts to light, procedural imperfection (slightly irregular edges, organic variation). Tiny Glade proved that auto-generated architectural detail makes simple placement feel luxurious.
- **Flex**: Spring-loaded swing behavior on placement, pendulum physics that responds to player proximity, audible creaking/clicking at motion extremes, visual stretch indicators showing current stress. Physics toys research shows hinges and springs are inherently satisfying to manipulate.
- **Push**: Immediate particle trail and force visualization on placement, escalating engine sound as force magnitude increases, reactive environment effects (dust displacement, grass flattening). Kinetic objects are inherently rewarding — Katamari Damacy's core satisfaction comes from momentum and visible cause-and-effect.
- **Sense**: Eye-tracking behavior toward nearest moving object, glow intensity that changes with detection state, ambient scanning animation when idle. The juice research confirms: **adding eyes to any object makes it feel like a character**. This single property transforms a machine into a creature.
- **Zap**: Test-fire capability in isolation with satisfying projectile/grab/field effects, environmental reaction to every activation (scorched ground, displaced objects, visual ripples). The critical principle from game feel theory: every action must produce visible world-state change with proportional feedback intensity.

## Procedural animation turns assemblies into creatures

Spore's procedural animation system (detailed by Chris Hecker at SIGGRAPH 2008) solved the hardest problem: animating **morphologies that didn't exist when animations were authored**. The system stores animation data in morphology-independent form, uses channel-based queries ("find the highest pair of arms," "group legs by length"), and applies runtime IK solving to produce walking, attacking, and emoting for any body configuration. Creature data is stored as just ~2KB of "DNA" — the engine generates megabytes of animation from this recipe.

For five atoms, the procedural animation pipeline would work as follows: the system identifies the structural spine (longest Shell chain), detects limbs (chains branching from spine that terminate near the ground or with Push atoms), assigns gait patterns based on limb count and symmetry, and applies IK for terrain adaptation. Non-structural Shells get secondary "jiggle" motion. Sense atoms direct head/eye tracking. Push atoms on limbs create locomotion cycles.

Modern approaches validate this: Rain World animates creatures through programmatically moved endpoints with hinge-joint ragdoll completion. Grow Home uses no predefined animations — limb positions are forced via code with physics constraints filling in the rest. The FABRIK IK algorithm is available in every major engine. The key requirement is that atoms encode enough **semantic information** — "is this structural?", "is this a joint?", "is this a foot endpoint?" — for the animation system to reason about arbitrary assemblies.

## Conclusion: composition as the core creative act

The five-atom system — Shell, Flex, Push, Sense, Zap — is grounded in a convergent pattern across every successful constructor game ever shipped. What changes from historical precedent is the level of abstraction: where Besiege offers 62 concrete parts and Spore offers 228, five parameterizable atoms with AI-generated skins achieve equivalent or greater creative coverage with dramatically lower cognitive load, smaller creation file sizes (critical for multiplayer), and richer emergence from orthogonal cross-interactions.

The deepest insight from this research is that **the connection system is not a sixth atom — it's the substrate**. Rigid connection is a property of all atoms (grid-based face snapping, like Trailmakers' knob system). Flex handles all articulated connections as a dedicated atom. This hybrid approach (universal rigid connections + explicit articulation atom) is the dominant pattern across every game studied, and it maximizes both accessibility and emergence.

Three design principles should govern implementation. First, **parameterization over proliferation** — tune a Push's force vector rather than shipping 10 engine types. Second, **procedural amplification** — every atom placement should trigger Tiny Glade-style elaboration that makes simple input produce rich output. Third, **elegant constraint** — an energy budget forces meaningful tradeoffs without blocking creativity. The resulting system should achieve what Keith Burgun calls maximum elegance: the largest possible gap between the simplicity of five atoms and the complexity of what players build with them.