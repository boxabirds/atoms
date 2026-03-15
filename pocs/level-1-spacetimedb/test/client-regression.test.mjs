/**
 * Client regression test — verifies core multiplayer client flow:
 * 1. SpacetimeDB connection established
 * 2. Machine spawn → atoms appear and fall (server physics)
 * 3. Connections render between atoms at correct positions
 * 4. Freeze/unfreeze works via server
 * 5. Drag and drop works
 * 6. Clear arena works
 *
 * Requires: SpacetimeDB running on localhost:3000, Vite on localhost:8002
 * Run: node test/client-regression.test.mjs
 */

import { chromium } from 'playwright';

const BASE_URL = process.env.TEST_URL || 'http://localhost:8002';
const SETTLE_MS = 4000;   // time for atoms to fall and settle
const TICK_MS = 50;       // server tick interval

const results = [];
function pass(name, detail = '') { results.push({ name, ok: true }); console.log(`  PASS: ${name}${detail ? ' — ' + detail : ''}`); }
function fail(name, detail = '') { results.push({ name, ok: false }); console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', err => consoleErrors.push(err.message));

await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

console.log('\n=== Client Regression Tests ===\n');

// ────────────────────────────────────────────────────
// T1: SpacetimeDB connection
// ────────────────────────────────────────────────────
console.log('[T1] SpacetimeDB connection');

const connStatus = await page.evaluate(() => window.__test.getConnStatus());
connStatus === 'Connected'
  ? pass('connected to SpacetimeDB')
  : fail('connected to SpacetimeDB', `status: ${connStatus}`);

// ────────────────────────────────────────────────────
// T2: Clear arena, ensure clean state
// ────────────────────────────────────────────────────
console.log('[T2] Clean state');

await page.evaluate(() => {
  window.__test.serverClearArena();
});
await page.waitForTimeout(1000);

const cleanCount = await page.evaluate(() => window.__test.atoms.length);
cleanCount === 0
  ? pass('arena cleared')
  : fail('arena cleared', `${cleanCount} atoms remain`);

// ────────────────────────────────────────────────────
// T3: Ensure unfrozen
// ────────────────────────────────────────────────────
console.log('[T3] Unfreeze');

const frozen = await page.evaluate(() => window.__test.getServerFrozen());
if (frozen) {
  await page.evaluate(() => window.__test.serverToggleFreeze());
  await page.waitForTimeout(500);
}
const nowFrozen = await page.evaluate(() => window.__test.getServerFrozen());
!nowFrozen
  ? pass('arena unfrozen')
  : fail('arena unfrozen', `frozen=${nowFrozen}`);

// ────────────────────────────────────────────────────
// T4: Spawn oscillator, verify atoms appear
// ────────────────────────────────────────────────────
console.log('[T4] Spawn oscillator');

await page.evaluate(() => {
  window.__test.serverSpawnMachine('oscillator', 0.0, 5.0, 0.0);
});
await page.waitForTimeout(2000);

const oscAtoms = await page.evaluate(() => window.__test.atoms.length);
oscAtoms === 3
  ? pass('oscillator spawned 3 atoms', `got ${oscAtoms}`)
  : fail('oscillator spawned 3 atoms', `got ${oscAtoms}`);

// ────────────────────────────────────────────────────
// T5: Atoms fall (server physics running)
// ────────────────────────────────────────────────────
console.log('[T5] Server physics — atoms fall');

// Spawn a fresh atom high up to test falling
await page.evaluate(() => window.__test.serverClearArena());
await page.waitForTimeout(500);
await page.evaluate(() => {
  window.__test.serverSpawnMachine('oscillator', 0.0, 8.0, 0.0);
});
// Wait just enough for atoms to appear but not fully settle
await page.waitForTimeout(500);

const yBefore = await page.evaluate(() =>
  window.__test.atoms.map(a => a.group.position.y)
);

await page.waitForTimeout(SETTLE_MS);

const yAfter = await page.evaluate(() =>
  window.__test.atoms.map(a => a.group.position.y)
);

// At least one atom should have moved down (fallen)
const anyFell = yBefore.some((y, i) => yAfter[i] < y - 0.5);
anyFell
  ? pass('atoms fell due to gravity')
  : fail('atoms fell due to gravity', `before=${JSON.stringify(yBefore.map(y=>+y.toFixed(2)))}, after=${JSON.stringify(yAfter.map(y=>+y.toFixed(2)))}`);

// All atoms should be near ground level after settling
const GROUND_Y = -2;
const ATOM_RADIUS = 0.25;
const GROUND_LEVEL = GROUND_Y + ATOM_RADIUS; // -1.75
const allSettled = yAfter.every(y => y < GROUND_LEVEL + 0.5 && y > GROUND_Y - 1);
allSettled
  ? pass('atoms settled near ground')
  : fail('atoms settled near ground', `positions=${JSON.stringify(yAfter.map(y=>+y.toFixed(2)))}`);

// ────────────────────────────────────────────────────
// T6: Connections exist between atoms (oscillator from T5 is settled)
// ────────────────────────────────────────────────────
console.log('[T6] Connection rendering');

const connInfo = await page.evaluate(() => {
  const t = window.__test;
  return {
    localConns: t.connections.length,
    serverConns: t.connectionRows.size,
    bridges: t.connections.map(c => ({
      from: c.fromAtomId,
      to: c.toAtomId,
      fromNode: c.fromNodeIdx,
      toNode: c.toNodeIdx,
      meshInScene: c.bridgeMesh?.parent != null,
      meshVisible: c.bridgeMesh?.visible !== false,
    })),
  };
});

connInfo.serverConns === 2
  ? pass('server has 2 connections')
  : fail('server has 2 connections', `got ${connInfo.serverConns}`);

connInfo.localConns === 2
  ? pass('client has 2 local connections')
  : fail('client has 2 local connections', `got ${connInfo.localConns}`);

const allBridgesRendered = connInfo.bridges.every(b => b.meshInScene && b.meshVisible);
allBridgesRendered
  ? pass('all bridge meshes in scene and visible')
  : fail('all bridge meshes in scene and visible', JSON.stringify(connInfo.bridges));

// ────────────────────────────────────────────────────
// T7: Bridge positions are correct (endpoints near atoms)
// ────────────────────────────────────────────────────
console.log('[T7] Bridge endpoint accuracy');

const bridgeAccuracy = await page.evaluate(() => {
  const t = window.__test;
  const results = [];
  for (const conn of t.connections) {
    const fa = t.atomMap.get(conn.fromAtomId);
    const ta = t.atomMap.get(conn.toAtomId);
    if (!fa || !ta) { results.push({ ok: false, reason: 'missing atom' }); continue; }

    const bridgePos = conn.bridgeMesh.position;
    const midX = (fa.group.position.x + ta.group.position.x) / 2;
    const midY = (fa.group.position.y + ta.group.position.y) / 2;
    const midZ = (fa.group.position.z + ta.group.position.z) / 2;

    const dx = Math.abs(bridgePos.x - midX);
    const dy = Math.abs(bridgePos.y - midY);
    const dz = Math.abs(bridgePos.z - midZ);
    const maxDeviation = Math.max(dx, dy, dz);

    // Bridge midpoint should be roughly between the two atoms
    // Allow generous tolerance since nodes aren't at atom centers
    results.push({ ok: maxDeviation < 1.0, maxDeviation: +maxDeviation.toFixed(3) });
  }
  return results;
});

const allAccurate = bridgeAccuracy.every(r => r.ok);
allAccurate
  ? pass('bridge midpoints near atom midpoints', JSON.stringify(bridgeAccuracy))
  : fail('bridge midpoints near atom midpoints', JSON.stringify(bridgeAccuracy));

// ────────────────────────────────────────────────────
// T8: Freeze/unfreeze via server
// ────────────────────────────────────────────────────
console.log('[T8] Freeze/unfreeze');

await page.evaluate(() => window.__test.serverToggleFreeze());
await page.waitForTimeout(500);

const frozenAfter = await page.evaluate(() => window.__test.getServerFrozen());
frozenAfter
  ? pass('server froze')
  : fail('server froze', `frozen=${frozenAfter}`);

// Record positions while frozen
const frozenPos = await page.evaluate(() =>
  window.__test.atoms.map(a => ({ x: +a.group.position.x.toFixed(4), y: +a.group.position.y.toFixed(4) }))
);
await page.waitForTimeout(1000);
const frozenPos2 = await page.evaluate(() =>
  window.__test.atoms.map(a => ({ x: +a.group.position.x.toFixed(4), y: +a.group.position.y.toFixed(4) }))
);

const posUnchanged = frozenPos.every((p, i) => p.x === frozenPos2[i].x && p.y === frozenPos2[i].y);
posUnchanged
  ? pass('positions stable while frozen')
  : fail('positions stable while frozen');

// Unfreeze
await page.evaluate(() => window.__test.serverToggleFreeze());
await page.waitForTimeout(500);

// ────────────────────────────────────────────────────
// T9: Spawn walker (larger machine)
// ────────────────────────────────────────────────────
console.log('[T9] Spawn walker');

await page.evaluate(() => window.__test.serverClearArena());
await page.waitForTimeout(1000);

await page.evaluate(() => {
  window.__test.serverSpawnMachine('walker', 0.0, 5.0, 0.0);
});
await page.waitForTimeout(SETTLE_MS);

const walkerInfo = await page.evaluate(() => ({
  atoms: window.__test.atoms.length,
  conns: window.__test.connections.length,
  serverConns: window.__test.connectionRows.size,
}));

walkerInfo.atoms === 9
  ? pass('walker has 9 atoms')
  : fail('walker has 9 atoms', `got ${walkerInfo.atoms}`);

walkerInfo.serverConns === 8
  ? pass('walker has 8 server connections')
  : fail('walker has 8 server connections', `got ${walkerInfo.serverConns}`);

walkerInfo.conns === 8
  ? pass('walker has 8 local connections')
  : fail('walker has 8 local connections', `got ${walkerInfo.conns}`);

// ────────────────────────────────────────────────────
// T10: UI drag-and-drop machine spawn
// ────────────────────────────────────────────────────
console.log('[T10] UI drag-and-drop');

await page.evaluate(() => window.__test.serverClearArena());
await page.waitForTimeout(1000);

const card = page.locator('.machine-card', { hasText: 'Oscillator' });
const cardBox = await card.boundingBox();
if (cardBox) {
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(640, 400, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(SETTLE_MS);

  const uiAtoms = await page.evaluate(() => window.__test.atoms.length);
  uiAtoms === 3
    ? pass('UI drag spawned oscillator (3 atoms)')
    : fail('UI drag spawned oscillator', `got ${uiAtoms} atoms`);
} else {
  fail('UI drag-and-drop', 'machine card not found');
}

// ────────────────────────────────────────────────────
// T11: Stale atoms cleared on server clear
// ────────────────────────────────────────────────────
console.log('[T11] Server clear removes all local atoms');

// There should be atoms from T10
const preCount = await page.evaluate(() => window.__test.atoms.length);
await page.evaluate(() => window.__test.serverClearArena());
await page.waitForTimeout(1500);

const postCount = await page.evaluate(() => window.__test.atoms.length);
const postMaps = await page.evaluate(() => ({
  serverToLocal: window.__test.serverToLocalId.size,
  localToServer: window.__test.localToServerId.size,
  atomEntries: window.__test.atomEntries.size,
}));

postCount === 0
  ? pass('all local atoms removed after server clear')
  : fail('all local atoms removed after server clear', `${postCount} remain (was ${preCount})`);

postMaps.serverToLocal === 0 && postMaps.localToServer === 0
  ? pass('ID maps cleared')
  : fail('ID maps cleared', JSON.stringify(postMaps));

// ────────────────────────────────────────────────────
// T12: Reconnect clears stale state
// ────────────────────────────────────────────────────
console.log('[T12] Reconnect clears stale atoms');

// Spawn atoms, then simulate reconnect by clearing server and checking
await page.evaluate(() => window.__test.serverSpawnMachine('oscillator', 0.0, 5.0, 0.0));
await page.waitForTimeout(2000);

const preReconnect = await page.evaluate(() => window.__test.atoms.length);
preReconnect > 0
  ? pass(`atoms exist before clear (${preReconnect})`)
  : fail('atoms exist before clear');

// Clear server — simulates what happens when server restarts with empty state
await page.evaluate(() => window.__test.serverClearArena());
await page.waitForTimeout(1500);

const postReconnect = await page.evaluate(() => ({
  atoms: window.__test.atoms.length,
  connections: window.__test.connections.length,
}));

postReconnect.atoms === 0
  ? pass('no ghost atoms after server clear')
  : fail('no ghost atoms after server clear', `${postReconnect.atoms} remain`);

postReconnect.connections === 0
  ? pass('no ghost connections after server clear')
  : fail('no ghost connections after server clear', `${postReconnect.connections} remain`);

// ────────────────────────────────────────────────────
// T13: Screenshots for visual inspection
// ────────────────────────────────────────────────────
console.log('[T13] Screenshots');
await page.screenshot({ path: '/tmp/v2-regression-final.png' });
pass('screenshot saved to /tmp/v2-regression-final.png');

// ────────────────────────────────────────────────────
// Cleanup
// ────────────────────────────────────────────────────
await page.evaluate(() => window.__test.serverClearArena());
await page.waitForTimeout(500);

// ── Report ──
console.log('\n' + '='.repeat(50));
const passCount = results.filter(r => r.ok).length;
const failCount = results.filter(r => !r.ok).length;
console.log(`Results: ${passCount} passed, ${failCount} failed, ${results.length} total`);
if (consoleErrors.length > 0) {
  console.log(`\nConsole errors during run:`);
  for (const e of consoleErrors) console.log(`  ${e}`);
}
if (failCount > 0) {
  console.log('\nFailed:');
  for (const r of results.filter(r => !r.ok)) console.log(`  ${r.name}`);
}
console.log('='.repeat(50) + '\n');

await browser.close();
process.exit(failCount === 0 ? 0 : 1);
