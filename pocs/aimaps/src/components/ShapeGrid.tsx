import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Geometry subdivision count — higher = more displacement detail, more GPU work */
const SUBDIVISIONS = 64;

/** Spacing between shapes in the 2x2 grid (world units) */
const GRID_SPACING = 2.4;

/** How far vertices displace along their normals */
const DISPLACEMENT_SCALE = 0.15;

/** Bump intensity for lighting detail on displaced surfaces */
const BUMP_SCALE = 0.25;

/** Slow auto-rotation speed (radians per ms) */
const ROTATION_SPEED = 0.0003;

const SHAPE_NAMES = ['Cylinder', 'Cone', 'Sphere', 'Cube'] as const;

const HALF_GRID = GRID_SPACING / 2;

const GRID_POSITIONS: [number, number, number][] = [
  [-HALF_GRID, 0, -HALF_GRID], // row 1 col 1 — Cylinder
  [HALF_GRID, 0, -HALF_GRID], // row 1 col 2 — Cone
  [-HALF_GRID, 0, HALF_GRID], // row 2 col 1 — Sphere
  [HALF_GRID, 0, HALF_GRID], // row 2 col 2 — Cube
];

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  meshes: THREE.Mesh[];
  frameId: number;
}

function createGeometries(): THREE.BufferGeometry[] {
  return [
    new THREE.CylinderGeometry(
      0.55,
      0.55,
      1.1,
      SUBDIVISIONS,
      SUBDIVISIONS,
      false,
    ),
    new THREE.ConeGeometry(0.6, 1.2, SUBDIVISIONS, SUBDIVISIONS),
    new THREE.SphereGeometry(0.6, SUBDIVISIONS, SUBDIVISIONS),
    new THREE.BoxGeometry(
      1,
      1,
      1,
      SUBDIVISIONS,
      SUBDIVISIONS,
      SUBDIVISIONS,
    ),
  ];
}

function initScene(canvas: HTMLCanvasElement): SceneState {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a1a);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 4.5, 6);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 0, 0);

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
  keyLight.position.set(5, 8, 5);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x4466cc, 0.3);
  fillLight.position.set(-3, 2, -3);
  scene.add(fillLight);

  // Subtle ground grid
  const GRID_SIZE = 8;
  const GRID_DIVISIONS = 16;
  const grid = new THREE.GridHelper(
    GRID_SIZE,
    GRID_DIVISIONS,
    0x222244,
    0x1a1a2e,
  );
  grid.position.y = -0.8;
  scene.add(grid);

  // Meshes
  const geometries = createGeometries();
  const meshes = geometries.map((geom, i) => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x6699cc,
      roughness: 0.35,
      metalness: 0.15,
      displacementScale: 0,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(...GRID_POSITIONS[i]);
    scene.add(mesh);
    return mesh;
  });

  return { renderer, scene, camera, controls, meshes, frameId: 0 };
}

interface ShapeGridProps {
  displacementMapUrl: string | null;
}

export function ShapeGrid({ displacementMapUrl }: ShapeGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<SceneState | null>(null);

  // Initialise Three.js scene once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const state = initScene(canvas);
    stateRef.current = state;

    function resize() {
      const parent = canvas!.parentElement!;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      state.renderer.setSize(w, h);
      state.camera.aspect = w / h;
      state.camera.updateProjectionMatrix();
    }

    resize();
    window.addEventListener('resize', resize);

    function animate() {
      state.frameId = requestAnimationFrame(animate);
      state.controls.update();

      // Gentle auto-rotation per shape (offset so they don't all align)
      const t = performance.now() * ROTATION_SPEED;
      state.meshes.forEach((mesh, i) => {
        mesh.rotation.y = t + i * Math.PI * 0.5;
      });

      state.renderer.render(state.scene, state.camera);
    }
    animate();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(state.frameId);
      state.controls.dispose();
      state.renderer.dispose();
    };
  }, []);

  // Apply/remove displacement map when URL changes
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;

    if (!displacementMapUrl) {
      state.meshes.forEach((mesh) => {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.displacementMap = null;
        mat.bumpMap = null;
        mat.displacementScale = 0;
        mat.needsUpdate = true;
      });
      return;
    }

    const loader = new THREE.TextureLoader();
    loader.load(displacementMapUrl, (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;

      state.meshes.forEach((mesh) => {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.displacementMap = texture;
        mat.displacementScale = DISPLACEMENT_SCALE;
        mat.bumpMap = texture;
        mat.bumpScale = BUMP_SCALE;
        mat.needsUpdate = true;
      });
    });
  }, [displacementMapUrl]);

  return (
    <div className="shape-grid">
      <canvas ref={canvasRef} />
      <div className="shape-labels">
        {SHAPE_NAMES.map((name) => (
          <div key={name} className="shape-label">
            {name}
          </div>
        ))}
      </div>
    </div>
  );
}
