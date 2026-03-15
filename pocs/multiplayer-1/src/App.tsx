import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Canvas, useFrame, useThree, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import * as THREE from 'three';
import {
  connectToSTDB, subscribe,
  atomEntries, connectionRows, signalEntries,
  frozen, atomCount, connStatus, lastTickTime,
  addAtom, spawnMachine, toggleFreeze, removeAtom, dragAtom, clearArena,
  toggleRelayMode, toggleHold,
} from './store';
import {
  ATOM_DEFS, ATOM_RADIUS, FLEX_RADIUS, FLEX_LENGTH, GROUND_Y, GROUND_SIZE, ARENA_HALF,
  TICK_INTERVAL_MS, BG_COLOR, MACHINE_DEFS,
  SIGNAL_DOT_RADIUS, SIGNAL_DOT_COLOR, SENSE_DETECTION_RANGE, SENSE_CONE_HALF_ANGLE,
  BREATHING_SPEED, BREATHING_AMPLITUDE, KICK_DURATION, SNAP_DURATION, SIGNAL_CHARGE_GLOW_FACTOR,
  NODE_RADIUS, NODE_SEGMENTS, SHOW_TENDRIL_DISTANCE, TENDRIL_COLOR,
  RAYCAST_THRESHOLD, GHOST_OPACITY, CLICK_THRESHOLD, TOAST_DURATION_MS,
} from './constants';
import type { AtomEntry } from './store';

// ---------------------------------------------------------------------------
// Hook: subscribe to store changes
// ---------------------------------------------------------------------------
function useStore() {
  const [, forceUpdate] = useState(0);
  useEffect(() => subscribe(() => forceUpdate(n => n + 1)), []);
  return { frozen, atomCount, connStatus };
}

// ---------------------------------------------------------------------------
// Shared temp objects (avoid allocations in useFrame)
// ---------------------------------------------------------------------------
const _bridgeDir = new THREE.Vector3();
const _bridgeUp = new THREE.Vector3(0, 1, 0);
const _bridgeQuat = new THREE.Quaternion();
const _tempScale = new THREE.Vector3();

// Cone dimensions for SENSE visualization
const SENSE_CONE_RADIUS = Math.tan(SENSE_CONE_HALF_ANGLE) * SENSE_DETECTION_RANGE;

