import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { AtomInstance, ShellParams } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max distance between atom surfaces for auto-weld */
const SNAP_DISTANCE = 0.8;

/** Grid size for face-aligned snapping */
const FACE_GRID = 0.5;

// ---------------------------------------------------------------------------
// Face connection points: 6 faces for box-like atoms (±X, ±Y, ±Z)
// ---------------------------------------------------------------------------

const FACE_NORMALS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];

/** Find the best face-aligned connection between two atoms.
 * Returns the face normal of the closest pair, or null if too far. */
function findBestFaceConnection(
  posA: { x: number; y: number; z: number },
  posB: { x: number; y: number; z: number },
  sizeA: number,
  sizeB: number,
): THREE.Vector3 | null {
  const dx = posB.x - posA.x;
  const dy = posB.y - posA.y;
  const dz = posB.z - posA.z;

  // Find which axis has the largest absolute separation
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);

  let faceNormal: THREE.Vector3;
  if (ax >= ay && ax >= az) {
    faceNormal = new THREE.Vector3(Math.sign(dx), 0, 0);
  } else if (ay >= ax && ay >= az) {
    faceNormal = new THREE.Vector3(0, Math.sign(dy), 0);
  } else {
    faceNormal = new THREE.Vector3(0, 0, Math.sign(dz));
  }

  return faceNormal;
}

// ---------------------------------------------------------------------------
// Auto-weld with face-aligned snapping
// ---------------------------------------------------------------------------

export function tryAutoConnect(
  newAtom: AtomInstance,
  allAtoms: AtomInstance[],
  world: RAPIER.World,
  rapier: typeof import('@dimforge/rapier3d-compat').default,
): AtomInstance | null {
  const newPos = newAtom.body.translation();
  let closest: AtomInstance | null = null;
  let closestDist = SNAP_DISTANCE;

  for (const other of allAtoms) {
    if (other.id === newAtom.id) continue;
    if (other.kind === 'flex' && newAtom.kind === 'flex') continue;

    const otherPos = other.body.translation();
    const dx = otherPos.x - newPos.x;
    const dy = otherPos.y - newPos.y;
    const dz = otherPos.z - newPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist < closestDist) {
      closestDist = dist;
      closest = other;
    }
  }

  if (!closest) return null;

  // Face-aligned snapping: snap the new atom to align with the closest face
  const closestPos = closest.body.translation();
  const otherSize = closest.kind === 'shell' ? (closest.params as ShellParams).size : 0.5;
  const newSize = newAtom.kind === 'shell' ? (newAtom.params as ShellParams).size : 0.5;
  const faceNormal = findBestFaceConnection(closestPos, newPos, otherSize, newSize);

  if (faceNormal) {
    // Snap position: align along face normal at touching distance
    const offset = (otherSize / 2 + newSize / 2);
    const snappedPos = {
      x: closestPos.x + faceNormal.x * offset,
      y: closestPos.y + faceNormal.y * offset,
      z: closestPos.z + faceNormal.z * offset,
    };

    // Align non-primary axes to grid
    if (Math.abs(faceNormal.x) > 0.5) {
      snappedPos.y = Math.round(closestPos.y / FACE_GRID) * FACE_GRID;
      snappedPos.z = Math.round(closestPos.z / FACE_GRID) * FACE_GRID;
    } else if (Math.abs(faceNormal.y) > 0.5) {
      snappedPos.x = Math.round(closestPos.x / FACE_GRID) * FACE_GRID;
      snappedPos.z = Math.round(closestPos.z / FACE_GRID) * FACE_GRID;
    } else {
      snappedPos.x = Math.round(closestPos.x / FACE_GRID) * FACE_GRID;
      snappedPos.y = Math.round(closestPos.y / FACE_GRID) * FACE_GRID;
    }

    newAtom.body.setTranslation(snappedPos, true);
  }

  // Anchor at midpoint between snapped positions
  const finalNewPos = newAtom.body.translation();
  const anchorA = {
    x: (closestPos.x - finalNewPos.x) / 2,
    y: (closestPos.y - finalNewPos.y) / 2,
    z: (closestPos.z - finalNewPos.z) / 2,
  };
  const anchorB = {
    x: (finalNewPos.x - closestPos.x) / 2,
    y: (finalNewPos.y - closestPos.y) / 2,
    z: (finalNewPos.z - closestPos.z) / 2,
  };

  const jointData = rapier.JointData.fixed(
    anchorA, { x: 0, y: 0, z: 0, w: 1 },
    anchorB, { x: 0, y: 0, z: 0, w: 1 },
  );
  world.createImpulseJoint(jointData, newAtom.body, closest.body, true);

  newAtom.connections.push(closest.id);
  closest.connections.push(newAtom.id);

  return closest;
}
