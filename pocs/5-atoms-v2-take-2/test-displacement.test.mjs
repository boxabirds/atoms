/**
 * Integration test: GPU displacement maps on marching cubes meshes.
 *
 * Displacement runs entirely in the WGSL generate shader — no CPU post-processing.
 * We test by comparing vertex snapshots at different displacement multipliers.
 *
 * Verifies:
 * 1. Displaced skin at default multiplier differs from multiplier=0
 * 2. Non-displaced skin is identical at multiplier=0 and multiplier=5
 * 3. Slider at 0 → displaced skin matches undisplaced baseline
 * 4. Slider at max → displaced skin diverges significantly from baseline
 * 5. Non-displaced skin unaffected by slider at max
 * 6. Zero-vertex GPU compute does not crash
 *
 * Run: node test-displacement.test.mjs
 */
import { chromium } from 'playwright';

const BASE_URL = process.env.TEST_PAGE_URL || 'http://localhost:8000';
const SETTLE_MS = 3000;
const RECOMPUTE_WAIT_MS = 2000; // wait for async GPU recompute after multiplier change
const POSITION_TOLERANCE = 0.0001;

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
page.on('console', msg => { if (msg.type() === 'error') console.error('CONSOLE:', msg.text()); });

await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

console.log('\n═══ GPU Displacement on MC Meshes ═══\n');

// Unfreeze
await page.evaluate(() => { window.__test.isFrozen = false; });

// Spawn two Signal Chains
console.log('Spawning 2 Signal Chains...');
await page.evaluate(() => {
  const t = window.__test;
  const V3 = t.THREE.Vector3;
  const scIdx = t.PREBUILT_MACHINES.findIndex(m => m.name === 'Signal Chain');
  t.spawnMachine(scIdx, new V3(-3, 0, 0));
  t.spawnMachine(scIdx, new V3(3, 0, 0));
});

console.log(`Letting physics settle for ${SETTLE_MS / 1000}s...`);
await page.waitForTimeout(SETTLE_MS);

// Freeze simulation so atom positions stay constant during displacement tests
await page.evaluate(() => { window.__test.isFrozen = true; });
console.log('Simulation frozen for stable comparisons.');

// Apply 'lumpy-translucent-gold' (has displacement) to molecule 0
// Apply 'flickering-flame' (no displacement) to molecule 1
console.log('Applying skins...');
await page.evaluate(async () => {
  const t = window.__test;
  const entries = [...t.moleculeSkins.entries()];
  if (entries.length < 2) throw new Error('Expected at least 2 molecules, got ' + entries.length);

  // Skin with displacement
  const [, entry0] = entries[0];
  const skinWithDisp = 'lumpy-translucent-gold';
  await t.loadSkinFromJSON(skinWithDisp, './skins-json/lumpy-translucent-gold.shader.json');
  await t.ensureDisplacementPixels(skinWithDisp);
  const mat0 = t.createSkinMaterial(skinWithDisp, 0xdd7744);
  if (entry0.mesh) { entry0.mesh.material.dispose(); entry0.mesh.material = mat0; }
  entry0.material = mat0;
  entry0.skinType = skinWithDisp;

  // Skin without displacement
  const [, entry1] = entries[1];
  const skinNoDisp = 'flickering-flame';
  await t.loadSkinFromJSON(skinNoDisp, './skins-json/flickering-flame.shader.json');
  const mat1 = t.createSkinMaterial(skinNoDisp, 0x44dd77);
  if (entry1.mesh) { entry1.mesh.material.dispose(); entry1.mesh.material = mat1; }
  entry1.material = mat1;
  entry1.skinType = skinNoDisp;
});

// Helper: snapshot vertex positions for a molecule entry by index
const snapshotPositions = (entryIdx) => page.evaluate((idx) => {
  const t = window.__test;
  const entries = [...t.moleculeSkins.entries()];
  const [, entry] = entries[idx];
  if (!entry.mesh) return null;
  const arr = entry.mesh.geometry.getAttribute('position').array;
  return Array.from(arr);
}, entryIdx);

// Helper: compare two position arrays, return diff stats
function comparePositions(a, b) {
  if (!a || !b) return { ok: false, reason: 'missing data' };
  const len = Math.min(a.length, b.length);
  let diffs = 0, maxDiff = 0;
  for (let i = 0; i < len; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > POSITION_TOLERANCE) diffs++;
    maxDiff = Math.max(maxDiff, d);
  }
  return { diffs, maxDiff, total: len };
}

// ── Step 1: Capture baseline at multiplier=0 (no displacement) ──
console.log('Setting multiplier=0 and waiting for GPU recompute...');
await page.evaluate(() => { window.__test.applyDisplacementMultiplier(0); });
await page.waitForTimeout(RECOMPUTE_WAIT_MS);

