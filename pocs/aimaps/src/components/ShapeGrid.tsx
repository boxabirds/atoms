import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { HistoryEntry, MapKey } from '../lib/types';
import { DEFAULT_SCALARS } from '../lib/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Geometry subdivision count — higher = more displacement detail */
const SUBDIVISIONS = 64;

/** Spacing between shapes in the 2x2 grid (world units) */
const GRID_SPACING = 2.4;

/** Slow auto-rotation speed (radians per ms) */
const ROTATION_SPEED = 0.0003;

/** Default normal map scale (x, y) */
const NORMAL_SCALE = new THREE.Vector2(1.0, 1.0);

const SHAPE_NAMES = ['Cylinder', 'Cone', 'Sphere', 'Cube'] as const;

const HALF_GRID = GRID_SPACING / 2;

const GRID_POSITIONS: [number, number, number][] = [
  [-HALF_GRID, 0, -HALF_GRID],
  [HALF_GRID, 0, -HALF_GRID],
  [-HALF_GRID, 0, HALF_GRID],
  [HALF_GRID, 0, HALF_GRID],
];

/** Neutral base color when no albedo map is applied */
const NEUTRAL_COLOR = 0x6699cc;

// ---------------------------------------------------------------------------
// Scene setup
// ---------------------------------------------------------------------------

interface SceneState {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>[];
  frameId: number;
  /** Cache loaded textures to avoid reloading unchanged maps */
  textureCache: Map<string, THREE.Texture>;
}

function createGeometries(): THREE.BufferGeometry[] {
  return [
    new THREE.CylinderGeometry(0.55, 0.55, 1.1, SUBDIVISIONS, SUBDIVISIONS, false),
    new THREE.ConeGeometry(0.6, 1.2, SUBDIVISIONS, SUBDIVISIONS),
    new THREE.SphereGeometry(0.6, SUBDIVISIONS, SUBDIVISIONS),
    new THREE.BoxGeometry(1, 1, 1, SUBDIVISIONS, SUBDIVISIONS, SUBDIVISIONS),
  ];
}

function initScene(canvas: HTMLCanvasElement): SceneState {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a1a);

  // Environment map for reflections on metallic/transmissive surfaces
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x222244);
  const envMap = pmrem.fromScene(envScene).texture;
  scene.environment = envMap;
  pmrem.dispose();

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

  // Ground grid
  const grid = new THREE.GridHelper(8, 16, 0x222244, 0x1a1a2e);
  grid.position.y = -0.8;
  scene.add(grid);

  // Meshes — use MeshPhysicalMaterial for full PBR support
  const geometries = createGeometries();
  const meshes = geometries.map((geom, i) => {
    const mat = new THREE.MeshPhysicalMaterial({
      color: NEUTRAL_COLOR,
      roughness: DEFAULT_SCALARS.roughness,
      metalness: DEFAULT_SCALARS.metalness,
      displacementScale: 0,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(...GRID_POSITIONS[i]);
    scene.add(mesh);
    return mesh;
  });

  return { renderer, scene, camera, controls, meshes, frameId: 0, textureCache: new Map() };
}

// ---------------------------------------------------------------------------
// Texture helpers
// ---------------------------------------------------------------------------

const loader = new THREE.TextureLoader();

function loadTexture(
  state: SceneState,
  dataUrl: string,
  colorSpace: THREE.ColorSpace = THREE.LinearSRGBColorSpace,
): THREE.Texture {
  const cached = state.textureCache.get(dataUrl);
  if (cached) return cached;

  const tex = loader.load(dataUrl);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = colorSpace;
  state.textureCache.set(dataUrl, tex);
  return tex;
}

/** Clear all PBR maps and reset scalars to defaults */
function resetMaterial(mat: THREE.MeshPhysicalMaterial) {
  mat.map = null;
  mat.normalMap = null;
  mat.normalScale.copy(NORMAL_SCALE);
  mat.displacementMap = null;
  mat.displacementScale = 0;
  mat.roughnessMap = null;
  mat.metalnessMap = null;
  mat.emissiveMap = null;
  mat.emissive.setHex(0x000000);
  mat.emissiveIntensity = 0;
  mat.color.setHex(NEUTRAL_COLOR);
  mat.roughness = DEFAULT_SCALARS.roughness;
  mat.metalness = DEFAULT_SCALARS.metalness;
  mat.transmission = 0;
  mat.thickness = 0;
  mat.ior = 1.5;
  mat.transparent = false;
  mat.needsUpdate = true;
}

/** Apply a full HistoryEntry (recipe scalars + whatever maps are available) */
function applyEntry(state: SceneState, entry: HistoryEntry) {
  const { maps, recipe } = entry;
  const s = recipe.scalars;

  state.meshes.forEach((mesh) => {
    const mat = mesh.material;
    resetMaterial(mat);

    // --- Scalars ---
    mat.roughness = s.roughness;
    mat.metalness = s.metalness;
    mat.transmission = s.transmission;
    mat.thickness = s.thickness;
    mat.ior = s.ior;
    mat.transparent = s.transmission > 0;
    mat.displacementScale = maps.displacement ? s.displacementScale : 0;

    if (s.emissiveIntensity > 0) {
      mat.emissiveIntensity = s.emissiveIntensity;
      if (s.emissiveColor) mat.emissive.setStyle(s.emissiveColor);
    }

    // --- Texture maps ---
    const mapSlots: [MapKey, keyof THREE.MeshPhysicalMaterial, THREE.ColorSpace][] = [
      ['displacement', 'displacementMap', THREE.LinearSRGBColorSpace],
      ['normal', 'normalMap', THREE.LinearSRGBColorSpace],
      ['albedo', 'map', THREE.SRGBColorSpace],
      ['roughness', 'roughnessMap', THREE.LinearSRGBColorSpace],
      ['metalness', 'metalnessMap', THREE.LinearSRGBColorSpace],
      ['emissive', 'emissiveMap', THREE.SRGBColorSpace],
    ];

    for (const [key, slot, colorSpace] of mapSlots) {
      const dataUrl = maps[key];
      if (dataUrl) {
        (mat as Record<string, unknown>)[slot] = loadTexture(state, dataUrl, colorSpace);
      }
    }

    // When albedo map is applied, set base color to white so the texture shows through
    if (maps.albedo) {
      mat.color.setHex(0xffffff);
    }

    mat.needsUpdate = true;
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ShapeGridProps {
  entry: HistoryEntry | null;
}

export function ShapeGrid({ entry }: ShapeGridProps) {
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

  // Apply/reset material when entry changes
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;

    if (!entry) {
      state.meshes.forEach((mesh) => resetMaterial(mesh.material));
      return;
    }

    applyEntry(state, entry);
  }, [entry]);

  return (
    <div className="shape-grid">
      <canvas ref={canvasRef} />
      <div className="shape-labels">
        {SHAPE_NAMES.map((name) => (
          <div key={name} className="shape-label">{name}</div>
        ))}
      </div>
    </div>
  );
}
