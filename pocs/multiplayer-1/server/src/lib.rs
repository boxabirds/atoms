//! Atoms multiplayer server — SpacetimeDB module with hand-rolled physics.
//!
//! Server-authoritative physics + behavior system for multiplayer atom simulation.

use spacetimedb::{table, reducer, ReducerContext, Table, ScheduleAt, TimeDuration};
type Real = f32;
use std::collections::{HashMap, HashSet};

// ---------------------------------------------------------------------------
// Physics constants
// ---------------------------------------------------------------------------

const TICK_INTERVAL_MICROS: i64 = 50_000; // 20Hz = 50ms
const GRAVITY: Real = -9.8;
const GROUND_Y: Real = -2.0;
const ARENA_HALF: Real = 20.0;
const ATOM_COLLISION_RADIUS: Real = 0.24;
const FLEX_COLLISION_RADIUS: Real = 0.11;
const GROUND_BOUNCE: Real = 0.3;
const GROUND_FRICTION: Real = 0.92;
const WALL_BOUNCE: Real = 0.5;
const VELOCITY_CAP: Real = 8.0;
const DAMPING: Real = 0.95;
const DT: Real = 0.05; // 50ms tick
const FLEX_LENGTH: Real = 0.6;
const REST_LENGTH_FACTOR: Real = 2.2;
const SPRING_K: Real = 50.0;
const COLLISION_REPULSION: Real = 80.0;
const POSITION_CORRECTION: Real = 0.4;

// ---------------------------------------------------------------------------
// Behavior constants (mirrored from level-1)
// ---------------------------------------------------------------------------

const SIGNAL_SPEED: Real = 4.0;
const PULSE_FIRE_INTERVAL: Real = 1.2;
const PULSE_FORCE_STRENGTH: Real = 1.5;
const PULSE_RECOIL_FACTOR: Real = 0.3;
const PULSE_PHASE_JITTER: Real = 0.2;
const SENSE_DETECTION_RANGE: Real = 2.0;
const SENSE_CONE_ANGLE: Real = 1.0471976; // π/3 ≈ 60°
const SENSE_COOLDOWN: Real = 0.5;
const SIGNAL_CHARGE_DECAY: Real = 1.5;
const GROUND_KICK_THRESHOLD_OFFSET: Real = 0.75; // ~ATOM_RADIUS * 3
const GROUND_KICK_STRENGTH: Real = 0.4;

fn collision_radius(atom_type: &str) -> Real {
    if atom_type == "flex" { FLEX_COLLISION_RADIUS } else { ATOM_COLLISION_RADIUS }
}

fn vec_len(x: Real, y: Real, z: Real) -> Real {
    (x * x + y * y + z * z).sqrt()
}

/// Rotate vector (vx,vy,vz) by quaternion (qx,qy,qz,qw)
fn quat_rotate(qx: Real, qy: Real, qz: Real, qw: Real, vx: Real, vy: Real, vz: Real) -> (Real, Real, Real) {
    // q * v * q^-1, expanded
    let tx = 2.0 * (qy * vz - qz * vy);
    let ty = 2.0 * (qz * vx - qx * vz);
    let tz = 2.0 * (qx * vy - qy * vx);
    (
        vx + qw * tx + (qy * tz - qz * ty),
        vy + qw * ty + (qz * tx - qx * tz),
        vz + qw * tz + (qx * ty - qy * tx),
    )
}

