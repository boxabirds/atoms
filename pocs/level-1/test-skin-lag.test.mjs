/**
 * Reproduce: skin mesh updates at ~1fps while atoms move smoothly.
 *
 * Spawns 4 Signal Chain machines on the ground using the real spawnMachine(),
 * applies different skins, lets physics settle, then measures how fast
 * skin geometry tracks atom movement during normal physics simulation.
 *
 * Run: node test-skin-lag.test.mjs
 */
import { chromium } from 'playwright';

const BASE_URL = process.env.TEST_PAGE_URL || 'http://localhost:8000';
const SETTLE_MS = 4000;
const MEASURE_MS = 5000;
const MIN_SKIN_UPDATE_RATE = 5; // per molecule per second

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
page.on('console', msg => { if (msg.type() === 'error') console.error('CONSOLE:', msg.text()); });

await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

console.log('\n═══ Reproduce: Skin Lag with 4 Signal Chains ═══\n');

// Unfreeze simulation (starts frozen by default)
await page.evaluate(() => { window.__test.isFrozen = false; });
console.log('Simulation unfrozen.');

// Spawn 8 mixed machines on the ground — realistic, demanding scenario
console.log('Spawning 8 mixed machines on the ground...');
await page.evaluate(() => {
  const t = window.__test;
  const V3 = t.THREE.Vector3;
  const oscIdx = t.PREBUILT_MACHINES.findIndex(m => m.name === 'Oscillator');
  const walkIdx = t.PREBUILT_MACHINES.findIndex(m => m.name === 'Walker');
  const chainIdx = t.PREBUILT_MACHINES.findIndex(m => m.name === 'Signal Chain');
  const reflexIdx = t.PREBUILT_MACHINES.findIndex(m => m.name === 'Reflex Arc');
  t.spawnMachine(oscIdx, new V3(-6, 0, 0));
  t.spawnMachine(walkIdx, new V3(-3, 0, 0));
  t.spawnMachine(chainIdx, new V3(0, 0, 0));
  t.spawnMachine(reflexIdx, new V3(3, 0, 0));
  t.spawnMachine(oscIdx, new V3(-6, 0, 3));
  t.spawnMachine(walkIdx, new V3(-3, 0, 3));
  t.spawnMachine(chainIdx, new V3(0, 0, 3));
  t.spawnMachine(reflexIdx, new V3(3, 0, 3));
});

console.log(`Letting physics settle for ${SETTLE_MS / 1000}s...`);
await page.waitForTimeout(SETTLE_MS);

// Apply different skins
console.log('Applying different skins...');
const skinNames = ['rusty-and-warped', 'lumpy-translucent-gold', 'aquamarine-glass', 'flickering-flame'];
await page.evaluate(async (skinNames) => {
  const t = window.__test;
  let i = 0;
  for (const [, entry] of t.moleculeSkins.entries()) {
    const skinName = skinNames[i % skinNames.length];
    const reg = t.SKIN_REGISTRY.find(s => s.name === skinName);
    if (reg && reg.type === 'json') await t.loadSkinFromJSON(reg.name, reg.path);
    if (reg) {
      const mat = t.createSkinMaterial(skinName, 0xdd7744);
      if (entry.mesh) { entry.mesh.material.dispose(); entry.mesh.material = mat; }
      entry.skinType = skinName;
    }
    i++;
  }
}, skinNames);
await page.waitForTimeout(500);

// Report setup
const setup = await page.evaluate(() => {
  const t = window.__test;
  const conns = new Set();
  for (const a of t.atoms) {
    for (const c of a.connections) {
      conns.add([c.fromAtomId, c.toAtomId].sort().join('-'));
    }
  }
  return {
    atoms: t.atoms.length,
    connections: conns.size,
    molecules: t.moleculeSkins.size,
    details: [...t.moleculeSkins.entries()].map(([k, e]) => ({
      key: k, atoms: e.atomIds.length, skin: e.skinType, hasMesh: !!e.mesh,
      y: (() => {
        const a = t.atoms.find(at => at.id === e.atomIds[0]);
        return a ? a.group.position.y.toFixed(2) : '?';
      })(),
    })),
  };
});
console.log(`Setup: ${setup.atoms} atoms, ${setup.connections} conns, ${setup.molecules} molecules`);
for (const m of setup.details) {
  console.log(`  [${m.key}] ${m.atoms} atoms, y≈${m.y}, skin=${m.skin}, mesh=${m.hasMesh}`);
}

// ── Measure: let physics run naturally (pulses fire, things bounce) ──────

console.log(`\nMeasuring skin update rate over ${MEASURE_MS / 1000}s with live physics...\n`);

