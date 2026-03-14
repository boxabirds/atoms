//! Atoms physics server — SpacetimeDB module with Rapier3D.
//!
//! Proof-of-concept: verify Rapier compiles and runs in SpacetimeDB's WASM sandbox.

use spacetimedb::{table, reducer, ReducerContext, Table, ScheduleAt, TimeDuration};
use rapier3d::prelude::*;
use rapier3d::math::Real;

// ---------------------------------------------------------------------------
// Constants (mirrored from client-side docs/atoms.md)
// ---------------------------------------------------------------------------

const TICK_INTERVAL_MICROS: i64 = 50_000; // 20Hz = 50ms
const GRAVITY_Y: Real = -9.8;
const GROUND_Y: Real = -2.0;
const ARENA_HALF: Real = 20.0;
const ATOM_COLLISION_RADIUS: Real = 0.24;
const GROUND_BOUNCE: Real = 0.3;
const GROUND_FRICTION: Real = 0.92;
const WALL_BOUNCE: Real = 0.5;
const VELOCITY_CAP: Real = 8.0;
const ANGULAR_VELOCITY_CAP: Real = 12.0;
const ANGULAR_DAMPING: Real = 2.0;
const DT: Real = 0.05; // 50ms tick

fn vec3(x: Real, y: Real, z: Real) -> Vector {
    Vector::new(x, y, z)
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
    pub signal_charge: f32,
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
// Tick — Rapier physics inside SpacetimeDB WASM
// ---------------------------------------------------------------------------

#[reducer]
pub fn tick_physics(ctx: &ReducerContext, _schedule: TickSchedule) {

    let Some(mut state) = ctx.db.arena_state().id().find(0) else { return };
    if state.frozen {
        return;
    }

    // Build Rapier world from current table state
    let mut rigid_body_set = RigidBodySet::new();
    let mut collider_set = ColliderSet::new();

    // Ground plane
    let ground_body = rigid_body_set.insert(RigidBodyBuilder::fixed().translation(vec3(0.0, GROUND_Y, 0.0)));
    collider_set.insert_with_parent(
        ColliderBuilder::cuboid(ARENA_HALF, 0.1, ARENA_HALF)
            .restitution(GROUND_BOUNCE)
            .friction(GROUND_FRICTION),
        ground_body,
        &mut rigid_body_set,
    );

    // Arena walls
    for &(tx, tz, hx, hz) in &[
        (ARENA_HALF, 0.0, 0.1, ARENA_HALF),
        (-ARENA_HALF, 0.0, 0.1, ARENA_HALF),
        (0.0, ARENA_HALF, ARENA_HALF, 0.1),
        (0.0, -ARENA_HALF, ARENA_HALF, 0.1),
    ] {
        let wall = rigid_body_set.insert(RigidBodyBuilder::fixed().translation(vec3(tx, 0.0, tz)));
        collider_set.insert_with_parent(
            ColliderBuilder::cuboid(hx, 10.0, hz).restitution(WALL_BOUNCE),
            wall,
            &mut rigid_body_set,
        );
    }

    // Insert atoms as dynamic rigid bodies
    let atoms: Vec<Atom> = ctx.db.atom().iter().collect();
    let mut handles: Vec<(u64, RigidBodyHandle)> = Vec::with_capacity(atoms.len());

    for atom in &atoms {
        let quat = Rotation::from_xyzw(atom.rx, atom.ry, atom.rz, atom.rw);
        let pose = Pose::from_parts(vec3(atom.x, atom.y, atom.z), quat);
        let rb = rigid_body_set.insert(
            RigidBodyBuilder::dynamic()
                .pose(pose)
                .linvel(vec3(atom.vx, atom.vy, atom.vz))
                .angvel(vec3(atom.avx, atom.avy, atom.avz))
                .linear_damping(1.0 - 0.95_f32.powf(20.0))
                .angular_damping(ANGULAR_DAMPING)
                .ccd_enabled(true),
        );
        collider_set.insert_with_parent(
            ColliderBuilder::ball(ATOM_COLLISION_RADIUS)
                .restitution(GROUND_BOUNCE)
                .friction(0.5),
            rb,
            &mut rigid_body_set,
        );
        handles.push((atom.id, rb));
    }

    // Step Rapier
    let gravity = vec3(0.0, GRAVITY_Y, 0.0);
    let integration_parameters = IntegrationParameters { dt: DT, ..Default::default() };
    let mut island_manager = IslandManager::new();
    let mut broad_phase = DefaultBroadPhase::new();
    let mut narrow_phase = NarrowPhase::new();
    let mut impulse_joint_set = ImpulseJointSet::new();
    let mut multibody_joint_set = MultibodyJointSet::new();
    let mut ccd_solver = CCDSolver::new();

    let mut physics_pipeline = PhysicsPipeline::new();
    physics_pipeline.step(
        gravity,
        &integration_parameters,
        &mut island_manager,
        &mut broad_phase,
        &mut narrow_phase,
        &mut rigid_body_set,
        &mut collider_set,
        &mut impulse_joint_set,
        &mut multibody_joint_set,
        &mut ccd_solver,
        &(),
        &(),
    );

    // Read back positions, rotations, and velocities
    for (atom_id, handle) in &handles {
        let rb = &rigid_body_set[*handle];
        let pos = rb.translation();
        let vel = rb.linvel();
        let rot = rb.rotation();
        let angvel = rb.angvel();

        // Clamp linear velocity
        let speed = (vel.x * vel.x + vel.y * vel.y + vel.z * vel.z).sqrt();
        let (cvx, cvy, cvz) = if speed > VELOCITY_CAP {
            let scale = VELOCITY_CAP / speed;
            (vel.x * scale, vel.y * scale, vel.z * scale)
        } else {
            (vel.x, vel.y, vel.z)
        };

        // Clamp angular velocity
        let ang_speed = (angvel.x * angvel.x + angvel.y * angvel.y + angvel.z * angvel.z).sqrt();
        let (cavx, cavy, cavz) = if ang_speed > ANGULAR_VELOCITY_CAP {
            let scale = ANGULAR_VELOCITY_CAP / ang_speed;
            (angvel.x * scale, angvel.y * scale, angvel.z * scale)
        } else {
            (angvel.x, angvel.y, angvel.z)
        };

        if let Some(mut atom) = ctx.db.atom().id().find(*atom_id) {
            atom.x = pos.x;
            atom.y = pos.y;
            atom.z = pos.z;
            atom.vx = cvx;
            atom.vy = cvy;
            atom.vz = cvz;
            atom.rx = rot.x;
            atom.ry = rot.y;
            atom.rz = rot.z;
            atom.rw = rot.w;
            atom.avx = cavx;
            atom.avy = cavy;
            atom.avz = cavz;
            atom.grounded = pos.y <= GROUND_Y + ATOM_COLLISION_RADIUS + 0.01;
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

#[reducer]
pub fn add_atom(ctx: &ReducerContext, atom_type: String, x: f32, y: f32, z: f32) {
    ctx.db.atom().insert(Atom {
        id: 0,
        atom_type,
        x, y, z,
        vx: 0.0, vy: 0.0, vz: 0.0,
        rx: 0.0, ry: 0.0, rz: 0.0, rw: 1.0,
        avx: 0.0, avy: 0.0, avz: 0.0,
        grounded: false,
        signal_charge: 0.0,
    });
}

#[reducer]
pub fn toggle_freeze(ctx: &ReducerContext) {
    if let Some(mut state) = ctx.db.arena_state().id().find(0) {
        state.frozen = !state.frozen;
        ctx.db.arena_state().id().update(state);
    }
}
