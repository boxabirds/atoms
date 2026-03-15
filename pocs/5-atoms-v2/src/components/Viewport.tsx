import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { initScene, type SceneState } from '../lib/scene';
import { initPhysics, stepPhysics, type PhysicsWorld } from '../lib/physics';
import type { AtomKind, AtomInstance, InteractionMode, ConnectionRecord } from '../lib/types';
import { DEFAULT_PARAMS, ATOM_COLORS } from '../lib/types';
import {
  spawnShell, updateShell,
  spawnFlex, bridgeFlex, updateFlex,
  spawnPush, updatePush,
  spawnSense, updateSense,
  spawnZap, updateZap,
} from '../lib/atoms/index';
import type { SenseAtom } from '../lib/atoms/sense';
import type { ZapAtom } from '../lib/atoms/zap';
import type { PushParticles } from '../lib/atoms/push';
import { tryAutoConnect } from '../lib/connection';
import { resumeAudio } from '../lib/audio';
import { totalEnergy, atomEnergyCost, MAX_ENERGY } from '../lib/energy';
import { addWeldSeam, updateWeldSeams, applyProceduralDetail } from '../lib/procedural';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPAWN_HEIGHT = 4;
const GRID_SNAP = 0.5;
const SELECTION_OUTLINE_SCALE = 1.25;
const CONNECTION_LINE_COLOR = 0x4466aa;
const FLEX_LINE_COLOR = 0x2dd4bf;
const DRAG_PLANE_HEIGHT = 1.5;

// ---------------------------------------------------------------------------
// World state (outside React — shared across frames)
// ---------------------------------------------------------------------------

export interface WorldState {
  scene: SceneState;
  physics: PhysicsWorld;
  atoms: AtomInstance[];
  connections: ConnectionRecord[];
  selectedAtomId: number | null;
  /** First atom in a connect-two-atoms operation */
  connectSourceId: number | null;
  /** Dragging state */
  dragAtom: AtomInstance | null;
  dragOffset: THREE.Vector3;
}

let worldState: WorldState | null = null;

/** Expose for param panel to read/mutate atoms */
export function getWorldState(): WorldState | null {
  return worldState;
}

// ---------------------------------------------------------------------------
// Raycasting
// ---------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const _mouse = new THREE.Vector2();
const _intersection = new THREE.Vector3();

function setMouseFromEvent(event: MouseEvent, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  _mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  _mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function getGroundPoint(event: MouseEvent, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, planeY: number = 0): THREE.Vector3 | null {
  setMouseFromEvent(event, canvas);
  raycaster.setFromCamera(_mouse, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
  const hit = raycaster.ray.intersectPlane(plane, _intersection);
  if (!hit) return null;
  return hit.clone();
}

function getGroundPointSnapped(event: MouseEvent, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement): THREE.Vector3 | null {
  const hit = getGroundPoint(event, camera, canvas);
  if (!hit) return null;
  hit.x = Math.round(hit.x / GRID_SNAP) * GRID_SNAP;
  hit.z = Math.round(hit.z / GRID_SNAP) * GRID_SNAP;
  hit.y = SPAWN_HEIGHT;
  return hit;
}

function raycastAtoms(event: MouseEvent, camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, atoms: AtomInstance[]): AtomInstance | null {
  setMouseFromEvent(event, canvas);
  raycaster.setFromCamera(_mouse, camera);
  const meshes = atoms.map((a) => a.mesh);
  const intersects = raycaster.intersectObjects(meshes, false);
  if (intersects.length === 0) return null;
  const hitMesh = intersects[0].object;
  return atoms.find((a) => a.mesh === hitMesh) ?? null;
}

// ---------------------------------------------------------------------------
// Selection outline
// ---------------------------------------------------------------------------

function createOutline(atom: AtomInstance, scene: THREE.Scene) {
  clearOutline(atom, scene);

  const geo = atom.mesh.geometry.clone();
  const mat = new THREE.MeshBasicMaterial({
    color: ATOM_COLORS[atom.kind],
    transparent: true,
    opacity: 0.2,
    side: THREE.BackSide,
  });
  const outline = new THREE.Mesh(geo, mat);
  outline.scale.setScalar(SELECTION_OUTLINE_SCALE);
  atom.mesh.add(outline);
  atom.outline = outline;
}

function clearOutline(atom: AtomInstance, scene: THREE.Scene) {
  if (atom.outline) {
    atom.mesh.remove(atom.outline);
    atom.outline.geometry.dispose();
    (atom.outline.material as THREE.Material).dispose();
    atom.outline = undefined;
  }
}

// ---------------------------------------------------------------------------
// Connection visuals
// ---------------------------------------------------------------------------

function createConnectionLine(scene: THREE.Scene, isFlex: boolean): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(), new THREE.Vector3(),
  ]);
  const mat = new THREE.LineBasicMaterial({
    color: isFlex ? FLEX_LINE_COLOR : CONNECTION_LINE_COLOR,
    transparent: true,
    opacity: isFlex ? 0.8 : 0.4,
    linewidth: 1,
  });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  return line;
}

