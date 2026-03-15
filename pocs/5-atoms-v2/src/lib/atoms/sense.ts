import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { SenseParams, AtomInstance } from '../types';
import { ATOM_COLORS, ATOM_EMISSIVE } from '../types';
import { playSensePing } from '../audio';

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const EYE_RADIUS = 0.25;

let sharedGeo: THREE.BufferGeometry | null = null;
let irisGeo: THREE.BufferGeometry | null = null;

function getEyeGeometry(): THREE.BufferGeometry {
  if (!sharedGeo) sharedGeo = new THREE.SphereGeometry(EYE_RADIUS, 20, 20);
  return sharedGeo;
}

function getIrisGeometry(): THREE.BufferGeometry {
  if (!irisGeo) irisGeo = new THREE.CircleGeometry(EYE_RADIUS * 0.45, 16);
  return irisGeo;
}

// ---------------------------------------------------------------------------
// Keyboard state for player-input detection
// ---------------------------------------------------------------------------

const keysDown = new Set<string>();
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => keysDown.add(e.key.toLowerCase()));
  window.addEventListener('keyup', (e) => keysDown.delete(e.key.toLowerCase()));
}

export function isPlayerInput(): boolean {
  return keysDown.has('w') || keysDown.has('a') || keysDown.has('s') || keysDown.has('d')
    || keysDown.has('arrowup') || keysDown.has('arrowdown')
    || keysDown.has('arrowleft') || keysDown.has('arrowright')
    || keysDown.has(' ');
}

/** Get player input direction vector (WASD/arrows → XZ plane) */
export function getPlayerDirection(): THREE.Vector3 {
  const dir = new THREE.Vector3();
  if (keysDown.has('w') || keysDown.has('arrowup')) dir.z -= 1;
  if (keysDown.has('s') || keysDown.has('arrowdown')) dir.z += 1;
  if (keysDown.has('a') || keysDown.has('arrowleft')) dir.x -= 1;
  if (keysDown.has('d') || keysDown.has('arrowright')) dir.x += 1;
  if (keysDown.has(' ')) dir.y += 1; // space = jump/up
  if (dir.lengthSq() > 0) dir.normalize();
  return dir;
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

let nextId = 30000;

export interface SenseAtom extends AtomInstance {
  iris: THREE.Mesh;
  pupil: THREE.Mesh;
  detectedPosition: THREE.Vector3 | null;
  rangeRing: THREE.Mesh;
  wasDetecting: boolean;
  /** Toggle latch state */
  toggleLatch: boolean;
  /** Previous raw detection for edge detection in threshold mode */
  prevRawDetected: boolean;
}

export function spawnSense(
  params: SenseParams,
  position: THREE.Vector3,
  scene: THREE.Scene,
  world: RAPIER.World,
  rapier: typeof import('@dimforge/rapier3d-compat').default,
): SenseAtom {
  const eyeGeo = getEyeGeometry();
  const eyeMat = new THREE.MeshPhysicalMaterial({
    color: 0xeeeeff, roughness: 0.2, metalness: 0.0,
    emissive: ATOM_EMISSIVE.sense, emissiveIntensity: 0.3,
  });
  const mesh = new THREE.Mesh(eyeGeo, eyeMat);
  mesh.position.copy(position);
  scene.add(mesh);

  const irisMat = new THREE.MeshPhysicalMaterial({
    color: ATOM_COLORS.sense, roughness: 0.1, metalness: 0.3,
    emissive: ATOM_COLORS.sense, emissiveIntensity: 0.6,
  });
  const iris = new THREE.Mesh(getIrisGeometry(), irisMat);
  iris.position.z = EYE_RADIUS * 0.85;
  mesh.add(iris);

  const pupilGeo = new THREE.CircleGeometry(EYE_RADIUS * 0.18, 12);
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const pupil = new THREE.Mesh(pupilGeo, pupilMat);
  pupil.position.z = EYE_RADIUS * 0.87;
  mesh.add(pupil);

  const ringGeo = new THREE.RingGeometry(params.range - 0.05, params.range, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: ATOM_COLORS.sense, transparent: true, opacity: 0.08, side: THREE.DoubleSide,
  });
  const rangeRing = new THREE.Mesh(ringGeo, ringMat);
  rangeRing.rotation.x = -Math.PI / 2;
  rangeRing.position.y = 0.05;
  scene.add(rangeRing);

  const bodyDesc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(position.x, position.y, position.z)
    .setLinearDamping(0.5).setAngularDamping(2.0);
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = rapier.ColliderDesc.ball(EYE_RADIUS)
    .setDensity(1.5).setRestitution(0.5).setFriction(0.4);
  const collider = world.createCollider(colliderDesc, body);

  return {
    id: nextId++, kind: 'sense', params, mesh, body, collider,
    connections: [], active: false, cooldownRemaining: 0, phase: 0,
    iris, pupil, detectedPosition: null, rangeRing,
    wasDetecting: false, toggleLatch: false, prevRawDetected: false,
  };
}

// ---------------------------------------------------------------------------
// Runtime param update
// ---------------------------------------------------------------------------

export function applySenseParams(atom: SenseAtom, _scene: THREE.Scene) {
  const params = atom.params as SenseParams;
  const oldGeo = atom.rangeRing.geometry;
  atom.rangeRing.geometry = new THREE.RingGeometry(params.range - 0.05, params.range, 48);
  oldGeo.dispose();
}