/// Angle between two vectors
fn vec_angle(ax: Real, ay: Real, az: Real, bx: Real, by: Real, bz: Real) -> Real {
    let la = vec_len(ax, ay, az);
    let lb = vec_len(bx, by, bz);
    if la < 0.001 || lb < 0.001 { return std::f32::consts::PI; }
    let dot = (ax * bx + ay * by + az * bz) / (la * lb);
    dot.clamp(-1.0, 1.0).acos()
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

#[table(accessor = atom, public)]
pub struct Atom {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub atom_type: String,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub vx: f32,
    pub vy: f32,
    pub vz: f32,
    pub rx: f32,
    pub ry: f32,
    pub rz: f32,
    pub rw: f32,
    pub avx: f32,
    pub avy: f32,
    pub avz: f32,
    pub grounded: bool,
    // Behavior state
    pub signal_charge: f32,
    pub relay_mode: String,     // "pass", "invert", "block"
    pub hold_on: bool,
    pub flex_elastic: bool,
    pub last_fire_time: f32,
    pub pulse_phase: f32,
    pub sense_cooldown: f32,
}

#[table(accessor = connection, public)]
pub struct Connection {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub from_atom_id: u64,
    pub to_atom_id: u64,
    pub from_node_idx: u32,
    pub to_node_idx: u32,
}

#[table(accessor = signal, public)]
pub struct Signal {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub from_atom_id: u64,
    pub to_atom_id: u64,
    pub connection_id: u64,
    pub progress: f32,
}

#[table(accessor = arena_state, public)]
pub struct ArenaState {
    #[primary_key]
    pub id: u32,
    pub frozen: bool,
    pub tick_count: u64,
    pub tick_duration_us: u64,
    pub atom_count: u32,
}

#[table(accessor = tick_schedule, public, scheduled(tick_physics))]
pub struct TickSchedule {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    ctx.db.tick_schedule().insert(TickSchedule {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Interval(TimeDuration::from_micros(TICK_INTERVAL_MICROS)),
    });

    ctx.db.arena_state().insert(ArenaState {
        id: 0,
        frozen: false,
        tick_count: 0,
        tick_duration_us: 0,
        atom_count: 0,
    });

    log::info!("Atoms server initialized. Tick interval: {}us", TICK_INTERVAL_MICROS);
}

// ---------------------------------------------------------------------------
// Tick — behavior system + Rapier physics
// ---------------------------------------------------------------------------

#[reducer]
pub fn tick_physics(ctx: &ReducerContext, _schedule: TickSchedule) {
    let Some(mut state) = ctx.db.arena_state().id().find(0) else { return };
    if state.frozen {
        return;
    }

    let sim_time = state.tick_count as f32 * DT;

    // ── Collect all state from DB ──────────────────────────────────────
    let mut atoms: Vec<Atom> = ctx.db.atom().iter().collect();
    let connections: Vec<Connection> = ctx.db.connection().iter().collect();
    let mut signals: Vec<Signal> = ctx.db.signal().iter().collect();

    if atoms.is_empty() {
        state.tick_count += 1;
        state.atom_count = 0;
        ctx.db.arena_state().id().update(state);
        return;
    }

    // Build lookup structures
    let mut atom_idx: HashMap<u64, usize> = HashMap::with_capacity(atoms.len());
    for (i, atom) in atoms.iter().enumerate() {
        atom_idx.insert(atom.id, i);
    }

    // atom_id → vec of (connection_id, other_atom_id)
    let mut atom_connections: HashMap<u64, Vec<(u64, u64)>> = HashMap::new();
    for conn in &connections {
        atom_connections.entry(conn.from_atom_id).or_default().push((conn.id, conn.to_atom_id));
        atom_connections.entry(conn.to_atom_id).or_default().push((conn.id, conn.from_atom_id));
    }

    // Connected pairs for SENSE exclusion
    let mut connected_pairs: HashSet<(u64, u64)> = HashSet::new();
    for conn in &connections {
        connected_pairs.insert((conn.from_atom_id, conn.to_atom_id));
        connected_pairs.insert((conn.to_atom_id, conn.from_atom_id));
    }

    // ── Phase 1: Advance signals, collect deliveries ───────────────────
    let mut impulses: Vec<(u64, (Real, Real, Real))> = Vec::new();
    let mut new_signals: Vec<(u64, u64, u64)> = Vec::new(); // (from, to, conn_id)
    let mut signals_to_delete: Vec<u64> = Vec::new();

    struct Delivery {
        target_id: u64,
        source_id: u64,
    }
    let mut deliveries: Vec<Delivery> = Vec::new();

    for sig in &mut signals {
        sig.progress += DT * SIGNAL_SPEED;
        if sig.progress >= 1.0 {
            signals_to_delete.push(sig.id);
            deliveries.push(Delivery {
                target_id: sig.to_atom_id,
                source_id: sig.from_atom_id,
            });
        }
    }

    // ── Phase 2: Process signal deliveries ─────────────────────────────
    for delivery in &deliveries {
        let Some(&idx) = atom_idx.get(&delivery.target_id) else { continue };
        let target_type = atoms[idx].atom_type.clone();
        atoms[idx].signal_charge = 1.0;

        match target_type.as_str() {
            "relay" => {
                if atoms[idx].relay_mode == "block" { continue; }
                if let Some(conns) = atom_connections.get(&delivery.target_id) {
                    for &(conn_id, other_id) in conns {
                        if other_id == delivery.source_id { continue; }
                        // Dedup: no duplicate signal on same connection from same sender
                        if signals.iter().any(|s| s.connection_id == conn_id && s.from_atom_id == delivery.target_id) { continue; }
                        if new_signals.iter().any(|&(f, _, c)| c == conn_id && f == delivery.target_id) { continue; }
                        new_signals.push((delivery.target_id, other_id, conn_id));
                    }
                }
            }
            "hold" => {
                atoms[idx].hold_on = !atoms[idx].hold_on;
            }
            "pulse" => {
                // Triggered PULSE fire
                let atom_id = atoms[idx].id;
                let (nx, ny, nz) = quat_rotate(atoms[idx].rx, atoms[idx].ry, atoms[idx].rz, atoms[idx].rw, 0.0, 0.0, 1.0);

                // Recoil on self
                let recoil = -PULSE_FORCE_STRENGTH * PULSE_RECOIL_FACTOR;
                impulses.push((atom_id, (nx * recoil, ny * recoil, nz * recoil)));

                // Push connected atoms + emit signals
                if let Some(conns) = atom_connections.get(&atom_id) {
                    for &(conn_id, other_id) in conns {
                        let mut iy = ny * PULSE_FORCE_STRENGTH;
                        if atoms[idx].y < GROUND_Y + GROUND_KICK_THRESHOLD_OFFSET {
                            iy += GROUND_KICK_STRENGTH;
                        }
                        impulses.push((other_id, (nx * PULSE_FORCE_STRENGTH, iy, nz * PULSE_FORCE_STRENGTH)));

                        if signals.iter().any(|s| s.connection_id == conn_id && s.from_atom_id == atom_id) { continue; }
                        if new_signals.iter().any(|&(f, _, c)| c == conn_id && f == atom_id) { continue; }
                        new_signals.push((atom_id, other_id, conn_id));
                    }
                }

                atoms[idx].last_fire_time = sim_time;
                atoms[idx].signal_charge = 1.0;
            }
            "flex" => {
                atoms[idx].flex_elastic = !atoms[idx].flex_elastic;
            }
            _ => {}
        }
    }

    // ── Phase 3: PULSE autonomous fire ─────────────────────────────────
    for i in 0..atoms.len() {
        if atoms[i].atom_type != "pulse" { continue; }
        let interval = PULSE_FIRE_INTERVAL + atoms[i].pulse_phase.sin() * PULSE_PHASE_JITTER;
        let elapsed = sim_time - atoms[i].last_fire_time;
        if elapsed < interval { continue; }

        let atom_id = atoms[i].id;
        let (nx, ny, nz) = quat_rotate(atoms[i].rx, atoms[i].ry, atoms[i].rz, atoms[i].rw, 0.0, 0.0, 1.0);

        // Recoil
        let recoil = -PULSE_FORCE_STRENGTH * PULSE_RECOIL_FACTOR;
        impulses.push((atom_id, (nx * recoil, ny * recoil, nz * recoil)));

        // Push connected + emit signals
        if let Some(conns) = atom_connections.get(&atom_id) {
            for &(conn_id, other_id) in conns {
                let mut iy = ny * PULSE_FORCE_STRENGTH;
                if atoms[i].y < GROUND_Y + GROUND_KICK_THRESHOLD_OFFSET {
                    iy += GROUND_KICK_STRENGTH;
                }
                impulses.push((other_id, (nx * PULSE_FORCE_STRENGTH, iy, nz * PULSE_FORCE_STRENGTH)));

                if signals.iter().any(|s| s.connection_id == conn_id && s.from_atom_id == atom_id) { continue; }
                if new_signals.iter().any(|&(f, _, c)| c == conn_id && f == atom_id) { continue; }
                new_signals.push((atom_id, other_id, conn_id));
            }
        }

        atoms[i].last_fire_time = sim_time;
        atoms[i].signal_charge = 1.0;
    }

    // ── Phase 4: SENSE autonomous detection ────────────────────────────
    for i in 0..atoms.len() {
        if atoms[i].atom_type != "sense" { continue; }
        if atoms[i].sense_cooldown > 0.0 {
            atoms[i].sense_cooldown -= DT;
            continue;
        }

        let atom_id = atoms[i].id;
        let (fx, fy, fz) = quat_rotate(atoms[i].rx, atoms[i].ry, atoms[i].rz, atoms[i].rw, 0.0, 0.0, 1.0);

        let mut detected = false;
        for j in 0..atoms.len() {
            if i == j { continue; }
            // Skip atoms connected to this SENSE
            if connected_pairs.contains(&(atom_id, atoms[j].id)) { continue; }

            let dx = atoms[j].x - atoms[i].x;
            let dy = atoms[j].y - atoms[i].y;
            let dz = atoms[j].z - atoms[i].z;
            let dist = vec_len(dx, dy, dz);
            if dist > SENSE_DETECTION_RANGE || dist < 0.001 { continue; }

            let angle = vec_angle(fx, fy, fz, dx, dy, dz);
            if angle < SENSE_CONE_ANGLE {
                detected = true;
                break;
            }
        }

        if detected {
            atoms[i].signal_charge = 1.0;
            atoms[i].sense_cooldown = SENSE_COOLDOWN;

            if let Some(conns) = atom_connections.get(&atom_id) {
                for &(conn_id, other_id) in conns {
                    if signals.iter().any(|s| s.connection_id == conn_id && s.from_atom_id == atom_id) { continue; }
                    if new_signals.iter().any(|&(f, _, c)| c == conn_id && f == atom_id) { continue; }
                    new_signals.push((atom_id, other_id, conn_id));
                }
            }
        }
    }

    // ── Phase 5: Signal charge decay ───────────────────────────────────
    for atom in &mut atoms {
        if atom.signal_charge > 0.0 {
            atom.signal_charge = (atom.signal_charge - DT * SIGNAL_CHARGE_DECAY).max(0.0);
        }
    }

    // ── Phase 6: Update signals in DB ──────────────────────────────────
    for sig_id in &signals_to_delete {
        ctx.db.signal().id().delete(*sig_id);
    }
    // Update progress for surviving signals
    for sig in &signals {
        if signals_to_delete.contains(&sig.id) { continue; }
        if let Some(mut db_sig) = ctx.db.signal().id().find(sig.id) {
            db_sig.progress = sig.progress;
            ctx.db.signal().id().update(db_sig);
        }
    }
    // Insert new signals
    for &(from_id, to_id, conn_id) in &new_signals {
        ctx.db.signal().insert(Signal {
            id: 0,
            from_atom_id: from_id,
            to_atom_id: to_id,
            connection_id: conn_id,
            progress: 0.0,
        });
    }

    // ── Phase 7: Apply behavior impulses ─────────────────────────────
    for (atom_id, impulse) in &impulses {
        if let Some(&idx) = atom_idx.get(atom_id) {
            atoms[idx].vx += impulse.0;
            atoms[idx].vy += impulse.1;
            atoms[idx].vz += impulse.2;
        }
    }

    // ── Phase 8: Sphere-sphere collision repulsion ────────────────────
    for i in 0..atoms.len() {
        for j in (i + 1)..atoms.len() {
            let ra = collision_radius(&atoms[i].atom_type);
            let rb = collision_radius(&atoms[j].atom_type);

            let dx = atoms[i].x - atoms[j].x;
            let dy = atoms[i].y - atoms[j].y;
            let dz = atoms[i].z - atoms[j].z;
            let dist = vec_len(dx, dy, dz);
            let min_dist = ra + rb;

            if dist < min_dist && dist > 0.001 {
                let overlap = min_dist - dist;
                let nx = dx / dist;
                let ny = dy / dist;
                let nz = dz / dist;
                let force = overlap * COLLISION_REPULSION * DT;

                atoms[i].vx += nx * force;
                atoms[i].vy += ny * force;
                atoms[i].vz += nz * force;
                atoms[j].vx -= nx * force;
                atoms[j].vy -= ny * force;
                atoms[j].vz -= nz * force;

                // Position correction to prevent sinking
                let corr = overlap * POSITION_CORRECTION * 0.5;
                atoms[i].x += nx * corr;
                atoms[i].y += ny * corr;
                atoms[i].z += nz * corr;
                atoms[j].x -= nx * corr;
                atoms[j].y -= ny * corr;
                atoms[j].z -= nz * corr;
            }
        }
    }

    // ── Phase 9: Per-atom gravity, damping, ground, walls, springs ────
    for i in 0..atoms.len() {
        // Gravity
        atoms[i].vy += GRAVITY * DT;

        // Damping
        atoms[i].vx *= DAMPING;
        atoms[i].vy *= DAMPING;
        atoms[i].vz *= DAMPING;

        // Integrate position
        atoms[i].x += atoms[i].vx * DT;
        atoms[i].y += atoms[i].vy * DT;
        atoms[i].z += atoms[i].vz * DT;

        // Ground collision
        let r = collision_radius(&atoms[i].atom_type);
        let g_level = GROUND_Y + r;
        if atoms[i].y < g_level {
            atoms[i].y = g_level;
            atoms[i].vy = -atoms[i].vy * GROUND_BOUNCE;
            if atoms[i].vy.abs() < 0.1 { atoms[i].vy = 0.0; }
            atoms[i].grounded = true;
            atoms[i].vx *= GROUND_FRICTION;
            atoms[i].vz *= GROUND_FRICTION;
        } else {
            atoms[i].grounded = false;
        }

        // Wall bouncing
        if atoms[i].x > ARENA_HALF - r {
            atoms[i].x = ARENA_HALF - r;
            atoms[i].vx = -atoms[i].vx.abs() * WALL_BOUNCE;
        } else if atoms[i].x < -ARENA_HALF + r {
            atoms[i].x = -ARENA_HALF + r;
            atoms[i].vx = atoms[i].vx.abs() * WALL_BOUNCE;
        }
        if atoms[i].z > ARENA_HALF - r {
            atoms[i].z = ARENA_HALF - r;
            atoms[i].vz = -atoms[i].vz.abs() * WALL_BOUNCE;
        } else if atoms[i].z < -ARENA_HALF + r {
            atoms[i].z = -ARENA_HALF + r;
            atoms[i].vz = atoms[i].vz.abs() * WALL_BOUNCE;
        }

        // Velocity cap
        let speed = vec_len(atoms[i].vx, atoms[i].vy, atoms[i].vz);
        if speed > VELOCITY_CAP {
            let scale = VELOCITY_CAP / speed;
            atoms[i].vx *= scale;
            atoms[i].vy *= scale;
            atoms[i].vz *= scale;
        }

        // Spring constraints from connections
        let atom_id = atoms[i].id;
        if let Some(conns) = atom_connections.get(&atom_id) {
            for &(_conn_id, other_id) in conns {
                let Some(&j) = atom_idx.get(&other_id) else { continue };
                let dx = atoms[j].x - atoms[i].x;
                let dy = atoms[j].y - atoms[i].y;
                let dz = atoms[j].z - atoms[i].z;
                let dist = vec_len(dx, dy, dz);
                if dist < 0.001 { continue; }

                let has_flex = atoms[i].atom_type == "flex" || atoms[j].atom_type == "flex";
                let rest_len = if has_flex {
                    FLEX_LENGTH * 0.7
                } else {
                    ATOM_COLLISION_RADIUS * REST_LENGTH_FACTOR
                };

                let nx = dx / dist;
                let ny = dy / dist;
                let nz = dz / dist;
                let spring_force = (dist - rest_len) * SPRING_K * DT;
                atoms[i].vx += nx * spring_force;
                atoms[i].vy += ny * spring_force;
                atoms[i].vz += nz * spring_force;
            }
        }
    }

    // ── Phase 10: Write back to DB ───────────────────────────────────
    for i in 0..atoms.len() {
        let atom_id = atoms[i].id;
        if let Some(mut atom) = ctx.db.atom().id().find(atom_id) {
            atom.x = atoms[i].x;
            atom.y = atoms[i].y;
            atom.z = atoms[i].z;
            atom.vx = atoms[i].vx;
            atom.vy = atoms[i].vy;
            atom.vz = atoms[i].vz;
            atom.grounded = atoms[i].grounded;

            // Behavior state
            atom.signal_charge = atoms[i].signal_charge;
            atom.hold_on = atoms[i].hold_on;
            atom.flex_elastic = atoms[i].flex_elastic;
            atom.relay_mode = atoms[i].relay_mode.clone();
            atom.last_fire_time = atoms[i].last_fire_time;
            atom.sense_cooldown = atoms[i].sense_cooldown;

            ctx.db.atom().id().update(atom);
        }
    }

    state.tick_count += 1;
    state.atom_count = atoms.len() as u32;
    ctx.db.arena_state().id().update(state);
}

// ---------------------------------------------------------------------------
// Reducers — user actions
// ---------------------------------------------------------------------------

const ATOM_RADIUS: Real = 0.25;

fn insert_atom(ctx: &ReducerContext, atom_type: &str, x: f32, y: f32, z: f32) -> u64 {
    let y_clamped = if y < GROUND_Y as f32 + ATOM_RADIUS as f32 {
        GROUND_Y as f32 + ATOM_RADIUS as f32
    } else {
        y
    };
    // Deterministic pulse phase from position
    let phase = (x * 17.3 + z * 31.7).rem_euclid(std::f32::consts::TAU);
    // Initialize last_fire_time to current sim_time so PULSE waits a full interval
    let sim_time = ctx.db.arena_state().id().find(0)
        .map(|s| s.tick_count as f32 * DT)
        .unwrap_or(0.0);
    let atom = ctx.db.atom().insert(Atom {
        id: 0,
        atom_type: atom_type.to_string(),
        x, y: y_clamped, z,
        vx: 0.0, vy: 0.0, vz: 0.0,
        rx: 0.0, ry: 0.0, rz: 0.0, rw: 1.0,
        avx: 0.0, avy: 0.0, avz: 0.0,
        grounded: false,
        signal_charge: 0.0,
        relay_mode: "pass".to_string(),
        hold_on: false,
        flex_elastic: false,
        last_fire_time: sim_time,
        pulse_phase: phase,
        sense_cooldown: 0.0,
    });
    atom.id
}

fn insert_connection(ctx: &ReducerContext, from_id: u64, to_id: u64, from_node: u32, to_node: u32) {
    ctx.db.connection().insert(Connection {
        id: 0,
        from_atom_id: from_id,
        to_atom_id: to_id,
        from_node_idx: from_node,
        to_node_idx: to_node,
    });
}

#[reducer]
pub fn add_atom(ctx: &ReducerContext, atom_type: String, x: f32, y: f32, z: f32) {
    insert_atom(ctx, &atom_type, x, y, z);
}

#[reducer]
pub fn drag_atom(ctx: &ReducerContext, atom_id: u64, x: f32, y: f32, z: f32) {
    if let Some(mut atom) = ctx.db.atom().id().find(atom_id) {
        atom.x = x;
        atom.y = y;
        atom.z = z;
        atom.vx = 0.0;
        atom.vy = 0.0;
        atom.vz = 0.0;
        atom.avx = 0.0;
        atom.avy = 0.0;
        atom.avz = 0.0;
        ctx.db.atom().id().update(atom);
    }
}

#[reducer]
pub fn remove_atom(ctx: &ReducerContext, atom_id: u64) {
    // Delete connections referencing this atom
    let conns: Vec<Connection> = ctx.db.connection().iter()
        .filter(|c| c.from_atom_id == atom_id || c.to_atom_id == atom_id)
        .collect();
    for conn in conns {
        ctx.db.connection().id().delete(conn.id);
    }
    // Delete signals referencing this atom
    let sigs: Vec<Signal> = ctx.db.signal().iter()
        .filter(|s| s.from_atom_id == atom_id || s.to_atom_id == atom_id)
        .collect();
    for sig in sigs {
        ctx.db.signal().id().delete(sig.id);
    }
    ctx.db.atom().id().delete(atom_id);
}

#[reducer]
pub fn toggle_freeze(ctx: &ReducerContext) {
    if let Some(mut state) = ctx.db.arena_state().id().find(0) {
        state.frozen = !state.frozen;
        ctx.db.arena_state().id().update(state);
    }
}

#[reducer]
pub fn toggle_hold(ctx: &ReducerContext, atom_id: u64) {
    if let Some(mut atom) = ctx.db.atom().id().find(atom_id) {
        if atom.atom_type != "hold" { return; }
        atom.hold_on = !atom.hold_on;
        ctx.db.atom().id().update(atom);
    }
}

#[reducer]
pub fn toggle_relay_mode(ctx: &ReducerContext, atom_id: u64) {
    if let Some(mut atom) = ctx.db.atom().id().find(atom_id) {
        if atom.atom_type != "relay" { return; }
        atom.relay_mode = match atom.relay_mode.as_str() {
            "pass" => "invert".to_string(),
            "invert" => "block".to_string(),
            "block" => "pass".to_string(),
            _ => "pass".to_string(),
        };
        ctx.db.atom().id().update(atom);
    }
}

// ---------------------------------------------------------------------------
// Machine definitions — mirrored from client-side PREBUILT_MACHINES
// ---------------------------------------------------------------------------

struct AtomDef {
    atom_type: &'static str,
    offset: [f32; 3],
}

struct MachineDef {
    atoms: &'static [AtomDef],
    connections: &'static [[usize; 2]],
}

const OSCILLATOR: MachineDef = MachineDef {
    atoms: &[
        AtomDef { atom_type: "pulse", offset: [0.0, 0.0, 0.0] },
        AtomDef { atom_type: "flex",  offset: [0.55, 0.0, 0.0] },
        AtomDef { atom_type: "flex",  offset: [-0.55, 0.0, 0.0] },
    ],
    connections: &[[0, 1], [0, 2]],
};

const WALKER: MachineDef = MachineDef {
    atoms: &[
        AtomDef { atom_type: "flex",  offset: [0.0, 0.15, 0.0] },
        AtomDef { atom_type: "pulse", offset: [0.35, -0.25, 0.2] },
        AtomDef { atom_type: "pulse", offset: [-0.35, -0.25, 0.2] },
        AtomDef { atom_type: "pulse", offset: [0.35, -0.25, -0.2] },
        AtomDef { atom_type: "pulse", offset: [-0.35, -0.25, -0.2] },
        AtomDef { atom_type: "flex",  offset: [0.35, 0.05, 0.2] },
        AtomDef { atom_type: "flex",  offset: [-0.35, 0.05, 0.2] },
        AtomDef { atom_type: "flex",  offset: [0.35, 0.05, -0.2] },
        AtomDef { atom_type: "flex",  offset: [-0.35, 0.05, -0.2] },
    ],
    connections: &[[0, 5], [0, 6], [0, 7], [0, 8], [5, 1], [6, 2], [7, 3], [8, 4]],
};

const TRACKER: MachineDef = MachineDef {
    atoms: &[
        AtomDef { atom_type: "sense", offset: [0.0, 0.0, 0.3] },
        AtomDef { atom_type: "relay", offset: [0.0, 0.0, 0.0] },
        AtomDef { atom_type: "pulse", offset: [0.0, 0.0, -0.3] },
        AtomDef { atom_type: "flex",  offset: [0.45, -0.2, 0.0] },
        AtomDef { atom_type: "flex",  offset: [-0.45, -0.2, 0.0] },
    ],
    connections: &[[0, 1], [1, 2], [1, 3], [1, 4]],
};

const MEMORY_TOGGLE: MachineDef = MachineDef {
    atoms: &[
        AtomDef { atom_type: "sense", offset: [0.0, 0.0, 0.3] },
        AtomDef { atom_type: "relay", offset: [0.0, 0.0, 0.0] },
        AtomDef { atom_type: "hold",  offset: [0.0, 0.0, -0.3] },
    ],
    connections: &[[0, 1], [1, 2]],
};

const SIGNAL_CHAIN: MachineDef = MachineDef {
    atoms: &[
        AtomDef { atom_type: "pulse", offset: [-0.8, 0.0, 0.0] },
        AtomDef { atom_type: "relay", offset: [-0.27, 0.0, 0.0] },
        AtomDef { atom_type: "relay", offset: [0.27, 0.0, 0.0] },
        AtomDef { atom_type: "relay", offset: [0.8, 0.0, 0.0] },
    ],
    connections: &[[0, 1], [1, 2], [2, 3]],
};

const REFLEX_ARC: MachineDef = MachineDef {
    atoms: &[
        AtomDef { atom_type: "sense", offset: [0.0, 0.0, 0.55] },
        AtomDef { atom_type: "relay", offset: [0.0, 0.0, 0.0] },
        AtomDef { atom_type: "pulse", offset: [0.0, 0.0, -0.55] },
        AtomDef { atom_type: "flex",  offset: [0.0, -0.4, -0.55] },
        AtomDef { atom_type: "flex",  offset: [0.35, -0.3, 0.0] },
        AtomDef { atom_type: "flex",  offset: [-0.35, -0.3, 0.0] },
    ],
    connections: &[[0, 1], [1, 2], [2, 3], [1, 4], [1, 5]],
};

const CRAWLER: MachineDef = MachineDef {
    atoms: &[
        AtomDef { atom_type: "sense", offset: [0.0, 0.15, 0.7] },
        AtomDef { atom_type: "relay", offset: [0.0, 0.0, 0.35] },
        AtomDef { atom_type: "hold",  offset: [0.0, 0.0, 0.0] },
        AtomDef { atom_type: "pulse", offset: [0.3, 0.0, -0.35] },
        AtomDef { atom_type: "pulse", offset: [-0.3, 0.0, -0.35] },
        AtomDef { atom_type: "flex",  offset: [0.5, -0.3, 0.2] },
        AtomDef { atom_type: "flex",  offset: [-0.5, -0.3, 0.2] },
        AtomDef { atom_type: "flex",  offset: [0.5, -0.3, -0.3] },
        AtomDef { atom_type: "flex",  offset: [-0.5, -0.3, -0.3] },
    ],
    connections: &[[0, 1], [1, 2], [2, 3], [2, 4], [1, 5], [1, 6], [3, 7], [4, 8]],
};

fn get_machine(name: &str) -> Option<&'static MachineDef> {
    match name {
        "oscillator"    => Some(&OSCILLATOR),
        "walker"        => Some(&WALKER),
        "tracker"       => Some(&TRACKER),
        "memory_toggle" => Some(&MEMORY_TOGGLE),
        "signal_chain"  => Some(&SIGNAL_CHAIN),
        "reflex_arc"    => Some(&REFLEX_ARC),
        "crawler"       => Some(&CRAWLER),
        _ => None,
    }
}

#[reducer]
pub fn spawn_machine(ctx: &ReducerContext, machine_type: String, x: f32, y: f32, z: f32) {
    let Some(machine) = get_machine(&machine_type) else {
        log::warn!("Unknown machine type: {}", machine_type);
        return;
    };

    let mut ids: Vec<u64> = Vec::with_capacity(machine.atoms.len());
    for def in machine.atoms {
        let id = insert_atom(ctx, def.atom_type, x + def.offset[0], y + def.offset[1], z + def.offset[2]);
        ids.push(id);
    }

    for &[from_idx, to_idx] in machine.connections {
        insert_connection(ctx, ids[from_idx], ids[to_idx], 0, 0);
    }
}

#[reducer]
pub fn clear_arena(ctx: &ReducerContext) {
    let atoms: Vec<Atom> = ctx.db.atom().iter().collect();
    for atom in atoms {
        ctx.db.atom().id().delete(atom.id);
    }
    let conns: Vec<Connection> = ctx.db.connection().iter().collect();
    for conn in conns {
        ctx.db.connection().id().delete(conn.id);
    }
    let sigs: Vec<Signal> = ctx.db.signal().iter().collect();
    for sig in sigs {
        ctx.db.signal().id().delete(sig.id);
    }
}