function updateConnectionLines(ws: WorldState) {
  for (const conn of ws.connections) {
    const a = ws.atoms.find((at) => at.id === conn.atomA);
    const b = ws.atoms.find((at) => at.id === conn.atomB);
    if (!a || !b) continue;

    const posA = a.body.translation();
    const posB = b.body.translation();
    const positions = conn.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    positions.setXYZ(0, posA.x, posA.y, posA.z);
    positions.setXYZ(1, posB.x, posB.y, posB.z);
    positions.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Spawn dispatcher
// ---------------------------------------------------------------------------

function spawnAtom(kind: AtomKind, position: THREE.Vector3, ws: WorldState): AtomInstance | null {
  const { scene, physics } = ws;
  const params = structuredClone(DEFAULT_PARAMS[kind]);

  // Energy budget check (Shells are free, so skip for shell)
  if (kind !== 'shell') {
    const used = totalEnergy(ws.atoms);
    const cost = atomEnergyCost({ kind, params } as AtomInstance);
    if (used + cost > MAX_ENERGY) return null; // Over budget
  }

  let atom: AtomInstance;
  switch (kind) {
    case 'shell':
      atom = spawnShell(params as any, position, scene.scene, physics.world, physics.rapier);
      break;
    case 'flex':
      atom = spawnFlex(params as any, position, scene.scene, physics.world, physics.rapier);
      break;
    case 'push':
      atom = spawnPush(params as any, position, scene.scene, physics.world, physics.rapier);
      break;
    case 'sense':
      atom = spawnSense(params as any, position, scene.scene, physics.world, physics.rapier);
      break;
    case 'zap':
      atom = spawnZap(params as any, position, scene.scene, physics.world, physics.rapier);
      break;
  }
  ws.atoms.push(atom);

  // Procedural detail: organic imperfection on Shells
  applyProceduralDetail(atom);

  // Auto-connect to nearby atoms (weld + visual line + weld seam)
  const connected = tryAutoConnect(atom, ws.atoms, physics.world, physics.rapier);
  if (connected) {
    const line = createConnectionLine(scene.scene, false);
    ws.connections.push({ atomA: atom.id, atomB: connected.id, line, isFlexJoint: false });
    addWeldSeam(atom, connected, scene.scene);
  }

  return atom;
}

// ---------------------------------------------------------------------------
// Connect two atoms with a Flex joint
// ---------------------------------------------------------------------------

function connectWithFlex(atomA: AtomInstance, atomB: AtomInstance, ws: WorldState) {
  const { scene, physics } = ws;
  const params = structuredClone(DEFAULT_PARAMS.flex);

  // Spawn the Flex connector at midpoint
  const pA = atomA.body.translation();
  const pB = atomB.body.translation();
  const mid = new THREE.Vector3(
    (pA.x + pB.x) / 2,
    (pA.y + pB.y) / 2,
    (pA.z + pB.z) / 2,
  );

  const flexAtom = spawnFlex(params as any, mid, scene.scene, physics.world, physics.rapier);
  ws.atoms.push(flexAtom);
  bridgeFlex(flexAtom, atomA, atomB, physics.world, physics.rapier);

  // Connection visuals
  const lineAF = createConnectionLine(scene.scene, true);
  const lineFB = createConnectionLine(scene.scene, true);
  ws.connections.push({ atomA: atomA.id, atomB: flexAtom.id, line: lineAF, isFlexJoint: true });
  ws.connections.push({ atomA: flexAtom.id, atomB: atomB.id, line: lineFB, isFlexJoint: true });

  // Register connections for signal routing
  atomA.connections.push(flexAtom.id);
  atomB.connections.push(flexAtom.id);
  flexAtom.connections.push(atomA.id, atomB.id);

  return flexAtom;
}

// ---------------------------------------------------------------------------
// Per-frame update
// ---------------------------------------------------------------------------

function updateAtoms(atoms: AtomInstance[], time: number, dt: number) {
  // Phase 1: Update all Sense atoms
  for (const atom of atoms) {
    if (atom.kind === 'sense') {
      updateSense(atom as SenseAtom, atoms, time);
    }
  }

  // Phase 2: Signal routing with AND-gate semantics
  // For each target atom (Push/Zap/Flex), it's active only if ALL connected Senses are active.
  // This means two Senses feeding one Push creates an implicit AND gate.
  for (const atom of atoms) {
    if (atom.kind === 'push' || atom.kind === 'zap' || atom.kind === 'flex') {
      const connectedSenses = atom.connections
        .map((id) => atoms.find((a) => a.id === id))
        .filter((a): a is AtomInstance => a !== undefined && a.kind === 'sense');

      if (connectedSenses.length > 0) {
        // AND gate: all connected senses must be active
        atom.active = connectedSenses.every((s) => s.active);

        // Directional data: steer Push/Zap toward detected target
        // Use the first sense with a detected position
        const senseWithTarget = connectedSenses.find(
          (s) => (s as SenseAtom).detectedPosition !== null,
        ) as SenseAtom | undefined;

        if (senseWithTarget?.detectedPosition && atom.active) {
          const targetPos = senseWithTarget.detectedPosition;
          const atomPos = atom.body.translation();
          const dx = targetPos.x - atomPos.x;
          const dy = targetPos.y - atomPos.y;
          const dz = targetPos.z - atomPos.z;
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (len > 0.1) {
            if (atom.kind === 'push') {
              // Steer Push direction toward target (reactive locomotion)
              const p = atom.params as import('../lib/types').PushParams;
              p.direction = [dx / len, dy / len, dz / len];
            }
            if (atom.kind === 'zap') {
              // Aim Zap body toward target (auto-turret)
              const quat = new THREE.Quaternion();
              const lookDir = new THREE.Vector3(dx, dy, dz).normalize();
              const mat4 = new THREE.Matrix4().lookAt(
                new THREE.Vector3(), lookDir, new THREE.Vector3(0, 1, 0),
              );
              quat.setFromRotationMatrix(mat4);
              atom.body.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true);
            }
          }
        }
      }
    }
  }

  for (const atom of atoms) {
    const pos = atom.body.translation();
    const rot = atom.body.rotation();
    atom.mesh.position.set(pos.x, pos.y, pos.z);

    if (atom.kind !== 'sense') {
      atom.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }

    switch (atom.kind) {
      case 'shell': updateShell(atom, time, dt); break;
      case 'flex': updateFlex(atom, time, dt, atoms); break;
      case 'push': updatePush(atom as AtomInstance & { particles?: PushParticles }, time, dt); break;
      case 'zap': updateZap(atom as ZapAtom, atoms, time, dt); break;
    }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ViewportProps {
  activeTool: AtomKind | null;
  mode: InteractionMode;
  onAtomSpawned?: (atom: AtomInstance) => void;
  onAtomSelected?: (atom: AtomInstance | null) => void;
  onConnectionMade?: (flex: AtomInstance) => void;
}

export function Viewport({ activeTool, mode, onAtomSpawned, onAtomSelected, onConnectionMade }: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeToolRef = useRef(activeTool);
  const modeRef = useRef(mode);
  activeToolRef.current = activeTool;
  modeRef.current = mode;

  // Stable refs for callbacks
  const onAtomSpawnedRef = useRef(onAtomSpawned);
  const onAtomSelectedRef = useRef(onAtomSelected);
  const onConnectionMadeRef = useRef(onConnectionMade);
  onAtomSpawnedRef.current = onAtomSpawned;
  onAtomSelectedRef.current = onAtomSelected;
  onConnectionMadeRef.current = onConnectionMade;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;

    (async () => {
      const [scene, physics] = await Promise.all([
        initScene(canvas),
        initPhysics(),
      ]);

      if (disposed) { scene.renderer.dispose(); return; }

      worldState = {
        scene, physics,
        atoms: [],
        connections: [],
        selectedAtomId: null,
        connectSourceId: null,
        dragAtom: null,
        dragOffset: new THREE.Vector3(),
      };

      // ---- Resize ----
      function resize() {
        const parent = canvas!.parentElement!;
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        scene.renderer.setSize(w, h);
        scene.camera.aspect = w / h;
        scene.camera.updateProjectionMatrix();
      }
      resize();
      window.addEventListener('resize', resize);

      // ---- Pointer down ----
      function onPointerDown(event: PointerEvent) {
        resumeAudio();
        const ws = worldState!;
        const currentMode = modeRef.current;

        if (currentMode === 'place' && activeToolRef.current) {
          // Spawn mode: place atom
          const point = getGroundPointSnapped(event, ws.scene.camera, canvas!);
          if (!point) return;
          const atom = spawnAtom(activeToolRef.current, point, ws);
          if (atom) onAtomSpawnedRef.current?.(atom);
          return;
        }

        // Select or connect: try to hit an atom
        const hit = raycastAtoms(event, ws.scene.camera, canvas!, ws.atoms);

        if (currentMode === 'select') {
          // Deselect previous
          if (ws.selectedAtomId !== null) {
            const prev = ws.atoms.find((a) => a.id === ws.selectedAtomId);
            if (prev) clearOutline(prev, ws.scene.scene);
          }

          if (hit) {
            ws.selectedAtomId = hit.id;
            createOutline(hit, ws.scene.scene);
            onAtomSelectedRef.current?.(hit);

            // Start drag — make body kinematic while dragging
            ws.dragAtom = hit;
            hit.body.setBodyType(physics.rapier.RigidBodyType.KinematicPositionBased, true);
            const bodyPos = hit.body.translation();
            const ground = getGroundPoint(event, ws.scene.camera, canvas!, bodyPos.y);
            if (ground) {
              ws.dragOffset.set(bodyPos.x - ground.x, 0, bodyPos.z - ground.z);
            }
            scene.controls.enabled = false;
          } else {
            ws.selectedAtomId = null;
            ws.dragAtom = null;
            onAtomSelectedRef.current?.(null);
          }
        }

        if (currentMode === 'connect') {
          if (!hit) {
            ws.connectSourceId = null;
            return;
          }

          if (ws.connectSourceId === null) {
            // First pick
            ws.connectSourceId = hit.id;
            createOutline(hit, ws.scene.scene);
          } else if (ws.connectSourceId !== hit.id) {
            // Second pick — create flex joint
            const source = ws.atoms.find((a) => a.id === ws.connectSourceId);
            if (source) {
              clearOutline(source, ws.scene.scene);
              const flex = connectWithFlex(source, hit, ws);
              onConnectionMadeRef.current?.(flex);
            }
            ws.connectSourceId = null;
          }
        }
      }

      // ---- Pointer move (drag) ----
      function onPointerMove(event: PointerEvent) {
        const ws = worldState!;
        if (!ws.dragAtom) return;

        const bodyPos = ws.dragAtom.body.translation();
        const ground = getGroundPoint(event, ws.scene.camera, canvas!, bodyPos.y);
        if (ground) {
          ws.dragAtom.body.setNextKinematicTranslation({
            x: ground.x + ws.dragOffset.x,
            y: bodyPos.y,
            z: ground.z + ws.dragOffset.z,
          });
        }
      }

      // ---- Pointer up (end drag) ----
      function onPointerUp(_event: PointerEvent) {
        const ws = worldState!;
        if (ws.dragAtom) {
          ws.dragAtom.body.setBodyType(physics.rapier.RigidBodyType.Dynamic, true);
          // Zero velocity so it doesn't fly off
          ws.dragAtom.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          ws.dragAtom.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          ws.dragAtom = null;
          scene.controls.enabled = true;
        }
      }

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);

      // ---- Main loop ----
      let lastTime = performance.now();
      scene.renderer.setAnimationLoop(() => {
        const now = performance.now();
        const dt = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;
        const time = now / 1000;

        stepPhysics(physics);
        updateAtoms(worldState!.atoms, time, dt);
        updateConnectionLines(worldState!);
        updateWeldSeams(worldState!.atoms);
        scene.controls.update();
        scene.renderer.render(scene.scene, scene.camera);
      });
    })();

    return () => {
      disposed = true;
      if (worldState) {
        worldState.scene.renderer.setAnimationLoop(null);
        worldState.scene.controls.dispose();
        worldState.scene.renderer.dispose();
        worldState = null;
      }
    };
  }, []); // Intentionally empty — refs handle prop changes

  // Cursor
  const cursor = mode === 'place' && activeTool ? 'crosshair'
    : mode === 'connect' ? 'cell'
    : 'default';

  // Hint text
  let hint: string | null = null;
  if (mode === 'place' && activeTool) hint = `Click to place ${activeTool}`;
  else if (mode === 'select') hint = 'Click to select / drag to move';
  else if (mode === 'connect') hint = worldState?.connectSourceId ? 'Click second atom to connect' : 'Click first atom to connect';

  return (
    <div className="viewport" style={{ cursor }}>
      <canvas ref={canvasRef} />
      {hint && (
        <div className="viewport-hint">
          <span dangerouslySetInnerHTML={{ __html: hint }} />
        </div>
      )}
    </div>
  );
}
