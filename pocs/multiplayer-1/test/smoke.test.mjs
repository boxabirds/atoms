/**
 * Smoke test: multiplayer-1 connects to SpacetimeDB and renders atoms.
 *
 * Verifies actual Three.js scene graph — mesh counts, material colors,
 * bridge orientations, and machine structural coherence.
 *
 * Prerequisites:
 * - SpacetimeDB running on port 3000 with 'atoms-multi' database
 * - Vite dev server running on port 3002
 *
 * Run: node test/smoke.test.mjs
 */
import { chromium } from 'playwright';

const CLIENT_URL = process.env.TEST_PAGE_URL || 'http://localhost:3002';

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const results = [];
function pass(name, detail = '') { results.push({ name, passed: true }); console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
function fail(name, detail = '') { results.push({ name, passed: false }); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }

const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

const pageErrors = [];
page.on('pageerror', err => {
  pageErrors.push(err.message);
  console.error('  PAGE ERROR:', err.message);
});

page.on('console', msg => {
  if (msg.type() === 'error') console.error('  CONSOLE ERROR:', msg.text());
});

const { execSync } = await import('child_process');

// Helper: ensure unfrozen
function ensureUnfrozen() {
  try {
    const out = execSync('spacetime sql atoms-multi "SELECT frozen FROM arena_state" -s local', { encoding: 'utf-8' });
    if (out.includes('true')) {
      execSync('spacetime call atoms-multi toggle_freeze -s local');
    }
  } catch {}
}

// Helper: wait for scene to be available
async function waitForScene(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const has = await page.evaluate(() => !!window.__scene);
    if (has) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

// Helper: get atom meshes (main mesh of each atom — has userData.atomId)
async function getAtomMeshes() {
  return page.evaluate(() => {
    const scene = window.__scene;
    if (!scene) return [];
    const meshes = [];
    scene.traverse((obj) => {
      if (obj.isMesh && obj.userData?.atomId != null) {
        const mat = obj.material;
        // Get world position (group may have moved)
        const wp = obj.parent?.position || obj.position;
        meshes.push({
          x: wp.x, y: wp.y, z: wp.z,
          color: '#' + mat.color.getHexString(),
          emissive: '#' + mat.emissive.getHexString(),
          geoType: obj.geometry?.type,
          radius: obj.geometry?.parameters?.radius,
          atomId: String(obj.userData.atomId),
        });
      }
    });
    return meshes;
  });
}

// Helper: get sphere meshes from scene (legacy — for signal dots etc.)
async function getSphereMeshes() {
  return page.evaluate(() => {
    const scene = window.__scene;
    if (!scene) return [];
    const meshes = [];
    scene.traverse((obj) => {
      if (obj.isMesh && obj.geometry?.type === 'SphereGeometry') {
        const mat = obj.material;
        meshes.push({
          x: obj.position.x,
          y: obj.position.y,
          z: obj.position.z,
          color: '#' + mat.color.getHexString(),
          emissive: '#' + mat.emissive.getHexString(),
          radius: obj.geometry.parameters.radius,
          atomId: obj.userData?.atomId,
        });
      }
    });
    return meshes;
  });
}

// Helper: get cylinder meshes (bridges) from scene
async function getCylinderMeshes() {
  return page.evaluate(() => {
    const scene = window.__scene;
    if (!scene) return [];
    const meshes = [];
    scene.traverse((obj) => {
      if (obj.isMesh && obj.geometry?.type === 'CylinderGeometry') {
        meshes.push({
          x: obj.position.x,
          y: obj.position.y,
          z: obj.position.z,
          qx: obj.quaternion.x,
          qy: obj.quaternion.y,
          qz: obj.quaternion.z,
          qw: obj.quaternion.w,
          scaleY: obj.scale.y,
          color: '#' + obj.material.color.getHexString(),
        });
      }
    });
    return meshes;
  });
}

console.log('\n═══ Multiplayer-1 Smoke Test ═══\n');

// Pre-test: clean state
try { execSync('spacetime call atoms-multi clear_arena -s local 2>/dev/null'); } catch {}
ensureUnfrozen();
await page.waitForTimeout(500);

// --- Test 1: Page loads, canvas present, scene accessible ---
console.log('Loading page...');
await page.goto(CLIENT_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

if (pageErrors.length === 0) {
  pass('Page loads without errors');
} else {
  fail('Page loads without errors', pageErrors.join('; '));
}

const hasCanvas = await page.evaluate(() => !!document.querySelector('canvas'));
if (hasCanvas) {
  pass('Canvas element present');
} else {
  fail('Canvas element present');
}

const sceneReady = await waitForScene();
if (sceneReady) {
  pass('Three.js scene accessible');
} else {
  fail('Three.js scene accessible');
}

// --- Test 2: SpacetimeDB connected ---
const connText = await page.evaluate(() => {
  const allDivs = document.querySelectorAll('div');
  for (const d of allDivs) {
    if (d.textContent === 'Connected' && d.children.length === 0) return 'Connected';
  }
  return null;
});
if (connText === 'Connected') {
  pass('SpacetimeDB connected');
} else {
  fail('SpacetimeDB connected', `status: ${connText}`);
}

// --- Test 3: Spawn walker — verify 9 atom meshes in scene ---
// Walker: 4 pulse (SphereGeometry) + 5 flex (CapsuleGeometry)
console.log('Spawning walker...');
execSync('spacetime call atoms-multi spawn_machine walker 0 5 0 -s local');
await page.waitForTimeout(2000);

const atomMeshes = await getAtomMeshes();
if (atomMeshes.length === 9) {
  pass('Walker: 9 atom meshes in scene');
} else {
  fail('Walker: atom mesh count', `found ${atomMeshes.length} (expected 9)`);
}

// --- Test 4: Atom colors match ATOM_DEFS ---
// Walker has: 5 flex (#c0c0c8), 4 pulse (#e8603c)
const EXPECTED_COLORS = {
  '#e8603c': { name: 'pulse', expected: 4 },
  '#c0c0c8': { name: 'flex', expected: 5 },
};

const colorCounts = {};
for (const s of atomMeshes) {
  colorCounts[s.color] = (colorCounts[s.color] || 0) + 1;
}

let colorPass = true;
const colorDetails = [];
for (const [hex, { name, expected }] of Object.entries(EXPECTED_COLORS)) {
  const actual = colorCounts[hex] || 0;
  if (actual !== expected) {
    colorPass = false;
    colorDetails.push(`${name}(${hex}): ${actual}/${expected}`);
  }
}

if (colorPass) {
  pass('Atom colors correct', '4 pulse(#e8603c), 5 flex(#c0c0c8)');
} else {
  const allColors = Object.entries(colorCounts).map(([c, n]) => `${c}:${n}`).join(', ');
  fail('Atom colors', `${colorDetails.join(', ')} | all colors: ${allColors}`);
}

// --- Test 5: Geometry types correct (flex=CapsuleGeometry, pulse=SphereGeometry) ---
const flexMeshes = atomMeshes.filter(s => s.geoType === 'CapsuleGeometry');
const pulseMeshes = atomMeshes.filter(s => s.geoType === 'SphereGeometry' && Math.abs(s.radius - 0.25) < 0.01);

if (flexMeshes.length === 5 && pulseMeshes.length === 4) {
  pass('Atom geometry types correct', '5 flex(Capsule), 4 pulse(Sphere r=0.25)');
} else {
  const geoTypes = atomMeshes.map(m => m.geoType).join(', ');
  fail('Atom geometry types', `flex(Capsule): ${flexMeshes.length}, pulse(Sphere): ${pulseMeshes.length} | types: ${geoTypes}`);
}

// --- Test 6: 8 bridge cylinders in scene, oriented correctly ---
const cylinders = await getCylinderMeshes();

if (cylinders.length === 8) {
  pass('Bridge count: 8 cylinders in scene');
} else {
  fail('Bridge count', `found ${cylinders.length} (expected 8)`);
}

// Verify bridges are NOT all pointing straight up (the old bug)
// A vertical cylinder has quaternion ≈ (0,0,0,1). If all bridges have
// that quaternion, they're broken.
const verticalCount = cylinders.filter(c => {
  // Identity quaternion = pointing up = broken
  return Math.abs(c.qx) < 0.01 && Math.abs(c.qy) < 0.01 &&
         Math.abs(c.qz) < 0.01 && Math.abs(c.qw - 1.0) < 0.01;
}).length;

if (verticalCount < cylinders.length && cylinders.length > 0) {
  pass('Bridge orientation: not all vertical', `${cylinders.length - verticalCount}/${cylinders.length} rotated`);
} else if (cylinders.length > 0) {
  fail('Bridge orientation: all vertical (sticks bug)', `${verticalCount}/${cylinders.length} are identity quaternion`);
}

// Verify bridge color is correct (#88ddff)
const correctBridgeColor = cylinders.every(c => c.color === '#88ddff');
if (correctBridgeColor && cylinders.length > 0) {
  pass('Bridge color correct', '#88ddff');
} else {
  const colors = [...new Set(cylinders.map(c => c.color))];
  fail('Bridge color', `found: ${colors.join(', ')}`);
}

// --- Test 7: Machine structural coherence — atoms stay close together ---
// After 2 seconds of physics, the walker's atoms should still be within
// a reasonable bounding box (not scattered across the arena)
if (atomMeshes.length >= 9) {
  const xs = atomMeshes.map(s => s.x);
  const ys = atomMeshes.map(s => s.y);
  const zs = atomMeshes.map(s => s.z);
  const bbox = {
    dx: Math.max(...xs) - Math.min(...xs),
    dy: Math.max(...ys) - Math.min(...ys),
    dz: Math.max(...zs) - Math.min(...zs),
  };
  const MAX_SPREAD = 3.0; // walker should be well under 3 units wide

  if (bbox.dx < MAX_SPREAD && bbox.dy < MAX_SPREAD && bbox.dz < MAX_SPREAD) {
    pass('Machine coherence: atoms stay together', `bbox: ${bbox.dx.toFixed(1)}×${bbox.dy.toFixed(1)}×${bbox.dz.toFixed(1)}`);
  } else {
    fail('Machine coherence: atoms scattered', `bbox: ${bbox.dx.toFixed(1)}×${bbox.dy.toFixed(1)}×${bbox.dz.toFixed(1)} (max ${MAX_SPREAD})`);
  }
}

// --- Test 8: Gravity — atom falls from spawn height ---
execSync('spacetime call atoms-multi clear_arena -s local');
await page.waitForTimeout(500);
ensureUnfrozen();
execSync('spacetime call atoms-multi add_atom pulse 0 3 0 -s local');
await page.waitForTimeout(1500);

const afterGravity = await getAtomMeshes();
const fallenAtom = afterGravity.find(s => s.geoType === 'SphereGeometry' && Math.abs(s.radius - 0.25) < 0.01);
if (fallenAtom && fallenAtom.y < 0) {
  pass('Gravity: atom fell to ground', `y=${fallenAtom.y.toFixed(2)} (spawned at y=3)`);
} else {
  fail('Gravity: atom did not fall', `y=${fallenAtom?.y?.toFixed(2) ?? 'no atom found'}`);
}

// --- Test 9: Freeze toggle ---
const beforeToggle = await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if (b.textContent?.includes('Frozen')) return 'Frozen';
    if (b.textContent?.includes('Running')) return 'Running';
  }
  return null;
});