const baseline0_disp = await snapshotPositions(0);   // displaced skin at mult=0
const baseline0_nodisp = await snapshotPositions(1);  // non-displaced skin at mult=0

// ── Step 2: Capture at default multiplier=5 ──
console.log('Setting multiplier=5 and waiting for GPU recompute...');
await page.evaluate(() => { window.__test.applyDisplacementMultiplier(5); });
await page.waitForTimeout(RECOMPUTE_WAIT_MS);

const at5_disp = await snapshotPositions(0);
const at5_nodisp = await snapshotPositions(1);

// ── Step 3: Capture at multiplier=10 (max) ──
console.log('Setting multiplier=10 and waiting for GPU recompute...');
await page.evaluate(() => { window.__test.applyDisplacementMultiplier(10); });
await page.waitForTimeout(RECOMPUTE_WAIT_MS);

const at10_disp = await snapshotPositions(0);
const at10_nodisp = await snapshotPositions(1);

// ── Tests ──

console.log('\n── Test 1: Displaced skin at mult=5 differs from mult=0 baseline ──\n');
const cmp1 = comparePositions(baseline0_disp, at5_disp);
const test1 = { ok: cmp1.diffs > 0, ...cmp1, skinType: 'lumpy-translucent-gold' };
console.log(`  ${test1.ok ? '✓' : '✗'} ${test1.skinType}: ${test1.diffs}/${test1.total} values differ, max diff=${test1.maxDiff.toFixed(4)}`);

console.log('\n── Test 2: Non-displaced skin identical at mult=0 and mult=5 ──\n');
const cmp2 = comparePositions(baseline0_nodisp, at5_nodisp);
const test2 = { ok: cmp2.diffs === 0, ...cmp2, skinType: 'flickering-flame' };
console.log(`  ${test2.ok ? '✓' : '✗'} ${test2.skinType}: ${test2.diffs}/${test2.total} values differ (expect 0)`);

console.log('\n── Test 3: Displaced skin at mult=0 matches itself (idempotent) ──\n');
// Re-set to 0 and compare with original baseline
await page.evaluate(() => { window.__test.applyDisplacementMultiplier(0); });
await page.waitForTimeout(RECOMPUTE_WAIT_MS);
const recheck0 = await snapshotPositions(0);
const cmp3 = comparePositions(baseline0_disp, recheck0);
const test3 = { ok: cmp3.diffs === 0, ...cmp3 };
console.log(`  ${test3.ok ? '✓' : '✗'} At multiplier=0 (recheck): ${test3.diffs}/${test3.total} values differ (expect 0)`);

console.log('\n── Test 4: Displaced skin at mult=10 shows large displacement ──\n');
const cmp4 = comparePositions(baseline0_disp, at10_disp);
const test4 = { ok: cmp4.diffs > 0 && cmp4.maxDiff > 0.01, ...cmp4 };
console.log(`  ${test4.ok ? '✓' : '✗'} At multiplier=10: ${test4.diffs}/${test4.total} values differ, max diff=${test4.maxDiff.toFixed(4)}`);

console.log('\n── Test 5: Non-displaced skin unaffected by slider at max ──\n');
const cmp5 = comparePositions(baseline0_nodisp, at10_nodisp);
const test5 = { ok: cmp5.diffs === 0, ...cmp5, skinType: 'flickering-flame' };
console.log(`  ${test5.ok ? '✓' : '✗'} ${test5.skinType} at multiplier=10: ${test5.diffs}/${test5.total} values differ (expect 0)`);

console.log('\n── Test 6: Zero-vertex GPU compute does not crash ──\n');
const test6 = await page.evaluate(async () => {
  const t = window.__test;
  try {
    const result = await t.mcGPU.computeMolecule(new Float32Array(0), 32, null);
    return { ok: result.vertexCount === 0, vertexCount: result.vertexCount };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});
console.log(`  ${test6.ok ? '✓' : '✗'} Zero-vertex GPU compute: ${test6.ok ? 'no crash, 0 vertices' : test6.reason}`);

// ── Summary ──
console.log('\n── Summary ──\n');
const tests = [test1, test2, test3, test4, test5, test6];
const failures = tests.filter(t => !t.ok).length;
for (let i = 0; i < tests.length; i++) {
  console.log(`  ${tests[i].ok ? '✓' : '✗'} Test ${i + 1}: ${tests[i].ok ? 'PASS' : 'FAIL'}`);
}
console.log(`\n═══ ${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'} ═══\n`);

await browser.close();
process.exit(failures === 0 ? 0 : 1);