// ---------------------------------------------------------------------------
// Update: multi-mode detection + trigger conditions + Sense-to-Sense chaining
// ---------------------------------------------------------------------------

const _targetDir = new THREE.Vector3();
const _meshWorldPos = new THREE.Vector3();
const SCAN_SPEED = 0.8;
const GROUND_ALTITUDE_REF = 0; // ground Y

export function updateSense(atom: SenseAtom, allAtoms: AtomInstance[], time: number) {
  const params = atom.params as SenseParams;
  const pos = atom.body.translation();
  atom.rangeRing.position.set(pos.x, 0.05, pos.z);

  // --- Raw detection per detection type ---
  let rawDetected = false;
  let nearestPos: { x: number; y: number; z: number } | null = null;
  let nearestDist = Infinity;

  if (params.detection === 'player-input') {
    rawDetected = isPlayerInput();
  } else if (params.detection === 'light-level') {
    // Triggers based on ambient light (approximated by Y position — higher = brighter)
    // In a real game this would sample scene lighting; here we use altitude as proxy
    const lightLevel = Math.max(0, Math.min(1, pos.y / 5));
    rawDetected = lightLevel > params.triggerThreshold;
  } else if (params.detection === 'altitude') {
    // Triggers when this atom is above threshold altitude
    rawDetected = (pos.y - GROUND_ALTITUDE_REF) > params.triggerThreshold * 10;
  } else {
    // Spatial detection types: scan nearby atoms
    for (const other of allAtoms) {
      if (other.id === atom.id) continue;
      const op = other.body.translation();
      const dx = op.x - pos.x, dy = op.y - pos.y, dz = op.z - pos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist >= params.range) continue;

      let triggered = false;
      switch (params.detection) {
        case 'proximity':
          triggered = true;
          break;
        case 'contact':
          triggered = dist < 0.8;
          break;
        case 'speed': {
          const vel = other.body.linvel();
          const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2);
          triggered = speed > params.triggerThreshold * 10;
          break;
        }
        case 'angle': {
          // Triggers when target is within a forward cone (±45°)
          const bodyRot = atom.body.rotation();
          const q = new THREE.Quaternion(bodyRot.x, bodyRot.y, bodyRot.z, bodyRot.w);
          const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
          const toTarget = new THREE.Vector3(dx, dy, dz).normalize();
          const dot = forward.dot(toTarget);
          triggered = dot > (1 - params.triggerThreshold); // threshold 0→180° cone, 1→0° cone
          break;
        }
      }

      if (triggered && dist < nearestDist) {
        nearestDist = dist;
        nearestPos = op;
        rawDetected = true;
      }
    }
  }

  // Sense-to-Sense chaining: if any connected Sense is active, this one activates too
  for (const connId of atom.connections) {
    const connected = allAtoms.find((a) => a.id === connId);
    if (connected && connected.kind === 'sense' && connected.active) {
      rawDetected = true;
      if (!nearestPos) {
        const sc = connected as SenseAtom;
        if (sc.detectedPosition) {
          nearestPos = { x: sc.detectedPosition.x, y: sc.detectedPosition.y, z: sc.detectedPosition.z };
        }
      }
    }
  }

  // --- Apply trigger mode ---
  let finalActive: boolean;
  switch (params.trigger) {
    case 'continuous':
      finalActive = rawDetected;
      break;
    case 'threshold':
      // Fire once on rising edge only
      finalActive = rawDetected && !atom.prevRawDetected;
      break;
    case 'toggle':
      // Flip latch on rising edge
      if (rawDetected && !atom.prevRawDetected) {
        atom.toggleLatch = !atom.toggleLatch;
      }
      finalActive = atom.toggleLatch;
      break;
    default:
      finalActive = rawDetected;
  }
  atom.prevRawDetected = rawDetected;
  atom.active = finalActive;

  // Ping sound on detection edge
  if (finalActive && !atom.wasDetecting) playSensePing();
  atom.wasDetecting = finalActive;

  // --- Eye tracking ---
  if (nearestPos) {
    atom.detectedPosition = new THREE.Vector3(nearestPos.x, nearestPos.y, nearestPos.z);
    atom.mesh.getWorldPosition(_meshWorldPos);
    _targetDir.set(nearestPos.x, nearestPos.y, nearestPos.z).sub(_meshWorldPos);
    if (_targetDir.lengthSq() > 0.001) {
      atom.mesh.lookAt(_meshWorldPos.clone().add(_targetDir));
    }
  } else {
    atom.detectedPosition = null;
    atom.mesh.rotation.y = Math.sin(time * SCAN_SPEED) * 0.4;
    atom.mesh.rotation.x = Math.sin(time * SCAN_SPEED * 0.7) * 0.15;
  }

  // Emissive
  const eyeMat = atom.mesh.material as THREE.MeshPhysicalMaterial;
  const irisMat = atom.iris.material as THREE.MeshPhysicalMaterial;
  const targetEmissive = finalActive ? 1.5 : 0.3;
  eyeMat.emissiveIntensity += (targetEmissive * 0.3 - eyeMat.emissiveIntensity) * 0.1;
  irisMat.emissiveIntensity += (targetEmissive - irisMat.emissiveIntensity) * 0.1;
}
