import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PushParams, AtomInstance } from '../types';
import { ATOM_COLORS, ATOM_EMISSIVE } from '../types';
import { playPop, playHum } from '../audio';

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const CONE_RADIUS = 0.2;
const CONE_HEIGHT = 0.5;

let sharedGeo: THREE.BufferGeometry | null = null;

function getGeometry(): THREE.BufferGeometry {
  if (!sharedGeo) {
    sharedGeo = new THREE.ConeGeometry(CONE_RADIUS, CONE_HEIGHT, 12, 1);
    sharedGeo.rotateX(Math.PI / 2); // tip points along +Z
  }
  return sharedGeo;
}

// ---------------------------------------------------------------------------
// Exhaust particles
// ---------------------------------------------------------------------------

const MAX_PARTICLES = 30;

export interface PushParticles {
  instancedMesh: THREE.InstancedMesh;
  velocities: Float32Array;
  lifetimes: Float32Array;
  positions: Float32Array;
}

export function createParticles(scene: THREE.Scene): PushParticles {
  const geo = new THREE.SphereGeometry(0.04, 6, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.7 });
  const instancedMesh = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES);
  instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const dummy = new THREE.Matrix4().makeTranslation(0, -100, 0);
  for (let i = 0; i < MAX_PARTICLES; i++) instancedMesh.setMatrixAt(i, dummy);
  instancedMesh.instanceMatrix.needsUpdate = true;
  scene.add(instancedMesh);
  return {
    instancedMesh,
    velocities: new Float32Array(MAX_PARTICLES * 3),
    lifetimes: new Float32Array(MAX_PARTICLES),
    positions: new Float32Array(MAX_PARTICLES * 3),
  };
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

let nextId = 20000;

export interface PushAtom extends AtomInstance {
  particles: PushParticles;
  /** Current ramped force multiplier (0→1, driven by responsiveness) */
  rampedForce: number;
  /** Stop function for continuous hum sound */
  stopHum: (() => void) | null;
  /** Is hum currently playing */
  humming: boolean;
}

