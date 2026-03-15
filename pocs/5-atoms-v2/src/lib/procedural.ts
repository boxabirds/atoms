import * as THREE from 'three';
import type { AtomInstance, ConnectionRecord } from './types';

// ---------------------------------------------------------------------------
// Procedural amplification: auto-generated detail between connected Shells
// Inspired by Tiny Glade — "a lot from little effort"
// ---------------------------------------------------------------------------

/** Weld seam mesh between two connected Shell atoms */
interface WeldSeam {
  mesh: THREE.Mesh;
  atomA: number;
  atomB: number;
}

const weldSeams: WeldSeam[] = [];

const SEAM_COLOR = 0x888888;
const SEAM_RADIUS = 0.03;
const SEAM_SEGMENTS = 8;

let seamGeo: THREE.BufferGeometry | null = null;

function getSeamGeometry(length: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(SEAM_RADIUS, SEAM_RADIUS, length, SEAM_SEGMENTS, 1);
}

/** Create a weld seam between two connected atoms */
export function addWeldSeam(
  atomA: AtomInstance,
  atomB: AtomInstance,
  scene: THREE.Scene,
) {
  // Only add seams between Shells
  if (atomA.kind !== 'shell' || atomB.kind !== 'shell') return;

  // Check if seam already exists
  if (weldSeams.some((s) => (s.atomA === atomA.id && s.atomB === atomB.id) || (s.atomA === atomB.id && s.atomB === atomA.id))) {
    return;
  }

  const posA = atomA.body.translation();
  const posB = atomB.body.translation();
  const dx = posB.x - posA.x;
  const dy = posB.y - posA.y;
  const dz = posB.z - posA.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

  const geo = getSeamGeometry(length);
  const mat = new THREE.MeshPhysicalMaterial({
    color: SEAM_COLOR,
    roughness: 0.8,
    metalness: 0.3,
    emissive: 0x222222,
    emissiveIntensity: 0.2,
  });
  const mesh = new THREE.Mesh(geo, mat);

  // Position at midpoint
  mesh.position.set(
    (posA.x + posB.x) / 2,
    (posA.y + posB.y) / 2,
    (posA.z + posB.z) / 2,
  );

  // Orient along connection axis
  const dir = new THREE.Vector3(dx, dy, dz).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
  mesh.quaternion.copy(quat);

  scene.add(mesh);
  weldSeams.push({ mesh, atomA: atomA.id, atomB: atomB.id });
}

/** Update weld seam positions to follow physics bodies */
export function updateWeldSeams(atoms: AtomInstance[]) {
  for (const seam of weldSeams) {
    const a = atoms.find((at) => at.id === seam.atomA);
    const b = atoms.find((at) => at.id === seam.atomB);
    if (!a || !b) continue;

    const posA = a.body.translation();
    const posB = b.body.translation();
    seam.mesh.position.set(
      (posA.x + posB.x) / 2,
      (posA.y + posB.y) / 2,
      (posA.z + posB.z) / 2,
    );

    const dx = posB.x - posA.x;
    const dy = posB.y - posA.y;
    const dz = posB.z - posA.z;
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
    seam.mesh.quaternion.copy(quat);

    // Update length
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    seam.mesh.scale.y = length / 0.5; // Geo was created at length 0.5 default, scale to actual
  }
}

/** Auto-bevel: add slight rounded edge to Shell meshes via scale tweak */
export function applyProceduralDetail(atom: AtomInstance) {
  if (atom.kind !== 'shell') return;
  // Subtle vertex noise for "organic imperfection"
  const geo = atom.mesh.geometry;
  const posAttr = geo.getAttribute('position');
  if (!posAttr || (atom as any)._proceduralApplied) return;

  const NOISE_AMOUNT = 0.008;
  const positions = posAttr.array as Float32Array;
  for (let i = 0; i < positions.length; i++) {
    positions[i] += (Math.random() - 0.5) * NOISE_AMOUNT;
  }
  posAttr.needsUpdate = true;
  geo.computeVertexNormals();
  (atom as any)._proceduralApplied = true;
}
