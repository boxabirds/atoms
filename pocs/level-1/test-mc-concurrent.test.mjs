/**
 * Bug reproduction test: Concurrent MC compute corruption + skin follow.
 *
 * Bug 1 — Mesh stays behind: MC skin blob doesn't follow atoms when they
 *          move via animation/physics.
 *
 * Bug 2 — Only first molecule gets skin: When multiple molecules exist,
 *          only one gets a visible MC mesh. MarchingCubesGPU shares internal
 *          GPU buffers (staging, output, params). When two molecules trigger
 *          computeMolecule() in the same render frame, the second call
 *          overwrites the first's buffers and/or hits a mapAsync validation
 *          error on already-pending staging buffers.
 *
 * Run: node test-mc-concurrent.test.mjs
 */

import { chromium } from 'playwright';

const BASE_URL = process.env.TEST_PAGE_URL || 'http://localhost:8000';
const MC_SETTLE_MS = 5000;
const POSITION_TOLERANCE = 1.5;

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const results = [];
function pass(name, detail = '') { results.push({ name, passed: true, detail }); console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
function fail(name, detail = '') { results.push({ name, passed: false, detail }); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }

const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('pageerror', err => console.error('  PAGE ERROR:', err.message));

console.log(`\nLoading ${BASE_URL}...`);
await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

console.log('\n═══ Bug Repro: Concurrent MC Compute + Skin Follow ═══\n');

// ── Helper: get molecule skin state ────────────────────────────────────

async function getMoleculeState() {
  return page.evaluate(() => {
    const t = window.__test;
    if (!t) return { error: 'no __test' };

    const skins = [];
    for (const [key, entry] of t.moleculeSkins.entries()) {
      let cx = 0, cy = 0, cz = 0, count = 0;
      for (const id of entry.atomIds) {
        const a = t.atoms.find(at => at.id === id);
        if (a?.group) {
          cx += a.group.position.x;
          cy += a.group.position.y;
          cz += a.group.position.z;
          count++;
        }
      }
      if (count > 0) { cx /= count; cy /= count; cz /= count; }

      let meshCenter = null;
      if (entry.mesh?.geometry?.boundingSphere) {
        const c = entry.mesh.geometry.boundingSphere.center;
        meshCenter = { x: c.x, y: c.y, z: c.z };
      }

      skins.push({
        key,
        atomCount: entry.atomIds.length,
        hasMesh: !!entry.mesh,
        meshVisible: entry.mesh?.visible ?? false,
        computing: entry.computing,
        atomCentroid: { x: cx, y: cy, z: cz },
        meshCenter,
        hasGeomVerts: entry.mesh?.geometry?.attributes?.position?.count > 0,
      });
    }

    return { skinCount: skins.length, skins, totalAtoms: t.atoms.length };
  });
}

// ── Setup: Create ALL 6 atoms in a SINGLE evaluate (same frame) ────────
// This ensures both molecules are dirty on the NEXT render frame,
// triggering concurrent computeMolecule() calls on shared GPU buffers.

console.log('  Creating 6 atoms in a single frame (2 molecules of 3)...');
await page.evaluate(() => {
  const t = window.__test;
  const V3 = t.THREE.Vector3;

  // Molecule A: cluster at x=-3
  t.addAtom('pulse', new V3(-3.0, 1.0, 0));
  t.addAtom('pulse', new V3(-2.7, 1.15, 0));
  t.addAtom('pulse', new V3(-3.1, 1.2, 0.1));

  // Molecule B: cluster at x=+3 (far enough to be separate molecule)
  t.addAtom('pulse', new V3(3.0, 1.0, 0));
  t.addAtom('pulse', new V3(3.2, 1.15, 0));
  t.addAtom('pulse', new V3(2.9, 1.2, 0.1));
});

console.log(`  Waiting ${MC_SETTLE_MS}ms for MC compute...`);
await page.waitForTimeout(MC_SETTLE_MS);

// ── Test 1: Both molecules should have skin entries and meshes ─────────

const state = await getMoleculeState();

console.log(`  Total atoms: ${state.totalAtoms}, skin entries: ${state.skinCount}`);
for (const s of state.skins) {
  console.log(`    [${s.key}] atoms=${s.atomCount} mesh=${s.hasMesh} verts=${s.hasGeomVerts} ` +
    `computing=${s.computing} ` +
    `atomPos=(${s.atomCentroid.x.toFixed(1)},${s.atomCentroid.y.toFixed(1)},${s.atomCentroid.z.toFixed(1)}) ` +
    (s.meshCenter
      ? `meshPos=(${s.meshCenter.x.toFixed(1)},${s.meshCenter.y.toFixed(1)},${s.meshCenter.z.toFixed(1)})`
      : 'NO MESH'));
}

state.skinCount >= 2
  ? pass('two molecules have skin entries', `${state.skinCount} entries`)
  : fail('two molecules have skin entries', `only ${state.skinCount}`);

const withMesh = state.skins.filter(s => s.hasMesh && s.hasGeomVerts);
withMesh.length >= 2
  ? pass('both molecules have MC meshes with vertices', `${withMesh.length} meshes`)
  : fail('both molecules have MC meshes with vertices', `only ${withMesh.length} — concurrent compute corruption`);

// ── Test 2: Each mesh is near its own atoms (not swapped) ──────────────

console.log('\n── Mesh position accuracy ──\n');

for (const skin of state.skins) {
  if (!skin.hasMesh || !skin.meshCenter) {
    fail(`mesh near atoms [${skin.key}]`, 'no mesh');
    continue;
  }

  const dx = skin.meshCenter.x - skin.atomCentroid.x;
  const dy = skin.meshCenter.y - skin.atomCentroid.y;
  const dz = skin.meshCenter.z - skin.atomCentroid.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  dist < POSITION_TOLERANCE
    ? pass(`mesh near atoms [${skin.key}]`, `distance: ${dist.toFixed(3)}`)
    : fail(`mesh near atoms [${skin.key}]`, `distance: ${dist.toFixed(3)} — mesh detached or swapped!`);
}

// ── Test 3: Force both molecules dirty in same frame, verify both update ─

console.log('\n── Concurrent dirty recompute ──\n');

console.log('  Forcing both molecules dirty + moving atoms in single frame...');
await page.evaluate(() => {
  const t = window.__test;
  // Null out lastPositions to force dirty on next update
  for (const [, entry] of t.moleculeSkins.entries()) {
    entry.lastPositions = null;
    entry.computing = false; // ensure not blocked
  }
  // Move molecule A atoms by +1.5 on x
  for (let i = 0; i < 3; i++) {
    t.atoms[i].group.position.x += 1.5;
  }
  // Move molecule B atoms by -1.5 on x
  for (let i = 3; i < 6; i++) {
    t.atoms[i].group.position.x -= 1.5;
  }
});

// The next render frame should trigger updateMoleculeSkins() which will
// fire computeMolecule() for BOTH molecules in the same for-loop iteration
console.log(`  Waiting ${MC_SETTLE_MS}ms for concurrent recompute...`);
await page.waitForTimeout(MC_SETTLE_MS);

const stateAfter = await getMoleculeState();

console.log('  After concurrent recompute:');
for (const s of stateAfter.skins) {
  console.log(`    [${s.key}] mesh=${s.hasMesh} verts=${s.hasGeomVerts} computing=${s.computing} ` +
    `atomPos=(${s.atomCentroid.x.toFixed(2)},${s.atomCentroid.y.toFixed(2)}) ` +
    (s.meshCenter ? `meshPos=(${s.meshCenter.x.toFixed(2)},${s.meshCenter.y.toFixed(2)})` : 'NO MESH'));
}

const withMeshAfter = stateAfter.skins.filter(s => s.hasMesh && s.hasGeomVerts);
withMeshAfter.length >= 2
  ? pass('both meshes survive concurrent recompute', `${withMeshAfter.length} meshes`)
  : fail('both meshes survive concurrent recompute', `only ${withMeshAfter.length} — buffer corruption`);

// Verify positions are correct after concurrent recompute
for (const skin of stateAfter.skins) {
  if (!skin.hasMesh || !skin.meshCenter) {
    fail(`mesh follows after concurrent recompute [${skin.key}]`, 'no mesh');
    continue;
  }

  const dx = skin.meshCenter.x - skin.atomCentroid.x;
  const dy = skin.meshCenter.y - skin.atomCentroid.y;
  const dz = skin.meshCenter.z - skin.atomCentroid.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  dist < POSITION_TOLERANCE
    ? pass(`mesh follows after concurrent recompute [${skin.key}]`, `distance: ${dist.toFixed(3)}`)
    : fail(`mesh follows after concurrent recompute [${skin.key}]`, `distance: ${dist.toFixed(3)} — stuck at old position!`);
}

// ── Test 4: Check no entry stuck in computing=true ─────────────────────

const stuckComputing = stateAfter.skins.filter(s => s.computing);
stuckComputing.length === 0
  ? pass('no molecules stuck in computing state')
  : fail('molecules stuck in computing state', `${stuckComputing.length} stuck — will never recompute again`);

// ── Report ────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════');
const passCount = results.filter(r => r.passed).length;
const failCount = results.filter(r => !r.passed).length;
console.log(`  Results: ${passCount} passed, ${failCount} failed`);
console.log('═══════════════════════════════════════════\n');

await browser.close();
process.exit(failCount === 0 ? 0 : 1);
