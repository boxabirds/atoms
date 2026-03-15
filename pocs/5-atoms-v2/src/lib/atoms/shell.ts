import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { ShellParams, ShellShape, AtomInstance } from '../types';
import { ATOM_COLORS, ATOM_EMISSIVE } from '../types';
import { playImpact } from '../audio';

// ---------------------------------------------------------------------------
// Geometry cache
// ---------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();

function getGeometry(shape: ShellShape, size: number): THREE.BufferGeometry {
  const key = `${shape}-${size.toFixed(2)}`;
  let geo = geoCache.get(key);
  if (geo) return geo;

  const s = size;
  switch (shape) {
    case 'box':
      geo = new THREE.BoxGeometry(s, s, s, 4, 4, 4);
      break;
    case 'sphere':
      geo = new THREE.SphereGeometry(s * 0.5, 24, 24);
      break;
    case 'cylinder':
      geo = new THREE.CylinderGeometry(s * 0.4, s * 0.4, s, 24, 4);
      break;
    case 'wedge': {
      // Right-triangle cross-section extruded: a triangular prism
      const shape2 = new THREE.Shape();
      const hs = s / 2;
      shape2.moveTo(-hs, -hs);
      shape2.lineTo(hs, -hs);
      shape2.lineTo(-hs, hs);
      shape2.closePath();
      const extrudeSettings = { depth: s, bevelEnabled: false };
      geo = new THREE.ExtrudeGeometry(shape2, extrudeSettings);
      geo.translate(0, 0, -s / 2);
      break;
    }
    case 'plate':
      geo = new THREE.BoxGeometry(s, s * 0.2, s, 4, 1, 4);
      break;
  }
  geoCache.set(key, geo);
  return geo;
}

function createCollider(
  rapier: typeof import('@dimforge/rapier3d-compat').default,
  shape: ShellShape,
  size: number,
  density: number,
): RAPIER.ColliderDesc {
  const s = size;
  let desc: RAPIER.ColliderDesc;
  switch (shape) {
    case 'box':
      desc = rapier.ColliderDesc.cuboid(s / 2, s / 2, s / 2);
      break;
    case 'sphere':
      desc = rapier.ColliderDesc.ball(s * 0.5);
      break;
    case 'cylinder':
      desc = rapier.ColliderDesc.cylinder(s / 2, s * 0.4);
      break;
    case 'wedge':
      // Approximate wedge as a box collider (convex hull would be better but expensive)
      desc = rapier.ColliderDesc.cuboid(s / 2, s / 2, s / 2);
      break;
    case 'plate':
      desc = rapier.ColliderDesc.cuboid(s / 2, s * 0.1, s / 2);
      break;
  }
  desc.setDensity(density).setRestitution(0.4).setFriction(0.6);
  // Contact event for impact sound
  desc.setActiveEvents(rapier.ActiveEvents.COLLISION_EVENTS);
  return desc;
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

let nextId = 1;

export function spawnShell(
  params: ShellParams,
  position: THREE.Vector3,
  scene: THREE.Scene,
  world: RAPIER.World,
  rapier: typeof import('@dimforge/rapier3d-compat').default,
): AtomInstance {
  const geo = getGeometry(params.shape, params.size);
  const mat = new THREE.MeshPhysicalMaterial({
    color: ATOM_COLORS.shell,
    roughness: 0.6,
    metalness: 0.1,
    emissive: ATOM_EMISSIVE.shell,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  scene.add(mesh);

  const bodyDesc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(position.x, position.y, position.z)
    .setLinearDamping(0.3)
    .setAngularDamping(0.5);
  const body = world.createRigidBody(bodyDesc);
  const collider = world.createCollider(
    createCollider(rapier, params.shape, params.size, params.density),
    body,
  );

  return {
    id: nextId++,
    kind: 'shell',
    params,
    mesh,
    body,
    collider,
    connections: [],
    active: false,
    cooldownRemaining: 0,
    phase: 0,
  };
}

// ---------------------------------------------------------------------------
// Runtime param update: rebuild geometry + collider when params change
// ---------------------------------------------------------------------------

export function applyShellParams(
  atom: AtomInstance,
  world: RAPIER.World,
  rapier: typeof import('@dimforge/rapier3d-compat').default,
) {
  const p = atom.params as ShellParams;

  // Update mesh geometry
  atom.mesh.geometry = getGeometry(p.shape, p.size);

  // Rebuild collider with new shape/size/density
  world.removeCollider(atom.collider, false);
  atom.collider = world.createCollider(
    createCollider(rapier, p.shape, p.size, p.density),
    atom.body,
  );
}

// ---------------------------------------------------------------------------
// Per-frame update
// ---------------------------------------------------------------------------

const BREATHE_AMPLITUDE = 0.015;
const BREATHE_SPEED = 1.5;

/** Squash-stretch on impact: tracks previous velocity for collision detection */
const impactStates = new Map<number, { prevVelY: number; squashTimer: number }>();

export function updateShell(atom: AtomInstance, time: number, dt: number) {
  // Idle breathing
  const breathe = 1 + Math.sin(time * BREATHE_SPEED + atom.id) * BREATHE_AMPLITUDE;

  // Impact squash-stretch
  let state = impactStates.get(atom.id);
  if (!state) {
    state = { prevVelY: 0, squashTimer: 0 };
    impactStates.set(atom.id, state);
  }

  const vel = atom.body.linvel();
  const IMPACT_VEL_THRESHOLD = 2;
  // Detect ground hit: was falling, now stopped/reversed
  if (state.prevVelY < -IMPACT_VEL_THRESHOLD && vel.y > state.prevVelY * 0.3) {
    const impactForce = Math.abs(state.prevVelY);
    state.squashTimer = 0.2;
    // Sound
    const pitch = 60 + (1 / (atom.params as ShellParams).density) * 40;
    playImpact(Math.min(impactForce / 10, 1), pitch);
  }
  state.prevVelY = vel.y;

  if (state.squashTimer > 0) {
    state.squashTimer -= dt;
    const t = state.squashTimer / 0.2;
    const squash = 1 - t * 0.15;
    const stretch = 1 + t * 0.1;
    atom.mesh.scale.set(stretch * breathe, squash * breathe, stretch * breathe);
  } else {
    atom.mesh.scale.setScalar(breathe);
  }
}
