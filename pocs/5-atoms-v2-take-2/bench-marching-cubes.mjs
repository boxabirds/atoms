/**
 * MarchingCubes Performance Benchmark
 *
 * Measures frame times for Three.js MarchingCubes at varying atom counts
 * and resolutions. Launches a headful Chromium via Playwright with WebGPU flags.
 *
 * Usage:  node bench-marching-cubes.mjs
 * Output: table of atomCount | resolution | avgFPS | p1FPS
 */

import { chromium } from 'playwright';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Benchmark parameters ────────────────────────────────────────────────
const ATOM_COUNTS = [100, 500, 1000, 5000, 10_000];
const RESOLUTIONS = [64, 128];
const FRAMES_PER_RUN = 60;
const WARMUP_FRAMES = 10;

// ── Inline HTML benchmark page ──────────────────────────────────────────
const benchHTML = /* html */ `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>MarchingCubes Bench</title>
<style>
  * { margin: 0; padding: 0; }
  body { background: #000; overflow: hidden; }
  canvas { display: block; width: 100vw; height: 100vh; }
</style>
<script type="importmap">
{ "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.173.0/build/three.webgpu.js",
    "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.173.0/build/three.webgpu.js",
    "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.173.0/build/three.tsl.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.173.0/examples/jsm/"
}}
</script>
</head>
<body>
<script type="module">
import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ── Constants ───────────────────────────────────────────────────────────
const BALL_STRENGTH = 1.2;
const BALL_SUBTRACT = 12;
const CLUSTER_SPREAD = 0.35;   // how far balls spread from center (0-0.5)
const CLUSTER_CENTER = 0.5;    // center of the unit cube
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

// ── Setup renderer ──────────────────────────────────────────────────────
const renderer = new THREE.WebGPURenderer({ antialias: false });
renderer.setSize(CANVAS_WIDTH, CANVAS_HEIGHT);
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);

await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111122);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
const envTexture = pmremGenerator.fromScene(new RoomEnvironment()).texture;
scene.environment = envTexture;

const camera = new THREE.PerspectiveCamera(45, CANVAS_WIDTH / CANVAS_HEIGHT, 0.1, 100);
camera.position.set(0, 0, 3);
camera.lookAt(0, 0, 0);

const material = new THREE.MeshPhysicalMaterial({
  color: 0x44aaff,
  roughness: 0.2,
  metalness: 0.1,
  clearcoat: 0.5,
  clearcoatRoughness: 0.1,
  envMapIntensity: 1.0,
});

// ── Deterministic pseudo-random for reproducibility ─────────────────────
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Pre-generate ball positions for the max atom count ──────────────────
const MAX_ATOMS = 10000;
const PRNG_SEED = 42;
const rng = mulberry32(PRNG_SEED);
const ballPositions = [];
for (let i = 0; i < MAX_ATOMS; i++) {
  ballPositions.push({
    x: CLUSTER_CENTER + (rng() - 0.5) * CLUSTER_SPREAD * 2,
    y: CLUSTER_CENTER + (rng() - 0.5) * CLUSTER_SPREAD * 2,
    z: CLUSTER_CENTER + (rng() - 0.5) * CLUSTER_SPREAD * 2,
  });
}

// ── Benchmark harness ───────────────────────────────────────────────────
const ATOM_COUNTS = ${JSON.stringify(ATOM_COUNTS)};
const RESOLUTIONS = ${JSON.stringify(RESOLUTIONS)};
const FRAMES_PER_RUN = ${FRAMES_PER_RUN};
const WARMUP_FRAMES = ${WARMUP_FRAMES};

async function measureFrames(mc, numFrames) {
  const times = [];
  for (let i = 0; i < numFrames; i++) {
    const t0 = performance.now();
    await renderer.renderAsync(scene, camera);
    const t1 = performance.now();
    times.push(t1 - t0);
  }
  return times;
}

function computeStats(frameTimes) {
  const sorted = [...frameTimes].sort((a, b) => b - a); // descending (worst first)
  const p1Count = Math.max(1, Math.ceil(frameTimes.length * 0.01));
  const p1Avg = sorted.slice(0, p1Count).reduce((s, v) => s + v, 0) / p1Count;
  const avg = frameTimes.reduce((s, v) => s + v, 0) / frameTimes.length;
  return {
    avgFPS: (1000 / avg).toFixed(1),
    p1FPS: (1000 / p1Avg).toFixed(1),
    avgMs: avg.toFixed(2),
    p1Ms: p1Avg.toFixed(2),
  };
}

const results = [];

for (const resolution of RESOLUTIONS) {
  // Create a fresh MarchingCubes for each resolution
  const mc = new MarchingCubes(resolution, material, true, true, 100000);
  mc.isolation = 80;
  mc.position.set(0, 0, 0);
  mc.scale.setScalar(1.5);
  scene.add(mc);

  for (const atomCount of ATOM_COUNTS) {
    // Populate balls
    mc.reset();
    for (let i = 0; i < atomCount; i++) {
      const p = ballPositions[i];
      mc.addBall(p.x, p.y, p.z, BALL_STRENGTH, BALL_SUBTRACT);
    }

    // Warmup
    await measureFrames(mc, WARMUP_FRAMES);

    // Measure
    const frameTimes = await measureFrames(mc, FRAMES_PER_RUN);
    const stats = computeStats(frameTimes);

    results.push({
      atomCount,
      resolution,
      ...stats,
    });

    console.log(
      \`[bench] atoms=\${atomCount} res=\${resolution} avgFPS=\${stats.avgFPS} p1FPS=\${stats.p1FPS} avgMs=\${stats.avgMs} p1Ms=\${stats.p1Ms}\`
    );
  }

  scene.remove(mc);
  mc.geometry.dispose();
}

// Signal completion
window.__benchResults = results;
window.__benchDone = true;
</script>
</body>
</html>`;

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  // Write HTML to a temp file (data URIs can't use importmaps)
  const tmpHTML = join(tmpdir(), `bench-mc-${Date.now()}.html`);
  writeFileSync(tmpHTML, benchHTML, 'utf-8');
  console.log(`[bench] Wrote temp HTML to ${tmpHTML}`);

  const browser = await chromium.launch({
    headless: false,
    args: [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan,UseSkiaRenderer',
      '--disable-dawn-features=disallow_unsafe_apis',
      '--use-angle=metal',           // M2 Metal backend
      '--enable-gpu-rasterization',
      '--ignore-gpu-blocklist',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 900, height: 700 },
  });
  const page = await context.newPage();

  // Forward page console to Node
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.startsWith('[bench]')) {
      console.log(text);
    }
  });

  page.on('pageerror', (err) => {
    console.error('[page error]', err.message);
  });

  console.log('[bench] Loading benchmark page...');
  await page.goto(`file://${tmpHTML}`, { waitUntil: 'domcontentloaded' });

  // Wait for benchmark completion (up to 10 minutes for large runs)
  const BENCH_TIMEOUT_MS = 600_000;
  console.log('[bench] Waiting for benchmark to complete...');

  try {
    await page.waitForFunction(() => window.__benchDone === true, null, {
      timeout: BENCH_TIMEOUT_MS,
      polling: 1000,
    });
  } catch (err) {
    console.error('[bench] Timed out waiting for benchmark to finish.');
    await browser.close();
    unlinkSync(tmpHTML);
    process.exit(1);
  }

  // Retrieve results
  const results = await page.evaluate(() => window.__benchResults);

  // Print table
  console.log('\n' + '='.repeat(62));
  console.log('  MarchingCubes Benchmark Results');
  console.log('='.repeat(62));
  console.log(
    'Atoms'.padStart(8) +
      'Res'.padStart(6) +
      'Avg FPS'.padStart(10) +
      'P1 FPS'.padStart(10) +
      'Avg ms'.padStart(10) +
      'P1 ms'.padStart(10)
  );
  console.log('-'.repeat(62));

  for (const r of results) {
    console.log(
      String(r.atomCount).padStart(8) +
        String(r.resolution).padStart(6) +
        r.avgFPS.padStart(10) +
        r.p1FPS.padStart(10) +
        r.avgMs.padStart(10) +
        r.p1Ms.padStart(10)
    );
  }
  console.log('='.repeat(62));
  console.log();

  await browser.close();
  unlinkSync(tmpHTML);
  console.log('[bench] Done. Temp file cleaned up.');
}

main().catch((err) => {
  console.error('[bench] Fatal error:', err);
  process.exit(1);
});