// ---------------------------------------------------------------------------
// 3D: Atom group — main mesh + type-specific detail meshes
// ---------------------------------------------------------------------------
function AtomGroup({ entry }: { entry: AtomEntry }) {
  const groupRef = useRef<THREE.Group>(null);
  const mainRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const nucleusRef = useRef<THREE.Mesh>(null);    // HOLD
  const nucleusMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const grooveMatRef = useRef<THREE.MeshStandardMaterial>(null); // RELAY
  const barrierRef = useRef<THREE.Mesh>(null);    // RELAY block
  const coneMatRef = useRef<THREE.MeshStandardMaterial>(null);   // SENSE
  const kickRingRef = useRef<THREE.Mesh>(null);   // PULSE
  const kickRingMatRef = useRef<THREE.MeshBasicMaterial>(null);

  const def = ATOM_DEFS[entry.atomType] || ATOM_DEFS.flex;
  const radius = entry.atomType === 'flex' ? FLEX_RADIUS : ATOM_RADIUS;
  const prevQ = useRef(new THREE.Quaternion());
  const currQ = useRef(new THREE.Quaternion());
  const breathPhase = useRef((Number(entry.id % 1000n) * 0.7) % (Math.PI * 2));
  const lastCharge = useRef(0);
  const kickStartTime = useRef(-1);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const time = clock.elapsedTime;
    const elapsed = performance.now() - lastTickTime;
    const alpha = Math.min(elapsed / TICK_INTERVAL_MS, 1.0);
    const { prev, curr } = entry;

    // Position interpolation
    groupRef.current.position.set(
      prev.x + (curr.x - prev.x) * alpha,
      prev.y + (curr.y - prev.y) * alpha,
      prev.z + (curr.z - prev.z) * alpha,
    );

    // Rotation interpolation
    prevQ.current.set(prev.rx, prev.ry, prev.rz, prev.rw);
    currQ.current.set(curr.rx, curr.ry, curr.rz, curr.rw);
    groupRef.current.quaternion.slerpQuaternions(prevQ.current, currQ.current, alpha);

    // Snap animation (first 250ms) then breathing
    const age = (performance.now() - entry.spawnTime) / 1000;
    if (age < SNAP_DURATION) {
      const t = age / SNAP_DURATION;
      // Ease-out overshoot: ramp to 1.15x then settle to 1.0
      const scale = t < 0.7 ? (t / 0.7) * 1.15 : 1.15 - ((t - 0.7) / 0.3) * 0.15;
      groupRef.current.scale.setScalar(Math.max(0.01, scale));
    } else {
      const breath = 1.0 + Math.sin(time * BREATHING_SPEED + breathPhase.current) * BREATHING_AMPLITUDE;
      groupRef.current.scale.setScalar(breath);
    }

    // Signal charge glow — boost emissive intensity
    if (matRef.current) {
      matRef.current.emissiveIntensity = def.emissiveIntensity + entry.signalCharge * SIGNAL_CHARGE_GLOW_FACTOR;
    }

    // --- PULSE: kick ring animation ---
    if (entry.atomType === 'pulse' && kickRingRef.current && kickRingMatRef.current) {
      // Detect fire: charge jumps high
      if (entry.signalCharge > 0.8 && lastCharge.current < 0.3) {
        kickStartTime.current = time;
      }
      lastCharge.current = entry.signalCharge;

      const kickAge = time - kickStartTime.current;
      if (kickAge >= 0 && kickAge < KICK_DURATION) {
        const t = kickAge / KICK_DURATION;
        kickRingRef.current.visible = true;
        kickRingRef.current.scale.setScalar(1 + t * 0.5);
        kickRingMatRef.current.opacity = (1 - t) * 0.8;
      } else {
        kickRingRef.current.visible = false;
      }
    }

    // --- HOLD: nucleus scale + emissive ---
    if (entry.atomType === 'hold' && nucleusRef.current && nucleusMatRef.current) {
      const targetScale = entry.holdOn ? 1.0 : 0.5;
      _tempScale.setScalar(targetScale);
      nucleusRef.current.scale.lerp(_tempScale, 0.1);
      nucleusMatRef.current.emissiveIntensity = entry.holdOn ? 1.8 : 0.2;
    }

    // --- RELAY: groove color per mode ---
    if (entry.atomType === 'relay' && grooveMatRef.current) {
      switch (entry.relayMode) {
        case 'pass':
          grooveMatRef.current.color.set('#ffee44');
          grooveMatRef.current.emissive.set('#ccbb22');
          break;
        case 'invert':
          grooveMatRef.current.color.set('#ff66aa');
          grooveMatRef.current.emissive.set('#cc4488');
          break;
        case 'block':
          grooveMatRef.current.color.set('#888888');
          grooveMatRef.current.emissive.set('#444444');
          break;
      }
      if (barrierRef.current) {
        barrierRef.current.visible = entry.relayMode === 'block';
      }
    }

    // --- SENSE: cone opacity pulse ---
    if (entry.atomType === 'sense' && coneMatRef.current) {
      coneMatRef.current.opacity = 0.08 + Math.sin(time * 2) * 0.02 + entry.signalCharge * 0.25;
    }

    // --- FLEX: opacity/roughness based on elastic state ---
    if (entry.atomType === 'flex' && matRef.current) {
      if (entry.flexElastic) {
        matRef.current.opacity = 0.6;
        matRef.current.transparent = true;
        matRef.current.roughness = 0.6;
        matRef.current.metalness = 0.1;
      } else {
        matRef.current.opacity = 1.0;
        matRef.current.transparent = false;
        matRef.current.roughness = 0.35;
        matRef.current.metalness = 0.15;
      }
    }
  });

  return (
    <group ref={groupRef} userData={{ atomId: entry.id }}>
      {/* Main mesh — capsule for FLEX, sphere for others */}
      {entry.atomType === 'flex' ? (
        <mesh ref={mainRef} userData={{ atomId: entry.id }}>
          <capsuleGeometry args={[FLEX_RADIUS, FLEX_LENGTH, 12, 24]} />
          <meshStandardMaterial
            ref={matRef}
            color={def.color}
            emissive={def.emissive}
            emissiveIntensity={def.emissiveIntensity}
            roughness={0.35}
            metalness={0.15}
          />
        </mesh>
      ) : (
        <mesh ref={mainRef} userData={{ atomId: entry.id }}>
          <sphereGeometry args={[radius, 24, 24]} />
          <meshStandardMaterial
            ref={matRef}
            color={def.color}
            emissive={def.emissive}
            emissiveIntensity={def.emissiveIntensity}
            roughness={0.35}
            metalness={0.15}
          />
        </mesh>
      )}

      {/* HOLD: nucleus inner sphere */}
      {entry.atomType === 'hold' && (
        <mesh ref={nucleusRef} scale={0.5}>
          <sphereGeometry args={[radius * 0.5, 16, 16]} />
          <meshStandardMaterial
            ref={nucleusMatRef}
            color="#ffffff"
            emissive="#8844cc"
            emissiveIntensity={0.2}
            transparent
            opacity={0.9}
          />
        </mesh>
      )}

      {/* RELAY: groove torus + barrier sphere */}
      {entry.atomType === 'relay' && (
        <>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[radius * 0.85, 0.02, 8, 24]} />
            <meshStandardMaterial
              ref={grooveMatRef}
              color="#ffee44"
              emissive="#ccbb22"
              emissiveIntensity={0.5}
            />
          </mesh>
          <mesh ref={barrierRef} visible={false}>
            <sphereGeometry args={[radius * 1.1, 16, 16]} />
            <meshBasicMaterial color="#ff0000" transparent opacity={0.15} />
          </mesh>
        </>
      )}

      {/* SENSE: detection cone */}
      {entry.atomType === 'sense' && (
        <mesh
          position={[0, 0, SENSE_DETECTION_RANGE / 2]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <coneGeometry args={[SENSE_CONE_RADIUS, SENSE_DETECTION_RANGE, 16, 1, true]} />
          <meshStandardMaterial
            ref={coneMatRef}
            color="#3498db"
            emissive="#2277bb"
            emissiveIntensity={0.3}
            transparent
            opacity={0.1}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* PULSE: kick ring */}
      {entry.atomType === 'pulse' && (
        <mesh ref={kickRingRef} visible={false} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radius * 1.2, 0.03, 8, 24]} />
          <meshBasicMaterial ref={kickRingMatRef} color="#e8603c" transparent opacity={0.8} />
        </mesh>
      )}

      {/* Connection node dots */}
      {entry.atomType === 'flex' ? (
        <>
          {[FLEX_LENGTH * 0.5, -FLEX_LENGTH * 0.5].map((z, i) => (
            <mesh key={`node-${i}`} position={[0, 0, z]}>
              <sphereGeometry args={[NODE_RADIUS, NODE_SEGMENTS, NODE_SEGMENTS]} />
              <meshStandardMaterial color="#88ddff" emissive="#44aacc" emissiveIntensity={1.0} transparent opacity={0.6} />
            </mesh>
          ))}
        </>
      ) : (
        <>
          {[[0,1,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]].map(([dx,dy,dz], i) => (
            <mesh key={`node-${i}`} position={[dx * ATOM_RADIUS, dy * ATOM_RADIUS, dz * ATOM_RADIUS]}>
              <sphereGeometry args={[NODE_RADIUS, NODE_SEGMENTS, NODE_SEGMENTS]} />
              <meshStandardMaterial color="#88ddff" emissive="#44aacc" emissiveIntensity={1.0} transparent opacity={0.6} />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// 3D: Signal dot — yellow sphere traveling along a connection
// ---------------------------------------------------------------------------
function SignalDot({ fromId, toId, progress }: { fromId: bigint; toId: bigint; progress: number }) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!ref.current) return;
    const from = atomEntries.get(fromId);
    const to = atomEntries.get(toId);
    if (!from || !to) return;

    const elapsed = performance.now() - lastTickTime;
    const alpha = Math.min(elapsed / TICK_INTERVAL_MS, 1.0);

    const fx = from.prev.x + (from.curr.x - from.prev.x) * alpha;
    const fy = from.prev.y + (from.curr.y - from.prev.y) * alpha;
    const fz = from.prev.z + (from.curr.z - from.prev.z) * alpha;
    const tx = to.prev.x + (to.curr.x - to.prev.x) * alpha;
    const ty = to.prev.y + (to.curr.y - to.prev.y) * alpha;
    const tz = to.prev.z + (to.curr.z - to.prev.z) * alpha;

    const t = Math.min(progress, 1.0);
    ref.current.position.set(
      fx + (tx - fx) * t,
      fy + (ty - fy) * t,
      fz + (tz - fz) * t,
    );
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[SIGNAL_DOT_RADIUS, 8, 8]} />
      <meshStandardMaterial
        color={SIGNAL_DOT_COLOR}
        emissive={SIGNAL_DOT_COLOR}
        emissiveIntensity={2.0}
      />
    </mesh>
  );
}

function SignalDots() {
  useStore(); // re-render when signals change
  const signals = Array.from(signalEntries.values());

  return (
    <>
      {signals.map(sig => (
        <SignalDot
          key={sig.id.toString()}
          fromId={sig.fromAtomId}
          toId={sig.toAtomId}
          progress={sig.progress}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// 3D: Tendrils — faint lines between nearby unconnected atoms
// ---------------------------------------------------------------------------
function Tendrils() {
  const lineRef = useRef<THREE.LineSegments>(null);
  const geoRef = useRef(new THREE.BufferGeometry());
  const posAttr = useRef(new Float32Array(2000 * 6)); // max 2000 tendrils
  const colAttr = useRef(new Float32Array(2000 * 8)); // RGBA per vertex

  useEffect(() => {
    const geo = geoRef.current;
    geo.setAttribute('position', new THREE.BufferAttribute(posAttr.current, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colAttr.current, 4));
  }, []);

  useFrame(() => {
    if (!lineRef.current) return;
    const atoms = Array.from(atomEntries.values());
    const conns = connectionRows;
    const pos = posAttr.current;
    const col = colAttr.current;
    let idx = 0;

    const elapsed = performance.now() - lastTickTime;
    const alpha = Math.min(elapsed / TICK_INTERVAL_MS, 1.0);

    for (let i = 0; i < atoms.length && idx < 2000; i++) {
      for (let j = i + 1; j < atoms.length && idx < 2000; j++) {
        const a = atoms[i], b = atoms[j];
        // Skip connected pairs
        let connected = false;
        for (const c of conns.values()) {
          if ((c.fromAtomId === a.id && c.toAtomId === b.id) ||
              (c.fromAtomId === b.id && c.toAtomId === a.id)) {
            connected = true; break;
          }
        }
        if (connected) continue;

        const ax = a.prev.x + (a.curr.x - a.prev.x) * alpha;
        const ay = a.prev.y + (a.curr.y - a.prev.y) * alpha;
        const az = a.prev.z + (a.curr.z - a.prev.z) * alpha;
        const bx = b.prev.x + (b.curr.x - b.prev.x) * alpha;
        const by = b.prev.y + (b.curr.y - b.prev.y) * alpha;
        const bz = b.prev.z + (b.curr.z - b.prev.z) * alpha;

        const dx = bx - ax, dy = by - ay, dz = bz - az;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist >= SHOW_TENDRIL_DISTANCE || dist < 0.1) continue;

        const opacity = (1.0 - dist / SHOW_TENDRIL_DISTANCE) * 0.5;
        const vi = idx * 6;
        pos[vi] = ax; pos[vi+1] = ay; pos[vi+2] = az;
        pos[vi+3] = bx; pos[vi+4] = by; pos[vi+5] = bz;

        const ci = idx * 8;
        // #44aadd = 0.267, 0.667, 0.867
        col[ci] = 0.267; col[ci+1] = 0.667; col[ci+2] = 0.867; col[ci+3] = opacity;
        col[ci+4] = 0.267; col[ci+5] = 0.667; col[ci+6] = 0.867; col[ci+7] = opacity;
        idx++;
      }
    }

    const geo = geoRef.current;
    geo.setDrawRange(0, idx * 2);
    if (geo.attributes.position) geo.attributes.position.needsUpdate = true;
    if (geo.attributes.color) geo.attributes.color.needsUpdate = true;
  });

  return (
    <lineSegments ref={lineRef} geometry={geoRef.current}>
      <lineBasicMaterial vertexColors transparent depthWrite={false} />
    </lineSegments>
  );
}

// ---------------------------------------------------------------------------
// 3D: Connection bridge (with signal glow)
// ---------------------------------------------------------------------------
function Bridge({ fromId, toId, connId }: { fromId: bigint; toId: bigint; connId: bigint }) {
  const ref = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(() => {
    if (!ref.current) return;
    const fromEntry = atomEntries.get(fromId);
    const toEntry = atomEntries.get(toId);
    if (!fromEntry || !toEntry) return;

    const elapsed = performance.now() - lastTickTime;
    const alpha = Math.min(elapsed / TICK_INTERVAL_MS, 1.0);

    const ax = fromEntry.prev.x + (fromEntry.curr.x - fromEntry.prev.x) * alpha;
    const ay = fromEntry.prev.y + (fromEntry.curr.y - fromEntry.prev.y) * alpha;
    const az = fromEntry.prev.z + (fromEntry.curr.z - fromEntry.prev.z) * alpha;
    const bx = toEntry.prev.x + (toEntry.curr.x - toEntry.prev.x) * alpha;
    const by = toEntry.prev.y + (toEntry.curr.y - toEntry.prev.y) * alpha;
    const bz = toEntry.prev.z + (toEntry.curr.z - toEntry.prev.z) * alpha;

    const midX = (ax + bx) / 2, midY = (ay + by) / 2, midZ = (az + bz) / 2;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    ref.current.position.set(midX, midY, midZ);
    ref.current.scale.set(1, dist, 1);

    if (dist > 0.001) {
      _bridgeDir.set(dx / dist, dy / dist, dz / dist);
      _bridgeQuat.setFromUnitVectors(_bridgeUp, _bridgeDir);
      ref.current.quaternion.copy(_bridgeQuat);
    }

    // Bridge glow: boost emissive when signal is active on this connection
    if (matRef.current) {
      let hasSignal = false;
      for (const sig of signalEntries.values()) {
        if (sig.connectionId === connId) { hasSignal = true; break; }
      }
      matRef.current.emissiveIntensity = hasSignal ? 2.0 : 0.8;
    }
  });

  return (
    <mesh ref={ref}>
      <cylinderGeometry args={[0.02, 0.02, 1, 6]} />
      <meshStandardMaterial ref={matRef} color="#88ddff" emissive="#44aacc" emissiveIntensity={0.8} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// 3D: Ground plane
// ---------------------------------------------------------------------------
function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y, 0]} receiveShadow>
      <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
      <meshStandardMaterial color="#181838" roughness={0.9} metalness={0} />
    </mesh>
  );
}

function GroundGrid() {
  return (
    <gridHelper
      args={[GROUND_SIZE, 40, '#4a4a8a', '#2a2a5a']}
      position={[0, GROUND_Y + 0.001, 0]}
    />
  );
}

// ---------------------------------------------------------------------------
// 3D: Arena walls (transparent edges)
// ---------------------------------------------------------------------------
function ArenaWalls() {
  const wallHeight = 4;
  const wallY = GROUND_Y + wallHeight / 2;
  const walls = [
    { pos: [ARENA_HALF, wallY, 0] as const, rot: [0, -Math.PI / 2, 0] as const },
    { pos: [-ARENA_HALF, wallY, 0] as const, rot: [0, Math.PI / 2, 0] as const },
    { pos: [0, wallY, ARENA_HALF] as const, rot: [0, Math.PI, 0] as const },
    { pos: [0, wallY, -ARENA_HALF] as const, rot: [0, 0, 0] as const },
  ];
  return (
    <>
      {walls.map((w, i) => (
        <mesh key={i} position={w.pos} rotation={w.rot}>
          <planeGeometry args={[GROUND_SIZE, wallHeight]} />
          <meshBasicMaterial color="#4a4a8a" transparent opacity={0.05} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Undo stack (client-side, tracks add_atom calls)
// ---------------------------------------------------------------------------
type UndoEntry = { action: 'add'; atomId: bigint };
const undoStack: UndoEntry[] = [];

function pushUndo(entry: UndoEntry) {
  undoStack.push(entry);
  if (undoStack.length > 100) undoStack.shift();
}

function popUndo() {
  const entry = undoStack.pop();
  if (!entry) return;
  if (entry.action === 'add') {
    removeAtom(entry.atomId);
  }
}

// ---------------------------------------------------------------------------
// Toast notification
// ---------------------------------------------------------------------------
let toastTimeout: ReturnType<typeof setTimeout> | null = null;
let toastSetter: ((msg: string) => void) | null = null;

function showToast(msg: string) {
  if (toastSetter) toastSetter(msg);
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    if (toastSetter) toastSetter('');
  }, TOAST_DURATION_MS);
}

// ---------------------------------------------------------------------------
// 3D: Find atom under ray (scene traverse, closest to ray)
// ---------------------------------------------------------------------------
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _atomPos = new THREE.Vector3();

function findAtomUnderRay(scene: THREE.Scene, raycaster: THREE.Raycaster): bigint | null {
  _rayOrigin.copy(raycaster.ray.origin);
  _rayDir.copy(raycaster.ray.direction);

  let bestId: bigint | null = null;
  let bestDist = RAYCAST_THRESHOLD;

  scene.traverse((obj) => {
    if (!(obj as any).isGroup) return;
    const atomId = obj.userData?.atomId;
    if (atomId == null) return;

    obj.getWorldPosition(_atomPos);
    // Distance from point to ray
    const v = _atomPos.clone().sub(_rayOrigin);
    const proj = v.dot(_rayDir);
    if (proj < 0) return; // behind camera
    const closest = _rayOrigin.clone().addScaledVector(_rayDir, proj);
    const dist = closest.distanceTo(_atomPos);

    if (dist < bestDist) {
      bestDist = dist;
      bestId = atomId;
    }
  });

  return bestId;
}

// ---------------------------------------------------------------------------
// 3D: Interaction handler — drag, place, double-click, cursor
// ---------------------------------------------------------------------------
function InteractionHandler({
  tool, selectedType, onShowToast,
}: {
  tool: string | null;
  selectedType: string | null;
  onShowToast: (msg: string) => void;
}) {
  const { raycaster, camera, scene, gl } = useThree();
  const groundPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND_Y));
  const dragPlane = useRef(new THREE.Plane());
  const hitPoint = useRef(new THREE.Vector3());
  const dragTarget = useRef<bigint | null>(null);
  const dragOffset = useRef(new THREE.Vector3());
  const isDragging = useRef(false);
  const mouseDown = useRef<{ x: number; y: number } | null>(null);
  const hoveredAtomId = useRef<bigint | null>(null);

  // Cursor feedback in useFrame
  useFrame(() => {
    const hovered = findAtomUnderRay(scene, raycaster);
    hoveredAtomId.current = hovered;

    if (isDragging.current) {
      gl.domElement.style.cursor = 'grabbing';
    } else if (tool === 'select') {
      gl.domElement.style.cursor = hovered ? 'grab' : 'crosshair';
    } else if (selectedType) {
      gl.domElement.style.cursor = 'copy';
    } else {
      gl.domElement.style.cursor = 'default';
    }

    // Drag update
    if (isDragging.current && dragTarget.current != null) {
      raycaster.ray.intersectPlane(dragPlane.current, hitPoint.current);
      if (hitPoint.current) {
        dragAtom(
          dragTarget.current,
          hitPoint.current.x + dragOffset.current.x,
          hitPoint.current.y + dragOffset.current.y,
          hitPoint.current.z + dragOffset.current.z,
        );
      }
    }
  });

  // Double-click handler for HOLD/RELAY toggle
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const atomId = hoveredAtomId.current;
      if (atomId == null) return;
      const entry = atomEntries.get(atomId);
      if (!entry) return;

      if (entry.atomType === 'hold') {
        toggleHold(atomId);
        onShowToast(`HOLD ${entry.holdOn ? 'OFF' : 'ON'}`);
      } else if (entry.atomType === 'relay') {
        toggleRelayMode(atomId);
        const modes = ['pass', 'invert', 'block'];
        const nextIdx = (modes.indexOf(entry.relayMode) + 1) % modes.length;
        onShowToast(`RELAY: ${modes[nextIdx]}`);
      }
    };
    gl.domElement.addEventListener('dblclick', handler);
    return () => gl.domElement.removeEventListener('dblclick', handler);
  }, [gl, onShowToast]);

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    mouseDown.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };

    // Right-click: remove atom
    if (e.button === 2) {
      const atomId = hoveredAtomId.current;
      if (atomId != null) {
        e.stopPropagation();
        removeAtom(atomId);
        onShowToast('Atom removed');
      }
      return;
    }

    // Left-click with select tool: start drag
    if (tool === 'select' && hoveredAtomId.current != null) {
      const entry = atomEntries.get(hoveredAtomId.current);
      if (!entry) return;

      dragTarget.current = hoveredAtomId.current;
      isDragging.current = true;

      // Compute camera-perpendicular drag plane at atom position
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      const atomWorldPos = new THREE.Vector3(entry.curr.x, entry.curr.y, entry.curr.z);
      dragPlane.current.setFromNormalAndCoplanarPoint(camDir.negate(), atomWorldPos);

      // Compute offset from intersection to atom center
      raycaster.ray.intersectPlane(dragPlane.current, hitPoint.current);
      if (hitPoint.current) {
        dragOffset.current.copy(atomWorldPos).sub(hitPoint.current);
      }

      e.stopPropagation();
      return;
    }
  }, [tool, camera, raycaster, onShowToast]);

  const handlePointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (isDragging.current) {
      isDragging.current = false;
      dragTarget.current = null;
      return;
    }

    // Check if this was a click (not a drag)
    if (mouseDown.current) {
      const dx = e.nativeEvent.clientX - mouseDown.current.x;
      const dy = e.nativeEvent.clientY - mouseDown.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > CLICK_THRESHOLD) {
        mouseDown.current = null;
        return; // was a drag/orbit, not a click
      }
    }
    mouseDown.current = null;

    if (!selectedType && tool !== 'machine') return;
    raycaster.ray.intersectPlane(groundPlane.current, hitPoint.current);
    if (!hitPoint.current) return;
    const { x, z } = hitPoint.current;
    const spawnY = GROUND_Y + ATOM_RADIUS + 2;

    if (tool === 'machine' && selectedType) {
      spawnMachine(selectedType, x, spawnY, z);
      onShowToast(`Spawned ${selectedType}`);
    } else if (selectedType && ATOM_DEFS[selectedType]) {
      addAtom(selectedType, x, spawnY, z);
      onShowToast(`Added ${ATOM_DEFS[selectedType].name}`);
      // Track for undo — we need the ID, but addAtom is async.
      // We'll track the most recent atom entry added via store subscription.
    }
  }, [tool, selectedType, raycaster, onShowToast]);

  return (
    <mesh
      visible={false}
      position={[0, GROUND_Y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      <planeGeometry args={[200, 200]} />
      <meshBasicMaterial />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// 3D: Scene contents
// ---------------------------------------------------------------------------
function SceneExporter() {
  const { scene } = useThree();
  useEffect(() => {
    (window as any).__scene = scene;
    return () => { delete (window as any).__scene; };
  }, [scene]);
  return null;
}

function SceneContents({ tool, selectedType, onShowToast }: { tool: string | null; selectedType: string | null; onShowToast: (msg: string) => void }) {
  useStore();

  const atoms = Array.from(atomEntries.values());
  const conns = Array.from(connectionRows.values());

  return (
    <>
      <ambientLight intensity={0.4} />
      <hemisphereLight args={['#4466aa', '#1a1a2e', 0.5]} />
      <directionalLight position={[4, 4, 5]} intensity={3} color="#fff4e0" />
      <directionalLight position={[-4, 2, 3]} intensity={1.5} color="#c0d0ff" />
      <directionalLight position={[0, 3, -6]} intensity={2} color="#ffffff" />
      <Environment preset="apartment" environmentIntensity={0.3} />

      <Ground />
      <GroundGrid />
      <ArenaWalls />

      {atoms.map(entry => (
        <AtomGroup key={entry.id.toString()} entry={entry} />
      ))}

      {conns.map(row => (
        <Bridge key={row.id.toString()} fromId={row.fromAtomId} toId={row.toAtomId} connId={row.id} />
      ))}

      <SignalDots />
      <Tendrils />

      <SceneExporter />
      <InteractionHandler tool={tool} selectedType={selectedType} onShowToast={onShowToast} />

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2 + 0.3}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// UI: HUD overlay
// ---------------------------------------------------------------------------
function HUD() {
  const { frozen: isFrozen, atomCount: count, connStatus: status } = useStore();

  return (
    <div style={{
      position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)',
      zIndex: 20, display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <button
        onClick={() => toggleFreeze()}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 18px',
          background: isFrozen ? 'rgba(79,195,247,0.12)' : 'rgba(10,10,20,0.6)',
          border: `1px solid ${isFrozen ? 'rgba(79,195,247,0.5)' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: 20, color: isFrozen ? '#4fc3f7' : '#888',
          fontSize: 12, fontWeight: 600, cursor: 'pointer',
          textTransform: 'uppercase' as const, letterSpacing: 1,
          backdropFilter: 'blur(12px)',
        }}
      >
        <span>&#10052;</span>
        <span>{isFrozen ? 'Frozen' : 'Running'}</span>
        <span style={{ fontSize: 10, color: '#666', marginLeft: 4 }}>[Space]</span>
      </button>
      <div style={hudPill}>{count} atom{count !== 1 ? 's' : ''}</div>
      <div style={{ ...hudPill, color: status === 'Connected' ? '#4fc3f7' : '#e8603c' }}>{status}</div>
    </div>
  );
}

const hudPill: React.CSSProperties = {
  padding: '5px 14px',
  background: 'rgba(10,10,20,0.5)',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 20, fontSize: 11, color: '#666', letterSpacing: 0.5,
};

// ---------------------------------------------------------------------------
// UI: Left palette (atoms)
// ---------------------------------------------------------------------------
function AtomPalette({ selected, onSelect }: { selected: string | null; onSelect: (t: string | null) => void }) {
  return (
    <div style={{
      position: 'fixed', left: 16, top: '50%', transform: 'translateY(-50%)',
      zIndex: 20, display: 'flex', flexDirection: 'column', gap: 8,
      background: 'rgba(10,10,20,0.55)', backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 12px',
      minWidth: 140,
    }}>
      <h3 style={panelTitle}>Atoms</h3>
      {Object.entries(ATOM_DEFS).map(([key, def]) => (
        <button
          key={key}
          onClick={() => onSelect(selected === key ? null : key)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 12px',
            background: selected === key ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${selected === key ? def.color : 'rgba(255,255,255,0.06)'}`,
            borderRadius: 10, color: selected === key ? '#fff' : '#aaa',
            fontSize: 13, cursor: 'pointer',
          }}
        >
          <div style={{
            width: key === 'flex' ? 22 : 14, height: key === 'flex' ? 10 : 14,
            borderRadius: key === 'flex' ? 7 : '50%',
            background: def.color, boxShadow: `0 0 6px ${def.color}`,
          }} />
          <span style={{ fontSize: 12 }}>{def.name}</span>
          <span style={{ fontSize: 9, color: '#666', marginLeft: 'auto' }}>{def.hint}</span>
        </button>
      ))}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />
      <button
        onClick={() => onSelect(selected === 'select' ? null : 'select')}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 12px',
          background: selected === 'select' ? 'rgba(79,195,247,0.15)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${selected === 'select' ? 'rgba(79,195,247,0.4)' : 'rgba(255,255,255,0.06)'}`,
          borderRadius: 10, color: selected === 'select' ? '#4fc3f7' : '#888',
          fontSize: 12, cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 15, width: 18, textAlign: 'center' as const }}>&#9997;</span>
        Select [V]
      </button>
      <button
        onClick={() => clearArena()}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 12px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 10, color: '#e8603c', fontSize: 12, cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 15, width: 18, textAlign: 'center' as const }}>&#128465;</span>
        Clear All
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UI: Right palette (machines)
// ---------------------------------------------------------------------------
function MachinePalette({ onSpawn }: { onSpawn: (key: string) => void }) {
  return (
    <div style={{
      position: 'fixed', right: 16, top: '50%', transform: 'translateY(-50%)',
      zIndex: 20, display: 'flex', flexDirection: 'column', gap: 8,
      background: 'rgba(10,10,20,0.55)', backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 12px',
      minWidth: 170, maxWidth: 190,
    }}>
      <h3 style={panelTitle}>Machines</h3>
      {MACHINE_DEFS.map(m => (
        <div
          key={m.key}
          onClick={() => onSpawn(m.key)}
          style={{
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 10, cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: '#ccc', marginBottom: 3 }}>{m.name}</div>
          <div style={{ fontSize: 10, color: '#666', lineHeight: 1.3 }}>{m.desc}</div>
          <div style={{ display: 'flex', gap: 3, marginTop: 6, flexWrap: 'wrap' }}>
            {m.atoms.map((a, i) => {
              const def = ATOM_DEFS[a];
              return (
                <div key={i} style={{
                  width: a === 'flex' ? 12 : 8, height: a === 'flex' ? 6 : 8,
                  borderRadius: a === 'flex' ? 4 : '50%',
                  background: def?.color || '#888',
                }} />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const panelTitle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: 2, color: '#555', marginBottom: 2, textAlign: 'center',
};

// ---------------------------------------------------------------------------
// UI: Bottom hint bar
// ---------------------------------------------------------------------------
function HintBar() {
  return (
    <div style={{
      position: 'fixed', bottom: 14, left: '50%', transform: 'translateX(-50%)',
      zIndex: 20, padding: '5px 20px',
      background: 'rgba(10,10,20,0.5)', backdropFilter: 'blur(8px)',
      borderRadius: 20, fontSize: 11, color: '#555', whiteSpace: 'nowrap', pointerEvents: 'none',
    }}>
      Click atom type then click arena to place · Click machine to quick-spawn · Right-click to remove · [Space] freeze/unfreeze
    </div>
  );
}

// ---------------------------------------------------------------------------
// App root
// ---------------------------------------------------------------------------
export function App() {
  const [tool, setTool] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState('');

  useEffect(() => {
    toastSetter = setToastMsg;
    return () => { toastSetter = null; };
  }, []);

  useEffect(() => { connectToSTDB(); }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); toggleFreeze(); }
      if (e.code === 'KeyV') { setTool(t => t === 'select' ? null : 'select'); setSelectedType(null); }
      if (e.code === 'Escape') { setTool(null); setSelectedType(null); }
      if (e.code === 'Delete' || e.code === 'Backspace') {
        // Remove will be handled by right-click in InteractionHandler
        // This is a fallback for keyboard-only usage
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        popUndo();
        showToast('Undo');
      }
      if (e.key >= '1' && e.key <= '5') {
        const types = Object.keys(ATOM_DEFS);
        const idx = parseInt(e.key) - 1;
        if (idx < types.length) { setSelectedType(types[idx]); setTool(null); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleAtomSelect = (t: string | null) => {
    if (t === 'select') {
      setTool('select');
      setSelectedType(null);
    } else {
      setTool(null);
      setSelectedType(t);
    }
  };

  const handleMachineSpawn = (key: string) => {
    spawnMachine(key, 0, GROUND_Y + ATOM_RADIUS + 3, 0);
  };

  return (
    <div style={{ width: '100vw', height: '100vh', background: BG_COLOR }}>
      <Canvas
        camera={{ fov: 50, near: 0.1, far: 100, position: [3, 2.5, 5] }}
        onContextMenu={(e) => e.preventDefault()}
        style={{ background: BG_COLOR }}
      >
        <fog attach="fog" args={[BG_COLOR, 15, 60]} />
        <SceneContents tool={tool} selectedType={selectedType} onShowToast={showToast} />
      </Canvas>
      <HUD />
      <AtomPalette selected={tool === 'select' ? 'select' : selectedType} onSelect={handleAtomSelect} />
      <MachinePalette onSpawn={handleMachineSpawn} />
      <HintBar />
      {toastMsg && (
        <div style={{
          position: 'fixed', bottom: 60, left: '50%', transform: 'translateX(-50%)',
          zIndex: 30, padding: '8px 24px',
          background: 'rgba(10,10,20,0.8)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 20, fontSize: 13, color: '#ddd', whiteSpace: 'nowrap',
          animation: 'toast-fade 0.2s ease-out',
        }}>
          {toastMsg}
        </div>
      )}
    </div>
  );
}
