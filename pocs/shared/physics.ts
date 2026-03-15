// Physics simulation — single source of truth.
// Pure math, no THREE.js dependency. Operates on plain {x, y, z} fields.
// Used by: multiplayer-1 server (directly), level-1 (via thin THREE adapter).

import {
  GRAVITY, DAMPING, GROUND_BOUNCE, GROUND_FRICTION,
  WALL_BOUNCE, VELOCITY_CAP, SPRING_K, REST_LENGTH_FACTOR,
  COLLISION_REPULSION, POSITION_CORRECTION,
  ATOM_COLLISION_RADIUS, FLEX_COLLISION_RADIUS,
  GROUND_Y, ARENA_HALF, ATOM_RADIUS, FLEX_LENGTH,
} from './constants';

// ---------------------------------------------------------------------------
// Types — minimal physics body
// ---------------------------------------------------------------------------

export interface PhysicsBody {
  id: bigint | number;
  atomType: string;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  grounded: boolean;
}

export interface PhysicsConnection {
  fromId: bigint | number;
  toId: bigint | number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getCollisionRadius(atomType: string): number {
  return atomType === 'flex' ? FLEX_COLLISION_RADIUS : ATOM_COLLISION_RADIUS;
}

export function vecLen(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/** Rotate vector (vx,vy,vz) by quaternion (qx,qy,qz,qw) */
export function quatRotate(
  qx: number, qy: number, qz: number, qw: number,
  vx: number, vy: number, vz: number,
): [number, number, number] {
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Angle between two vectors in radians */
export function vecAngle(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  const la = vecLen(ax, ay, az);
  const lb = vecLen(bx, by, bz);
  if (la < 0.001 || lb < 0.001) return Math.PI;
  const dot = (ax * bx + ay * by + az * bz) / (la * lb);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

export function getRestLength(atomTypeA: string, atomTypeB: string): number {
  const hasFlex = atomTypeA === 'flex' || atomTypeB === 'flex';
  return hasFlex ? FLEX_LENGTH * 0.7 : ATOM_RADIUS * REST_LENGTH_FACTOR;
}

// ---------------------------------------------------------------------------
// Physics step — direct port of level-1 updatePhysics()
// ---------------------------------------------------------------------------

/**
 * Run one physics tick on a set of bodies with connections.
 * Mutates bodies in-place. Ported line-for-line from level-1/index.html.
 *
 * @param bodies - mutable array of physics bodies
 * @param connections - connection pairs (fromId, toId)
 * @param dt - time step in seconds
 * @param bodyIdx - map from body id to index in bodies array
 */
export function stepPhysics(
  bodies: PhysicsBody[],
  connections: PhysicsConnection[],
  dt: number,
  bodyIdx: Map<bigint | number, number>,
): void {
  // Build per-body connection list
  const bodyConns = new Map<bigint | number, Array<bigint | number>>();
  for (const conn of connections) {
    if (!bodyConns.has(conn.fromId)) bodyConns.set(conn.fromId, []);
    if (!bodyConns.has(conn.toId)) bodyConns.set(conn.toId, []);
    bodyConns.get(conn.fromId)!.push(conn.toId);
    bodyConns.get(conn.toId)!.push(conn.fromId);
  }

  // --- Sphere-sphere collision repulsion (O(n²)) ---
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    const ra = getCollisionRadius(a.atomType);
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const rb = getCollisionRadius(b.atomType);

      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = a.z - b.z;
      const dist = vecLen(dx, dy, dz);
      const minDist = ra + rb;

      if (dist < minDist && dist > 0.001) {
        const overlap = minDist - dist;
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        const force = overlap * COLLISION_REPULSION * dt;

        a.vx += nx * force;
        a.vy += ny * force;
        a.vz += nz * force;
        b.vx -= nx * force;
        b.vy -= ny * force;
        b.vz -= nz * force;

        // Position correction to prevent sinking
        const corr = overlap * POSITION_CORRECTION * 0.5;
        a.x += nx * corr;
        a.y += ny * corr;
        a.z += nz * corr;
        b.x -= nx * corr;
        b.y -= ny * corr;
        b.z -= nz * corr;
      }
    }
  }

  // --- Per-body: gravity, damping, integration, ground, walls, springs ---
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];

    // Gravity and damping
    body.vy += GRAVITY * dt;
    body.vx *= DAMPING;
    body.vy *= DAMPING;
    body.vz *= DAMPING;

    // Integrate position
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    body.z += body.vz * dt;

    // Ground collision
    const r = getCollisionRadius(body.atomType);
    const gLevel = GROUND_Y + r;
    if (body.y < gLevel) {
      body.y = gLevel;
      body.vy = -body.vy * GROUND_BOUNCE;
      if (Math.abs(body.vy) < 0.1) body.vy = 0;
      body.grounded = true;
      body.vx *= GROUND_FRICTION;
      body.vz *= GROUND_FRICTION;
    } else {
      body.grounded = false;
    }

    // Wall bouncing
    if (body.x > ARENA_HALF - r) {
      body.x = ARENA_HALF - r;
      body.vx = -Math.abs(body.vx) * WALL_BOUNCE;
    } else if (body.x < -ARENA_HALF + r) {
      body.x = -ARENA_HALF + r;
      body.vx = Math.abs(body.vx) * WALL_BOUNCE;
    }
    if (body.z > ARENA_HALF - r) {
      body.z = ARENA_HALF - r;
      body.vz = -Math.abs(body.vz) * WALL_BOUNCE;
    } else if (body.z < -ARENA_HALF + r) {
      body.z = -ARENA_HALF + r;
      body.vz = Math.abs(body.vz) * WALL_BOUNCE;
    }

    // Velocity cap
    const speed = vecLen(body.vx, body.vy, body.vz);
    if (speed > VELOCITY_CAP) {
      const scale = VELOCITY_CAP / speed;
      body.vx *= scale;
      body.vy *= scale;
      body.vz *= scale;
    }

    // Spring constraints from connections
    const conns = bodyConns.get(body.id);
    if (conns) {
      for (const otherId of conns) {
        const j = bodyIdx.get(otherId);
        if (j === undefined) continue;
        const other = bodies[j];
        const dx = other.x - body.x;
        const dy = other.y - body.y;
        const dz = other.z - body.z;
        const dist = vecLen(dx, dy, dz);
        if (dist < 0.001) continue;

        const restLen = getRestLength(body.atomType, other.atomType);
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        const springForce = (dist - restLen) * SPRING_K * dt;
        body.vx += nx * springForce;
        body.vy += ny * springForce;
        body.vz += nz * springForce;
      }
    }
  }
}