export function spawnPush(
  params: PushParams,
  position: THREE.Vector3,
  scene: THREE.Scene,
  world: RAPIER.World,
  rapier: typeof import('@dimforge/rapier3d-compat').default,
): PushAtom {
  const geo = getGeometry();
  const mat = new THREE.MeshPhysicalMaterial({
    color: ATOM_COLORS.push, roughness: 0.3, metalness: 0.5,
    emissive: ATOM_EMISSIVE.push, emissiveIntensity: 1.0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  scene.add(mesh);

  const bodyDesc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(position.x, position.y, position.z)
    .setLinearDamping(0.1).setAngularDamping(0.3);
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = rapier.ColliderDesc.cone(CONE_HEIGHT / 2, CONE_RADIUS)
    .setDensity(0.8).setRestitution(0.3).setFriction(0.4);
  const collider = world.createCollider(colliderDesc, body);

  const particles = createParticles(scene);

  return {
    id: nextId++, kind: 'push', params, mesh, body, collider,
    connections: [], active: true, cooldownRemaining: 0, phase: 0,
    particles, rampedForce: 0, stopHum: null, humming: false,
  };
}

// ---------------------------------------------------------------------------
// Update: force + responsiveness ramp + sound per mode + particles
// ---------------------------------------------------------------------------

const BURST_PERIOD = 1.5;
const OSCILLATE_FREQUENCY = 2;

export function updatePush(atom: AtomInstance & { particles?: PushParticles; rampedForce?: number; stopHum?: (() => void) | null; humming?: boolean }, time: number, dt: number) {
  const params = atom.params as PushParams;
  const dir = params.direction;
  const pushAtom = atom as PushAtom;

  // Target force multiplier based on mode
  let targetMul = 0;
  if (atom.active) {
    switch (params.mode) {
      case 'continuous':
        targetMul = 1;
        break;
      case 'burst': {
        const inBurst = (time % BURST_PERIOD) < 0.1;
        targetMul = inBurst ? 5 : 0;
        if (inBurst && !atom.phase) playPop(params.magnitude / 50);
        atom.phase = inBurst ? 1 : 0;
        break;
      }
      case 'oscillating':
        targetMul = Math.sin(time * OSCILLATE_FREQUENCY * Math.PI * 2) * 0.5 + 0.5;
        break;
      case 'spin':
        targetMul = 1; // Spin uses torque but same ramp logic
        break;
    }
  }

  // Responsiveness ramp: 0 = instant, 1 = slow (5-second ramp)
  const rampSpeed = params.responsiveness > 0 ? (1 / (params.responsiveness * 5)) : 100;
  const prev = pushAtom.rampedForce ?? 0;
  const ramped = prev + (targetMul - prev) * Math.min(rampSpeed * dt, 1);
  pushAtom.rampedForce = ramped;

  // Sound: continuous/spin hum, oscillating whoosh
  if (params.mode === 'continuous' || params.mode === 'spin' || params.mode === 'oscillating') {
    if (ramped > 0.05 && !pushAtom.humming) {
      const freq = params.mode === 'spin' ? 80 : 120;
      pushAtom.stopHum = playHum(freq, ramped * 0.08);
      pushAtom.humming = true;
    } else if (ramped < 0.02 && pushAtom.humming && pushAtom.stopHum) {
      pushAtom.stopHum();
      pushAtom.stopHum = null;
      pushAtom.humming = false;
    }
  }

  // Apply force
  if (params.mode === 'spin') {
    const mag = params.magnitude * ramped * 0.1;
    atom.body.applyTorqueImpulse(
      { x: dir[0] * mag, y: dir[1] * mag, z: dir[2] * mag }, true,
    );
  } else {
    const mag = params.magnitude * ramped;
    if (mag > 0.01) {
      const rot = atom.body.rotation();
      const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
      const worldDir = new THREE.Vector3(dir[0], dir[1], dir[2]).applyQuaternion(q);

      atom.body.applyImpulse(
        { x: worldDir.x * mag * dt, y: worldDir.y * mag * dt, z: worldDir.z * mag * dt }, true,
      );

      if (atom.particles) {
        emitParticle(atom.particles, atom.body.translation(), worldDir, mag);
      }
    }
  }

  // Update particles
  if (atom.particles) updateParticles(atom.particles, dt);

  // Emissive pulse
  const mat = atom.mesh.material as THREE.MeshPhysicalMaterial;
  mat.emissiveIntensity = 0.5 + ramped * 1.5;
}

// ---------------------------------------------------------------------------
// Particle helpers
// ---------------------------------------------------------------------------

let particleIdx = 0;
const dummy = new THREE.Matrix4();

function emitParticle(p: PushParticles, pos: { x: number; y: number; z: number }, dir: THREE.Vector3, mag: number) {
  const i = particleIdx % MAX_PARTICLES;
  particleIdx++;
  const spread = 0.15;
  p.positions[i * 3 + 0] = pos.x;
  p.positions[i * 3 + 1] = pos.y;
  p.positions[i * 3 + 2] = pos.z;
  p.velocities[i * 3 + 0] = -dir.x * mag * 0.02 + (Math.random() - 0.5) * spread;
  p.velocities[i * 3 + 1] = -dir.y * mag * 0.02 + (Math.random() - 0.5) * spread;
  p.velocities[i * 3 + 2] = -dir.z * mag * 0.02 + (Math.random() - 0.5) * spread;
  p.lifetimes[i] = 1.0;
}

function updateParticles(p: PushParticles, dt: number) {
  let needsUpdate = false;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (p.lifetimes[i] <= 0) continue;
    needsUpdate = true;
    p.lifetimes[i] -= dt * 2;
    p.positions[i * 3 + 0] += p.velocities[i * 3 + 0] * dt;
    p.positions[i * 3 + 1] += p.velocities[i * 3 + 1] * dt;
    p.positions[i * 3 + 2] += p.velocities[i * 3 + 2] * dt;
    const scale = Math.max(p.lifetimes[i], 0);
    dummy.makeScale(scale, scale, scale);
    dummy.setPosition(p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]);
    p.instancedMesh.setMatrixAt(i, dummy);
  }
  if (needsUpdate) p.instancedMesh.instanceMatrix.needsUpdate = true;
}
