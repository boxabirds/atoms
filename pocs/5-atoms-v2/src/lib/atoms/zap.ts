import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { ZapParams, AtomInstance } from '../types';
import { ATOM_COLORS, ATOM_EMISSIVE } from '../types';
import { playZapFire, playPop } from '../audio';

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const CRYSTAL_RADIUS = 0.22;

let sharedGeo: THREE.BufferGeometry | null = null;

function getGeometry(): THREE.BufferGeometry {
  if (!sharedGeo) sharedGeo = new THREE.OctahedronGeometry(CRYSTAL_RADIUS, 0);
  return sharedGeo;
}

// ---------------------------------------------------------------------------
// Projectile pool
// ---------------------------------------------------------------------------

const MAX_PROJECTILES = 20;
const PROJECTILE_SPEED = 12;
const PROJECTILE_LIFETIME = 2;

interface Projectile {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  lifetime: number;
}

function spawnProjectile(
  scene: THREE.Scene,
  world: RAPIER.World,
  rapier: typeof import('@dimforge/rapier3d-compat').default,
  origin: { x: number; y: number; z: number },
  direction: THREE.Vector3,
  intensity: number,
): Projectile {
  const geo = new THREE.SphereGeometry(0.08, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color: ATOM_COLORS.zap, transparent: true, opacity: 0.9 });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);

  const bodyDesc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(origin.x, origin.y, origin.z)
    .setLinearDamping(0).setGravityScale(0.1);
  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = rapier.ColliderDesc.ball(0.08).setDensity(0.5).setRestitution(0.8);
  world.createCollider(colliderDesc, body);

  const vel = direction.clone().multiplyScalar(PROJECTILE_SPEED * (intensity / 25));
  body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);

  return { mesh, body, lifetime: PROJECTILE_LIFETIME };
}

// ---------------------------------------------------------------------------
// Impact flash VFX — short-lived expanding ring at projectile death
// ---------------------------------------------------------------------------

interface ImpactFlash {
  mesh: THREE.Mesh;
  lifetime: number;
}

const impactFlashes: ImpactFlash[] = [];

