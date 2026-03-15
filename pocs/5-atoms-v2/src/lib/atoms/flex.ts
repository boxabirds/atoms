import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { FlexParams, AtomInstance } from '../types';
import { ATOM_COLORS, ATOM_EMISSIVE } from '../types';
import { playCreak } from '../audio';

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const CONNECTOR_RADIUS = 0.12;
const CONNECTOR_LENGTH = 0.35;

let sharedGeo: THREE.BufferGeometry | null = null;

function getGeometry(): THREE.BufferGeometry {
  if (!sharedGeo) {
    sharedGeo = new THREE.CapsuleGeometry(CONNECTOR_RADIUS, CONNECTOR_LENGTH, 8, 12);
  }
  return sharedGeo;
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

let nextId = 10000;

export function spawnFlex(
  params: FlexParams,
  position: THREE.Vector3,
  scene: THREE.Scene,
  world: RAPIER.World,
  rapier: typeof import('@dimforge/rapier3d-compat').default,
): AtomInstance {
  const geo = getGeometry();
  const mat = new THREE.MeshPhysicalMaterial({
    color: ATOM_COLORS.flex,
    roughness: 0.3,
    metalness: 0.4,
    emissive: ATOM_EMISSIVE.flex,
    emissiveIntensity: 0.5,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  scene.add(mesh);

  const bodyDesc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(position.x, position.y, position.z)
    .setLinearDamping(0.2)
    .setAngularDamping(0.3);
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = rapier.ColliderDesc.capsule(CONNECTOR_LENGTH / 2, CONNECTOR_RADIUS)
    .setDensity(1.0)
    .setRestitution(0.3)
    .setFriction(0.5);
  const collider = world.createCollider(colliderDesc, body);

  return {
    id: nextId++,
    kind: 'flex',
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
// Bridge: create a joint between two existing atoms
// Wire stiffness, damping, and angle limits into the Rapier joint
// ---------------------------------------------------------------------------

export function bridgeFlex(
  flexAtom: AtomInstance,
  atomA: AtomInstance,
  atomB: AtomInstance,
  world: RAPIER.World,
  rapier: typeof import('@dimforge/rapier3d-compat').default,
) {
  const params = flexAtom.params as FlexParams;

  const posA = atomA.body.translation();
  const posB = atomB.body.translation();
  const mid = { x: (posA.x + posB.x) / 2, y: (posA.y + posB.y) / 2, z: (posA.z + posB.z) / 2 };

  const anchorA = { x: mid.x - posA.x, y: mid.y - posA.y, z: mid.z - posA.z };
  const anchorB = { x: mid.x - posB.x, y: mid.y - posB.y, z: mid.z - posB.z };

  let joint: RAPIER.ImpulseJoint;

  if (params.dof === 1) {
    // Revolute (hinge) around Y axis
    const jointData = rapier.JointData.revolute(anchorA, anchorB, { x: 0, y: 1, z: 0 });
    joint = world.createImpulseJoint(jointData, atomA.body, atomB.body, true);

    // Wire angle limits
    const rev = joint as RAPIER.RevoluteImpulseJoint;
    if (params.angleLimit < Math.PI) {
      rev.setLimits(-params.angleLimit, params.angleLimit);
    }

    // Wire motor for spring behavior (stiffness + damping)
    if (params.stiffness > 0) {
      rev.configureMotorModel(rapier.MotorModel.ForceBased);
      rev.configureMotorPosition(0, params.stiffness, params.damping);
    }
  } else if (params.dof === 2) {
    // Universal joint (2-DOF): two revolute joints stacked
    // Rapier doesn't have a native universal joint, so use a generic joint
    // with two free rotational axes (Y and Z), locking twist (X)
    // Approximate with spherical + high angular damping on the twist axis
    const jointData = rapier.JointData.spherical(anchorA, anchorB);
    joint = world.createImpulseJoint(jointData, atomA.body, atomB.body, true);
    // Lock twist by applying strong angular damping on the X axis in updateFlex
  } else {
    // Ball joint (3-DOF) — spherical
    const jointData = rapier.JointData.spherical(anchorA, anchorB);
    joint = world.createImpulseJoint(jointData, atomA.body, atomB.body, true);
  }

  flexAtom.joint = joint;
  flexAtom.bridgedAtoms = [atomA.id, atomB.id];
  flexAtom.body.setTranslation(mid, true);
}

// ---------------------------------------------------------------------------
// Runtime: reapply params when sliders change
// ---------------------------------------------------------------------------

export function applyFlexParams(
  atom: AtomInstance,
  _world: RAPIER.World,
  rapier: typeof import('@dimforge/rapier3d-compat').default,
) {
  const params = atom.params as FlexParams;
  const joint = atom.joint;
  if (!joint) return;

  if (params.dof === 1) {
    const rev = joint as RAPIER.RevoluteImpulseJoint;
    if (params.angleLimit < Math.PI) {
      rev.setLimits(-params.angleLimit, params.angleLimit);
    }
    if (params.stiffness > 0) {
      rev.configureMotorModel(rapier.MotorModel.ForceBased);
      rev.configureMotorPosition(0, params.stiffness, params.damping);
    }
  }
}

// ---------------------------------------------------------------------------
// Update: stress indicator + stiffness spring for ball joints + creak sound
// ---------------------------------------------------------------------------

/** Creak sound cooldown to avoid spamming */
const creakCooldowns = new Map<number, number>();

export function updateFlex(atom: AtomInstance, time: number, dt: number, allAtoms?: AtomInstance[]) {
  if (!atom.bridgedAtoms) return;

  const params = atom.params as FlexParams;

  // For universal joints (dof=2), suppress twist by damping X-axis rotation
  if (params.dof === 2 && allAtoms) {
    const a = allAtoms.find((at) => at.id === atom.bridgedAtoms![0]);
    const b = allAtoms.find((at) => at.id === atom.bridgedAtoms![1]);
    if (a && b) {
      const TWIST_SUPPRESS = 5;
      const relTwist = b.body.angvel().x - a.body.angvel().x;
      b.body.applyTorqueImpulse({ x: -relTwist * TWIST_SUPPRESS * dt, y: 0, z: 0 }, true);
    }
  }

  // For ball/universal joints (dof>=2), apply manual spring torque
  if (params.dof >= 2 && params.stiffness > 0 && allAtoms) {
    const a = allAtoms.find((at) => at.id === atom.bridgedAtoms![0]);
    const b = allAtoms.find((at) => at.id === atom.bridgedAtoms![1]);
    if (a && b) {
      // Simple angular spring: apply restoring torque proportional to relative rotation
      const relAngvel = {
        x: b.body.angvel().x - a.body.angvel().x,
        y: b.body.angvel().y - a.body.angvel().y,
        z: b.body.angvel().z - a.body.angvel().z,
      };
      const dampForce = params.damping * 0.1;
      b.body.applyTorqueImpulse({
        x: -relAngvel.x * dampForce * dt,
        y: -relAngvel.y * dampForce * dt,
        z: -relAngvel.z * dampForce * dt,
      }, true);
    }
  }

  // Stress visual + creak sound
  const angvel = atom.body.angvel();
  const speed = Math.sqrt(angvel.x ** 2 + angvel.y ** 2 + angvel.z ** 2);
  const stress = Math.min(speed / 5, 1);
  const mat = atom.mesh.material as THREE.MeshPhysicalMaterial;
  mat.emissiveIntensity = 0.3 + stress * 2;

  // Creak sound at high stress (throttled)
  let cd = creakCooldowns.get(atom.id) ?? 0;
  cd -= dt;
  if (stress > 0.4 && cd <= 0) {
    playCreak(stress);
    cd = 0.3 + Math.random() * 0.2;
  }
  creakCooldowns.set(atom.id, cd);

  // Active state: if Sense signals this Flex, stiffen temporarily
  if (atom.active && params.dof === 1 && atom.joint) {
    const rev = atom.joint as RAPIER.RevoluteImpulseJoint;
    // Double stiffness when active (adaptive suspension from brief)
    const boostStiffness = params.stiffness * 2;
    rev.configureMotorPosition(0, boostStiffness, params.damping * 1.5);
  }
}
