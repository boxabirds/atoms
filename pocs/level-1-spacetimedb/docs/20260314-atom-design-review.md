# Atoms Level-1: Gameplay Design Review

**Date**: 2026-03-14
**Context**: 11yo playtester finds only PUSH (PULSE) fun. Working backwards from canonical creatures to find the minimal atom set.

---

## Diagnosis: 1 of 5 Atoms Is Fun

PUSH succeeds: drop it, it kicks, things move. Immediate physical feedback.

Everything else fails:
- **FLEX**: Inert stick. Busywork spacer between the atoms that actually do things
- **SENSE**: Detects but doesn't *want*. Camera with no viewer
- **RELAY**: Logic gate. Plumbing. Not fun alone
- **HOLD**: Light switch to nowhere

---

## The Missing Motion Primitive

Physics has **push** (linear force) but no **orient** (rotation). Atoms can't turn. Nozzles and cones point the same direction forever. No machine can steer.

| Primitive | Atom | Player experience |
|-----------|------|-----------------|
| **Push** (translation) | PUSH | "This thing shoves" |
| **Orient** (rotation) | EYE | "This thing turns to look" |

Push without orient = wind-up toy. Orient without push = swiveling camera. Together = creature that wants something.

---

## Decision: Two Core Atoms

| Atom | Renamed from | What a child sees alone |
|------|-------------|------------------------|
| **PUSH** | PULSE | It kicks! Things fly! |
| **EYE** | SENSE | It turns to look at me! |

RELAY and HOLD → deferred to Order 2 (logic/memory for programmable creatures).

### BONE (FLEX) — Unresolved

Working backwards from canonical creatures:

| Creature | Needs | Structural requirement |
|----------|-------|----------------------|
| Hopper | 1 PUSH | None |
| Walker | 2-4 PUSHes | Spatial separation between legs |
| Chaser | EYE + PUSH | Rotational coupling + lever arm |
| Crawler | EYE + PUSHes | Body larger than a point |
| Tentacle | Chain of inert segments | **Length without function** |

Creatures 1-4 work with PUSH + EYE + smart connections (adjustable length and stiffness). No separate structural atom.

The tentacle is the first creature demanding inert material. But tentacles aren't the first playable.

**Working hypothesis**: Start with 2 atoms. Connections themselves have rest-length + stiffness (rigid/elastic/limp). Add BONE later if building demands it.

---

## EYE — Motivation

When EYE detects a target, it applies **torque** to orient its molecule toward the target. Not attraction (magnet) — orientation. The machine turns to face the target.

- **Target lost**: Stops applying torque. Angular momentum + damping decays. Just physics
- **Multiple EYEs**: Each applies torque independently. Vector sum resolves. No game logic

---

## Connection Stiffness

| Mode | Rotation coupling | Spring | Feels like |
|------|------------------|--------|-----------|
| **Rigid** | Full — rotate together | Fixed distance | Bone / steel rod |
| **Elastic** | Partial — dampened | Stretchy | Cartilage / rubber |
| **Limp** | None | Floppy | Ragdoll / wet noodle |

Rigid EYE→PUSH = EYE steers PUSH directly (skull on spine).
Elastic = EYE looks around while body goes straight (a neck).
Limp = collapse.

---

## Discovery Sequence

| # | Machine | What child sees | New concept |
|---|---------|----------------|-------------|
| 1 | **Hopper** (1 PUSH) | It bounces! | PUSH kicks |
| 2 | **Walker** (4 PUSHes) | It walks! | Phase offset = gait |
| 3 | **Tracker** (1 EYE) | It turns to face me! | EYE orients |
| 4 | **Chaser** (EYE + PUSH) | It chases things! | Orient + push = pursuit |
| 5 | **Flexi-walker** (Walker + elastic) | Wobbly walker | Stiffness matters |
| 6 | **Smart Walker** (Walker + EYE) | Walks toward things! | Full creature |

---

## Bottom Line

Two atoms, two motion primitives: **PUSH** (translation) and **EYE** (rotation). Connections handle structure via adjustable stiffness. Everything else is Order 2.

The spec promised "5 building blocks, zero tutorials needed." The honest minimum for the first playable might be 2 building blocks that each pass the drop-it-alone test. Prove the creature kit, then grow.