function spawnImpactFlash(scene: THREE.Scene, pos: { x: number; y: number; z: number }) {
  const geo = new THREE.RingGeometry(0.05, 0.15, 16);
  const mat = new THREE.MeshBasicMaterial({
    color: ATOM_COLORS.zap, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(pos.x, pos.y, pos.z);
  mesh.lookAt(pos.x, pos.y + 1, pos.z); // face upward
  scene.add(mesh);
  impactFlashes.push({ mesh, lifetime: 0.3 });
}

function updateImpactFlashes(scene: THREE.Scene, dt: number) {
  for (let i = impactFlashes.length - 1; i >= 0; i--) {
    const f = impactFlashes[i];
    f.lifetime -= dt;
    if (f.lifetime <= 0) {
      scene.remove(f.mesh);
      f.mesh.geometry.dispose();
      (f.mesh.material as THREE.Material).dispose();
      impactFlashes.splice(i, 1);
      continue;
    }
    // Expand ring
    const t = 1 - f.lifetime / 0.3;
    const scale = 1 + t * 4;
    f.mesh.scale.setScalar(scale);
    (f.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.8;
  }
}

// ---------------------------------------------------------------------------
// Push-field visualization: expanding pulse ring
// ---------------------------------------------------------------------------

interface PulseRing {
  mesh: THREE.Mesh;
  lifetime: number;
}

const pulseRings: PulseRing[] = [];

function spawnPulseRing(scene: THREE.Scene, pos: { x: number; y: number; z: number }, range: number) {
  const geo = new THREE.RingGeometry(0.1, 0.2, 32);
  const mat = new THREE.MeshBasicMaterial({
    color: ATOM_COLORS.zap, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(pos.x, pos.y, pos.z);
  mesh.rotation.x = -Math.PI / 2;
  scene.add(mesh);
  pulseRings.push({ mesh, lifetime: 0.5 });
}

function updatePulseRings(scene: THREE.Scene, dt: number, range: number) {
  for (let i = pulseRings.length - 1; i >= 0; i--) {
    const r = pulseRings[i];
    r.lifetime -= dt;
    if (r.lifetime <= 0) {
      scene.remove(r.mesh);
      r.mesh.geometry.dispose();
      (r.mesh.material as THREE.Material).dispose();
      pulseRings.splice(i, 1);
      continue;
    }
    const t = 1 - r.lifetime / 0.5;
    const scale = t * range;
    r.mesh.scale.setScalar(scale);
    (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.3;
  }
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

let nextId = 40000;

export interface ZapAtom extends AtomInstance {
  projectiles: Projectile[];
  scene: THREE.Scene;
  world: RAPIER.World;
  rapier: typeof import('@dimforge/rapier3d-compat').default;
}

export function spawnZap(
  params: ZapParams,
  position: THREE.Vector3,
  scene: THREE.Scene,
  world: RAPIER.World,
  rapier: typeof import('@dimforge/rapier3d-compat').default,
): ZapAtom {
  const geo = getGeometry();
  const mat = new THREE.MeshPhysicalMaterial({
    color: ATOM_COLORS.zap, roughness: 0.1, metalness: 0.6,
    emissive: ATOM_EMISSIVE.zap, emissiveIntensity: 1.0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  scene.add(mesh);

  const bodyDesc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(position.x, position.y, position.z)
    .setLinearDamping(0.4).setAngularDamping(0.5);
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = rapier.ColliderDesc.ball(CRYSTAL_RADIUS)
    .setDensity(1.2).setRestitution(0.4).setFriction(0.3);
  const collider = world.createCollider(colliderDesc, body);

  return {
    id: nextId++, kind: 'zap', params, mesh, body, collider,
    connections: [], active: true, cooldownRemaining: 0, phase: 0,
    projectiles: [], scene, world, rapier,
  };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

const CRYSTAL_SPIN = 1.5;

export function updateZap(atom: ZapAtom, allAtoms: AtomInstance[], time: number, dt: number) {
  const params = atom.params as ZapParams;
  const pos = atom.body.translation();

  atom.mesh.rotation.y = time * CRYSTAL_SPIN;
  atom.mesh.rotation.x = Math.sin(time * 0.8) * 0.3;

  atom.cooldownRemaining = Math.max(0, atom.cooldownRemaining - dt);

  if (atom.active && atom.cooldownRemaining <= 0) {
    switch (params.effect) {
      case 'projectile':
        fireProjectile(atom, pos);
        break;
      case 'push-field':
        applyPushField(atom, allAtoms, pos, params);
        spawnPulseRing(atom.scene, pos, params.range);
        break;
      case 'grab':
        applyGrab(atom, allAtoms, pos, params);
        break;
      case 'damage-zone':
        applyDamageZone(atom, allAtoms, pos, params);
        break;
      case 'heal':
        applyHeal(atom, allAtoms, pos, params);
        break;
      case 'emit-particles':
        emitParticleBurst(atom, pos, params);
        break;
    }
    atom.cooldownRemaining = params.cooldown;
  }

  updateProjectiles(atom, dt);
  updateImpactFlashes(atom.scene, dt);
  updatePulseRings(atom.scene, dt, params.range);

  const mat = atom.mesh.material as THREE.MeshPhysicalMaterial;
  const pulse = atom.cooldownRemaining > 0 ? 0.5 : 1.0 + Math.sin(time * 4) * 0.5;
  mat.emissiveIntensity = pulse;
}

// ---------------------------------------------------------------------------
// Effect implementations with shape support
// ---------------------------------------------------------------------------

function getFireDirection(atom: ZapAtom, params: ZapParams): THREE.Vector3 {
  const rot = atom.body.rotation();
  const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
  return new THREE.Vector3(0, 0.3, -1).applyQuaternion(q).normalize();
}

function isInShape(
  params: ZapParams,
  sourcePos: { x: number; y: number; z: number },
  targetPos: { x: number; y: number; z: number },
  forward: THREE.Vector3,
  dist: number,
): boolean {
  if (dist > params.range) return false;
  switch (params.shape) {
    case 'sphere':
      return true; // Already checked range
    case 'cone': {
      const toTarget = new THREE.Vector3(
        targetPos.x - sourcePos.x,
        targetPos.y - sourcePos.y,
        targetPos.z - sourcePos.z,
      ).normalize();
      return forward.dot(toTarget) > 0.5; // ~60° cone
    }
    case 'beam': {
      const toTarget = new THREE.Vector3(
        targetPos.x - sourcePos.x,
        targetPos.y - sourcePos.y,
        targetPos.z - sourcePos.z,
      );
      const along = toTarget.dot(forward);
      if (along < 0) return false;
      const perpSq = toTarget.lengthSq() - along * along;
      return perpSq < 0.5 * 0.5;
    }
    case 'targeted':
      // Targeted always hits — it auto-aims at everything in range
      return true;
  }
}

function fireProjectile(atom: ZapAtom, pos: { x: number; y: number; z: number }) {
  const params = atom.params as ZapParams;
  if (atom.projectiles.length >= MAX_PROJECTILES) return;
  const dir = getFireDirection(atom, params);
  const proj = spawnProjectile(atom.scene, atom.world, atom.rapier, pos, dir, params.intensity);
  atom.projectiles.push(proj);
  playZapFire(params.intensity / 25);
}

function applyPushField(atom: ZapAtom, allAtoms: AtomInstance[], pos: { x: number; y: number; z: number }, params: ZapParams) {
  const forward = getFireDirection(atom, params);
  for (const other of allAtoms) {
    if (other.id === atom.id) continue;
    const op = other.body.translation();
    const dx = op.x - pos.x, dy = op.y - pos.y, dz = op.z - pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!isInShape(params, pos, op, forward, dist)) continue;
    if (dist < 0.1) continue;
    const falloff = 1 - dist / params.range;
    const force = params.intensity * falloff * 0.5;
    other.body.applyImpulse(
      { x: (dx / dist) * force, y: (dy / dist) * force * 0.5, z: (dz / dist) * force }, true,
    );
  }
  playPop(0.3);
}

function applyGrab(atom: ZapAtom, allAtoms: AtomInstance[], pos: { x: number; y: number; z: number }, params: ZapParams) {
  const forward = getFireDirection(atom, params);
  let nearest: AtomInstance | null = null;
  let nearestDist = Infinity;
  for (const other of allAtoms) {
    if (other.id === atom.id) continue;
    const op = other.body.translation();
    const dx = op.x - pos.x, dy = op.y - pos.y, dz = op.z - pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (isInShape(params, pos, op, forward, dist) && dist < nearestDist) {
      nearestDist = dist;
      nearest = other;
    }
  }
  if (nearest && nearestDist > 0.3) {
    const op = nearest.body.translation();
    const dx = pos.x - op.x, dy = pos.y - op.y, dz = pos.z - op.z;
    const force = params.intensity * 0.3;
    nearest.body.applyImpulse(
      { x: dx / nearestDist * force, y: dy / nearestDist * force, z: dz / nearestDist * force }, true,
    );
  }
}

/** Damage zone: continuous contact-range force burst (blade/saw) */
function applyDamageZone(atom: ZapAtom, allAtoms: AtomInstance[], pos: { x: number; y: number; z: number }, params: ZapParams) {
  const DAMAGE_RANGE = 1.0; // close range only
  for (const other of allAtoms) {
    if (other.id === atom.id) continue;
    const op = other.body.translation();
    const dx = op.x - pos.x, dy = op.y - pos.y, dz = op.z - pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < DAMAGE_RANGE && dist > 0.05) {
      // Strong repulsion + upward kick (saw-like)
      const force = params.intensity * 0.8;
      other.body.applyImpulse(
        { x: (dx / dist) * force, y: force * 0.5, z: (dz / dist) * force }, true,
      );
    }
  }
  // Spin the crystal faster for damage zone visual
  atom.mesh.rotation.y += 0.5;
  playPop(0.5);
}

/** Heal/repair: dampen velocity of nearby atoms (stabilize them) */
function applyHeal(atom: ZapAtom, allAtoms: AtomInstance[], pos: { x: number; y: number; z: number }, params: ZapParams) {
  const forward = getFireDirection(atom, params);
  for (const other of allAtoms) {
    if (other.id === atom.id) continue;
    const op = other.body.translation();
    const dx = op.x - pos.x, dy = op.y - pos.y, dz = op.z - pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!isInShape(params, pos, op, forward, dist)) continue;

    // "Heal" = stabilize: dampen velocity, restore equilibrium
    const vel = other.body.linvel();
    const dampFactor = Math.min(params.intensity * 0.02, 0.8);
    other.body.setLinvel({
      x: vel.x * (1 - dampFactor),
      y: vel.y * (1 - dampFactor),
      z: vel.z * (1 - dampFactor),
    }, true);
    const angvel = other.body.angvel();
    other.body.setAngvel({
      x: angvel.x * (1 - dampFactor),
      y: angvel.y * (1 - dampFactor),
      z: angvel.z * (1 - dampFactor),
    }, true);
  }
}

/** Emit particles: decorative burst (no physics effect) */
function emitParticleBurst(atom: ZapAtom, pos: { x: number; y: number; z: number }, params: ZapParams) {
  const BURST_COUNT = 5;
  for (let i = 0; i < BURST_COUNT; i++) {
    const dir = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      Math.random() * 1.5,
      (Math.random() - 0.5) * 2,
    ).normalize();
    // Spawn tiny projectile-like particles with short lifetime
    if (atom.projectiles.length >= MAX_PROJECTILES) break;
    const proj = spawnProjectile(atom.scene, atom.world, atom.rapier, pos, dir, params.intensity * 0.3);
    proj.lifetime = 0.8;
    atom.projectiles.push(proj);
  }
}

// ---------------------------------------------------------------------------
// Projectile management
// ---------------------------------------------------------------------------

function updateProjectiles(atom: ZapAtom, dt: number) {
  for (let i = atom.projectiles.length - 1; i >= 0; i--) {
    const proj = atom.projectiles[i];
    proj.lifetime -= dt;
    if (proj.lifetime <= 0) {
      // Spawn impact flash at death position
      const p = proj.body.translation();
      spawnImpactFlash(atom.scene, p);
      atom.scene.remove(proj.mesh);
      atom.world.removeRigidBody(proj.body);
      atom.projectiles.splice(i, 1);
      continue;
    }
    const p = proj.body.translation();
    proj.mesh.position.set(p.x, p.y, p.z);
    (proj.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(proj.lifetime, 1);
  }
}
