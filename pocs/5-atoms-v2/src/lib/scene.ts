import * as THREE from 'three';
import { WebGPURenderer, PMREMGenerator } from 'three/webgpu';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// ---------------------------------------------------------------------------
// Constants (from aimaps pattern)
// ---------------------------------------------------------------------------

const DEFAULT_EXPOSURE = 1.8;
const ENV_INTENSITY = 3.0;
const BACKGROUND_COLOR = 0x0a0a1a;
const GRID_SIZE = 20;
const GRID_DIVISIONS = 40;

// ---------------------------------------------------------------------------
// Scene state
// ---------------------------------------------------------------------------

export interface SceneState {
  renderer: WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export async function initScene(canvas: HTMLCanvasElement): Promise<SceneState> {
  const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false });
  await renderer.init();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = DEFAULT_EXPOSURE;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND_COLOR);

  // PBR environment (soft-box studio reflections)
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
  scene.environmentIntensity = ENV_INTENSITY;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(0, 8, 12);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 1, 0);

  // 3-point lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));

  const keyLight = new THREE.DirectionalLight(0xfff4e0, 3.0);
  keyLight.position.set(4, 6, 5);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xc0d0ff, 1.5);
  fillLight.position.set(-4, 3, 3);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 2.0);
  rimLight.position.set(0, 4, -6);
  scene.add(rimLight);

  // Ground grid
  const grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS, 0x222244, 0x1a1a2e);
  grid.position.y = 0;
  scene.add(grid);

  // Solid ground plane (invisible but provides visual grounding)
  const groundGeo = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE);
  const groundMat = new THREE.MeshPhysicalMaterial({
    color: 0x12121e,
    roughness: 0.9,
    metalness: 0.0,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  return { renderer, scene, camera, controls };
}