execSync('spacetime call atoms-multi toggle_freeze -s local');
await page.waitForTimeout(500);

const afterToggle = await page.evaluate(() => {
  for (const b of document.querySelectorAll('button')) {
    if (b.textContent?.includes('Frozen')) return 'Frozen';
    if (b.textContent?.includes('Running')) return 'Running';
  }
  return null;
});

if (beforeToggle && afterToggle && beforeToggle !== afterToggle) {
  pass('Freeze toggle', `${beforeToggle} → ${afterToggle}`);
} else {
  fail('Freeze toggle', `before: ${beforeToggle}, after: ${afterToggle}`);
}

// --- Test 10: Clear arena — 0 atom meshes in scene ---
execSync('spacetime call atoms-multi clear_arena -s local');
await page.waitForTimeout(1000);

const afterClearAtoms = await getAtomMeshes();
const afterClearCyl = await getCylinderMeshes();

if (afterClearAtoms.length === 0 && afterClearCyl.length === 0) {
  pass('Clear arena: 0 meshes in scene');
} else {
  fail('Clear arena', `${afterClearAtoms.length} atom meshes, ${afterClearCyl.length} cylinders remain`);
}

// --- Summary ---
console.log('\n═══════════════════════════════════════════');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════\n');

await browser.close();
process.exit(failed > 0 ? 1 : 0);
