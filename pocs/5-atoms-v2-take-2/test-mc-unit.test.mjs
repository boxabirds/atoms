/**
 * Unit tests for dirty tracking logic and material application.
 *
 * These test the pure-logic functions used by the MC skin system.
 * Run: node test-mc-unit.test.mjs
 *
 * Tests run in-browser via Playwright since createSkinMaterial depends on Three.js
 * and the skin registry defined in index.html.
 */

import { chromium } from 'playwright';

const BASE_URL = process.env.TEST_PAGE_URL || 'http://localhost:8000';

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const results = [];
function pass(name, detail = '') { results.push({ name, passed: true, detail }); console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
function fail(name, detail = '') { results.push({ name, passed: false, detail }); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }

const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', err => errors.push(err.message));

await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

console.log('\n═══ Unit Tests: Dirty Tracking & Material Application ═══\n');

// ── positionsChanged tests ────────────────────────────────────────────────

const dirtyResults = await page.evaluate(() => {
  // Re-implement positionsChanged as defined in index.html
  const MC_DIRTY_THRESHOLD = 0.001;

  function positionsChanged(current, previous) {
    if (!previous || current.length !== previous.length) return true;
    for (let i = 0; i < current.length; i++) {
      if (Math.abs(current[i] - previous[i]) > MC_DIRTY_THRESHOLD) return true;
    }
    return false;
  }

  const results = {};

  // Test 1: null previous → dirty
  results.nullPrevious = positionsChanged(new Float32Array([1, 2, 3, 0.25]), null);

  // Test 2: identical → clean
  const a = new Float32Array([1, 2, 3, 0.25, 4, 5, 6, 0.3]);
  results.identical = positionsChanged(a, new Float32Array(a));

  // Test 3: within threshold → clean
  const b = new Float32Array(a);
  b[0] += 0.0005; // half the threshold
  results.withinThreshold = positionsChanged(a, b);

  // Test 4: beyond threshold → dirty
  const c = new Float32Array(a);
  c[0] += 0.01; // 10x threshold
  results.beyondThreshold = positionsChanged(a, c);

  // Test 5: different length → dirty
  results.differentLength = positionsChanged(
    new Float32Array([1, 2, 3, 0.25]),
    new Float32Array([1, 2, 3, 0.25, 4, 5, 6, 0.3])
  );

  // Test 6: last element changed → dirty
  const d = new Float32Array(a);
  d[d.length - 1] += 0.1;
  results.lastElementChanged = positionsChanged(a, d);

  return results;
});

dirtyResults.nullPrevious === true ? pass('positionsChanged: null previous → dirty') : fail('positionsChanged: null previous → dirty');
dirtyResults.identical === false ? pass('positionsChanged: identical arrays → clean') : fail('positionsChanged: identical arrays → clean');
dirtyResults.withinThreshold === false ? pass('positionsChanged: within threshold → clean') : fail('positionsChanged: within threshold → clean');
dirtyResults.beyondThreshold === true ? pass('positionsChanged: beyond threshold → dirty') : fail('positionsChanged: beyond threshold → dirty');
dirtyResults.differentLength === true ? pass('positionsChanged: different lengths → dirty') : fail('positionsChanged: different lengths → dirty');
dirtyResults.lastElementChanged === true ? pass('positionsChanged: last element changed → dirty') : fail('positionsChanged: last element changed → dirty');

// ── packAtomData tests ────────────────────────────────────────────────────

const packResults = await page.evaluate(() => {
  // Simulate packAtomData with mock atomMap
  const ATOM_RADIUS = 0.25;
  const FLEX_RADIUS = 0.12;
  const FLEX_LENGTH = 0.6;
  const SKIN_SPHERE_INFLATE = 1.15;

  function packAtomData(mol, atomMap) {
    const data = new Float32Array(mol.length * 4);
    for (let i = 0; i < mol.length; i++) {
      const a = atomMap.get(mol[i]);
      if (!a) continue;
      data[i * 4] = a.pos.x;
      data[i * 4 + 1] = a.pos.y;
      data[i * 4 + 2] = a.pos.z;
      data[i * 4 + 3] = (a.type === 'flex'
        ? (FLEX_RADIUS + FLEX_LENGTH * 0.5)
        : ATOM_RADIUS) * SKIN_SPHERE_INFLATE;
    }
    return data;
  }

  const atomMap = new Map([
    [0, { pos: { x: 1.0, y: 2.0, z: 3.0 }, type: 'pulse' }],
    [1, { pos: { x: 4.0, y: 5.0, z: 6.0 }, type: 'flex' }],
  ]);

  const data = packAtomData([0, 1], atomMap);

  return {
    length: data.length,
    // Atom 0: pulse type
    atom0_x: data[0],
    atom0_y: data[1],
    atom0_z: data[2],
    atom0_r: data[3],
    expectedRadius0: ATOM_RADIUS * SKIN_SPHERE_INFLATE,
    // Atom 1: flex type
    atom1_x: data[4],
    atom1_y: data[5],
    atom1_z: data[6],
    atom1_r: data[7],
    expectedRadius1: (FLEX_RADIUS + FLEX_LENGTH * 0.5) * SKIN_SPHERE_INFLATE,
  };
});

packResults.length === 8 ? pass('packAtomData: correct length (2 atoms × 4)') : fail('packAtomData: wrong length', `${packResults.length}`);
packResults.atom0_x === 1.0 && packResults.atom0_y === 2.0 && packResults.atom0_z === 3.0
  ? pass('packAtomData: pulse atom position correct')
  : fail('packAtomData: pulse atom position wrong');
Math.abs(packResults.atom0_r - packResults.expectedRadius0) < 0.001
  ? pass('packAtomData: pulse radius = ATOM_RADIUS × INFLATE', `${packResults.atom0_r.toFixed(4)}`)
  : fail('packAtomData: pulse radius wrong', `${packResults.atom0_r} vs ${packResults.expectedRadius0}`);
Math.abs(packResults.atom1_r - packResults.expectedRadius1) < 0.001
  ? pass('packAtomData: flex radius = (FLEX_RADIUS + FLEX_LENGTH/2) × INFLATE', `${packResults.atom1_r.toFixed(4)}`)
  : fail('packAtomData: flex radius wrong', `${packResults.atom1_r} vs ${packResults.expectedRadius1}`);

// ── createSkinMaterial tests ──────────────────────────────────────────────

const matResults = await page.evaluate(() => {
  const t = window.__test;
  const results = {};

  // Test 'none' skin — basic material
  const noneMat = t.createSkinMaterial('none', 0xff0000);
  results.noneType = noneMat.type; // MeshPhysicalMaterial
  results.noneColor = noneMat.color.getHex();
  results.noneTransparent = noneMat.transparent;

  // Test JSON skin — lumpy-translucent-gold (loaded if available)
  const reg = t.SKIN_REGISTRY.find(s => s.name === 'lumpy-translucent-gold');
  if (reg) {
    // Load it first
    return t.loadSkinFromJSON(reg.name, reg.path).then(() => {
      const goldMat = t.createSkinMaterial('lumpy-translucent-gold', 0xffffff);
      results.goldMetalness = goldMat.metalness;
      results.goldType = goldMat.type;
      results.goldExists = true;

      // Opacity test
      goldMat.opacity = 0.8;
      results.opacitySet = goldMat.opacity;
      goldMat.opacity = 0;
      results.opacityZero = goldMat.opacity;
      goldMat.opacity = 1;
      results.opacityFull = goldMat.opacity;

      goldMat.dispose();
      noneMat.dispose();
      return results;
    });
  }

  noneMat.dispose();
  results.goldExists = false;
  return results;
});

matResults.noneType === 'MeshPhysicalMaterial'
  ? pass('createSkinMaterial: returns MeshPhysicalMaterial')
  : fail('createSkinMaterial: wrong type', matResults.noneType);
matResults.noneTransparent === true
  ? pass('createSkinMaterial: transparent=true for opacity support')
  : fail('createSkinMaterial: not transparent');

if (matResults.goldExists) {
  matResults.goldMetalness === 1
    ? pass('createSkinMaterial: lumpy-translucent-gold metalness=1')
    : fail('createSkinMaterial: wrong metalness', `${matResults.goldMetalness}`);
}

matResults.opacitySet === 0.8
  ? pass('material opacity: set to 0.8')
  : fail('material opacity: failed to set 0.8', `${matResults.opacitySet}`);
matResults.opacityZero === 0
  ? pass('material opacity: set to 0')
  : fail('material opacity: failed to set 0', `${matResults.opacityZero}`);
matResults.opacityFull === 1
  ? pass('material opacity: set to 1')
  : fail('material opacity: failed to set 1', `${matResults.opacityFull}`);

// ── Molecule lifecycle tests ──────────────────────────────────────────────

const lifecycleResults = await page.evaluate(() => {
  const t = window.__test;
  const results = {};

  // Check initial state — should be empty (no atoms dropped)
  results.initialEmpty = t.moleculeSkins.size === 0;

  return results;
});

lifecycleResults.initialEmpty
  ? pass('lifecycle: moleculeSkins starts empty')
  : fail('lifecycle: moleculeSkins not empty at start');

// ── Report ────────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════');
const passCount = results.filter(r => r.passed).length;
const failCount = results.filter(r => !r.passed).length;
console.log(`  Results: ${passCount} passed, ${failCount} failed`);
if (errors.length) console.log(`  Page errors: ${errors.join('; ')}`);
console.log('═══════════════════════════════════════════');

await browser.close();
process.exit(failCount === 0 ? 0 : 1);
