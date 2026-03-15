/**
 * Bug reproduction: "Show/Hide Atoms" toggle should hide connections too.
 *
 * Bug: Toggling atoms off hides atom meshes but connection bridges and
 * tendrils remain visible.
 *
 * Run: node test-atom-toggle.test.mjs
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

const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('pageerror', err => console.error('  PAGE ERROR:', err.message));

await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

console.log('\n═══ Bug Repro: Atom Toggle Hides Connections ═══\n');

// Create atoms close enough to form connections
await page.evaluate(() => {
  const t = window.__test;
  const V3 = t.THREE.Vector3;
  t.addAtom('pulse', new V3(0, 1, 0));
  t.addAtom('pulse', new V3(0.4, 1.15, 0));
  t.addAtom('pulse', new V3(-0.2, 1.2, 0.1));
});
await page.waitForTimeout(1500);

// Check connections formed
const before = await page.evaluate(() => {
  const t = window.__test;
  // Access connections array via the module scope
  const conns = [];
  for (const a of t.atoms) {
    for (const c of a.connections) {
      if (!conns.find(x => x === c)) conns.push(c);
    }
  }
  return {
    atomCount: t.atoms.length,
    connectionCount: conns.length,
    atomsVisible: t.atoms.every(a => a.group.visible),
    bridgesVisible: conns.every(c => c.bridgeMesh?.visible !== false),
  };
});

console.log(`  Setup: ${before.atomCount} atoms, ${before.connectionCount} connections`);
before.connectionCount > 0
  ? pass('connections formed', `${before.connectionCount} connections`)
  : fail('connections formed', 'no connections — atoms may be too far apart');

// Click the Atoms toggle button
await page.click('#show-atoms-btn');
await page.waitForTimeout(300);

// Check visibility after toggle
const after = await page.evaluate(() => {
  const t = window.__test;
  const conns = [];
  for (const a of t.atoms) {
    for (const c of a.connections) {
      if (!conns.find(x => x === c)) conns.push(c);
    }
  }

  const atomsHidden = t.atoms.every(a => !a.group.visible);
  const bridgesHidden = conns.every(c => c.bridgeMesh?.visible === false);
  const bridgeStates = conns.map(c => ({
    visible: c.bridgeMesh?.visible,
    inScene: c.bridgeMesh?.parent != null,
  }));

  return { atomsHidden, bridgesHidden, bridgeStates, connectionCount: conns.length };
});

after.atomsHidden
  ? pass('atoms hidden after toggle')
  : fail('atoms hidden after toggle');

after.bridgesHidden
  ? pass('connection bridges hidden after toggle')
  : fail('connection bridges hidden after toggle',
    `bridges still visible: ${JSON.stringify(after.bridgeStates)}`);

// Toggle back on
await page.click('#show-atoms-btn');
await page.waitForTimeout(300);

const restored = await page.evaluate(() => {
  const t = window.__test;
  const conns = [];
  for (const a of t.atoms) {
    for (const c of a.connections) {
      if (!conns.find(x => x === c)) conns.push(c);
    }
  }
  return {
    atomsVisible: t.atoms.every(a => a.group.visible),
    bridgesVisible: conns.every(c => c.bridgeMesh?.visible !== false),
  };
});

restored.atomsVisible && restored.bridgesVisible
  ? pass('atoms and bridges restored after toggle on')
  : fail('atoms and bridges restored after toggle on');

// ── Report ──
console.log('\n═══════════════════════════════════════════');
const passCount = results.filter(r => r.passed).length;
const failCount = results.filter(r => !r.passed).length;
console.log(`  Results: ${passCount} passed, ${failCount} failed`);
console.log('═══════════════════════════════════════════\n');

await browser.close();
process.exit(failCount === 0 ? 0 : 1);