const result = await page.evaluate((measureMs) => {
  return new Promise(resolve => {
    const t = window.__test;
    const start = performance.now();
    const frameTimes = [];

    // Track geometry id per molecule to detect updates
    const geoIds = new Map();
    const geoUpdateCounts = new Map();
    for (const [key, entry] of t.moleculeSkins.entries()) {
      geoIds.set(key, entry.mesh?.geometry?.id ?? -1);
      geoUpdateCounts.set(key, 0);
    }

    // Track spatial lag: distance between atom centroid and mesh world position
    const spatialLagSamples = new Map(); // key → number[]

    // Track molecule composition changes
    let molKeyChurn = 0;
    let lastKeys = new Set(t.moleculeSkins.keys());

    function tick() {
      const now = performance.now();
      frameTimes.push(now);

      // Detect geometry changes
      for (const [key, entry] of t.moleculeSkins.entries()) {
        const geoId = entry.mesh?.geometry?.id ?? -1;
        if (geoId !== geoIds.get(key) && geoId !== -1) {
          geoIds.set(key, geoId);
          geoUpdateCounts.set(key, (geoUpdateCounts.get(key) || 0) + 1);
        }

        // Measure spatial lag: atom centroid vs mesh bounding sphere center + mesh.position
        if (entry.mesh && entry.mesh.geometry.boundingSphere) {
          const ids = entry.atomIds || [];
          let cx = 0, cy = 0, cz = 0, n = 0;
          for (const id of ids) {
            const a = t.atoms.find(at => at.id === id);
            if (a) { cx += a.group.position.x; cy += a.group.position.y; cz += a.group.position.z; n++; }
          }
          if (n > 0) {
            cx /= n; cy /= n; cz /= n;
            const bs = entry.mesh.geometry.boundingSphere.center;
            const mp = entry.mesh.position;
            const dx = cx - (bs.x + mp.x), dy = cy - (bs.y + mp.y), dz = cz - (bs.z + mp.z);
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (!spatialLagSamples.has(key)) spatialLagSamples.set(key, []);
            spatialLagSamples.get(key).push(dist);
          }
        }
      }

      // Track key churn
      const curKeys = new Set(t.moleculeSkins.keys());
      for (const k of curKeys) if (!lastKeys.has(k)) molKeyChurn++;
      for (const k of lastKeys) if (!curKeys.has(k)) molKeyChurn++;
      lastKeys = curKeys;

      if (now - start < measureMs) requestAnimationFrame(tick);
      else {
        const ft = [];
        for (let i = 1; i < frameTimes.length; i++) ft.push(frameTimes[i] - frameTimes[i - 1]);
        ft.sort((a, b) => a - b);
        const avg = ft.reduce((a, b) => a + b, 0) / ft.length;

        const molecules = [];
        for (const [key, entry] of t.moleculeSkins.entries()) {
          const updates = geoUpdateCounts.get(key) || 0;
          const lagSamples = spatialLagSamples.get(key) || [];
          const avgLag = lagSamples.length > 0
            ? lagSamples.reduce((a, b) => a + b, 0) / lagSamples.length : 0;
          const maxLag = lagSamples.length > 0 ? Math.max(...lagSamples) : 0;
          molecules.push({
            key,
            atomCount: entry.atomIds?.length ?? 0,
            geoUpdates: updates,
            updateRate: (updates / (measureMs / 1000)).toFixed(1),
            hasMesh: !!entry.mesh,
            computing: entry.computing,
            hasPending: !!entry.pendingData,
            skin: entry.skinType,
            avgSpatialLag: avgLag.toFixed(3),
            maxSpatialLag: maxLag.toFixed(3),
          });
        }

        resolve({
          renderFps: Math.round(1000 / avg),
          p95Fps: Math.round(1000 / ft[Math.floor(ft.length * 0.95)]),
          worstMs: ft[ft.length - 1].toFixed(1),
          frameCount: ft.length,
          molecules,
          totalAtoms: t.atoms.length,
          molKeyChurn,
        });
      }
    }
    requestAnimationFrame(tick);
  });
}, MEASURE_MS);

console.log(`Render: ${result.renderFps}fps (p95=${result.p95Fps}fps, worst=${result.worstMs}ms)`);
console.log(`Frames: ${result.frameCount}, Atoms: ${result.totalAtoms}`);
console.log(`Molecule key churn: ${result.molKeyChurn} changes`);

console.log('\nPer-molecule skin update rate and spatial lag:');
for (const m of result.molecules) {
  console.log(`  [${m.key}] ${m.atomCount} atoms, skin=${m.skin}: ` +
    `${m.geoUpdates} updates (${m.updateRate}/sec), ` +
    `lag avg=${m.avgSpatialLag} max=${m.maxSpatialLag}, ` +
    `mesh=${m.hasMesh}, computing=${m.computing}, pending=${m.hasPending}`);
}

// ── Assertions ──

console.log('\n── Assertions ──\n');
let failures = 0;

if (result.renderFps >= 30) {
  console.log(`  ✓ render fps >= 30 — ${result.renderFps}fps`);
} else {
  console.log(`  ✗ render fps >= 30 — ${result.renderFps}fps`);
  failures++;
}

for (const m of result.molecules) {
  if (!m.hasMesh) continue;
  const rate = parseFloat(m.updateRate);
  if (rate >= MIN_SKIN_UPDATE_RATE) {
    console.log(`  ✓ [${m.key}] skin >= ${MIN_SKIN_UPDATE_RATE}/sec — ${m.updateRate}/sec`);
  } else {
    console.log(`  ✗ [${m.key}] skin >= ${MIN_SKIN_UPDATE_RATE}/sec — ${m.updateRate}/sec — SKIN LAGGING`);
    failures++;
  }
}

const MAX_SPATIAL_LAG = 0.5; // max avg distance (world units) between atom centroid and mesh center
for (const m of result.molecules) {
  if (!m.hasMesh) continue;
  const lag = parseFloat(m.avgSpatialLag);
  if (lag <= MAX_SPATIAL_LAG) {
    console.log(`  ✓ [${m.key}] spatial lag <= ${MAX_SPATIAL_LAG} — avg=${m.avgSpatialLag}, max=${m.maxSpatialLag}`);
  } else {
    console.log(`  ✗ [${m.key}] spatial lag <= ${MAX_SPATIAL_LAG} — avg=${m.avgSpatialLag}, max=${m.maxSpatialLag} — MESH TRAILING`);
    failures++;
  }
}

const stuck = result.molecules.filter(m => m.computing && m.geoUpdates === 0);
if (stuck.length === 0) {
  console.log('  ✓ no molecules stuck computing');
} else {
  console.log(`  ✗ ${stuck.length} molecules stuck computing`);
  failures++;
}

console.log(`\n═══ ${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'} ═══\n`);

await browser.close();
process.exit(failures === 0 ? 0 : 1);
