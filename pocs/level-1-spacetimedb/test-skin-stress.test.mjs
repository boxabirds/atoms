/**
 * Stress test: spawn Signal Chains one per second until framerate drops below 1fps.
 * Tracks per-molecule skin update rate continuously.
 *
 * Run: node test-skin-stress.test.mjs
 */
import { chromium } from 'playwright';

const BASE_URL = process.env.TEST_PAGE_URL || 'http://localhost:8000';
const SPAWN_INTERVAL_MS = 1000;
const MIN_FPS_THRESHOLD = 1;
const ARENA_HALF = 8;
const MEASURE_WINDOW_MS = 900; // measure over most of each 1s interval

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
page.on('console', msg => { if (msg.type() === 'error') console.error('CONSOLE:', msg.text()); });

await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

console.log('\n═══ Stress Test: Spawn Until Death ═══\n');

// Unfreeze
await page.evaluate(() => { window.__test.isFrozen = false; });

const skinNames = ['rusty-and-warped', 'lumpy-translucent-gold', 'aquamarine-glass', 'flickering-flame',
  'rainbow-marshmallow', 'william-slime', 'xmas-decorations', 'none'];

let round = 0;
let alive = true;

while (alive) {
  round++;

  // Spawn a new Signal Chain at a random position within the arena
  const skinName = skinNames[(round - 1) % skinNames.length];
  await page.evaluate(async ({ skinName }) => {
    const t = window.__test;
    const V3 = t.THREE.Vector3;
    const scIdx = t.PREBUILT_MACHINES.findIndex(m => m.name === 'Signal Chain');
    const ARENA = 8;
    const x = (Math.random() - 0.5) * ARENA * 1.5;
    const z = (Math.random() - 0.5) * ARENA * 1.5;
    t.spawnMachine(scIdx, new V3(x, 0, z));

    // Apply skin to the newest molecule
    await new Promise(r => setTimeout(r, 200));
    const entries = [...t.moleculeSkins.entries()];
    if (entries.length > 0) {
      const [, entry] = entries[entries.length - 1];
      const reg = t.SKIN_REGISTRY.find(s => s.name === skinName);
      if (reg && reg.type === 'json') await t.loadSkinFromJSON(reg.name, reg.path);
      if (reg) {
        const mat = t.createSkinMaterial(skinName, 0xdd7744);
        if (entry.mesh) { entry.mesh.material.dispose(); entry.mesh.material = mat; }
        entry.skinType = skinName;
      }
    }
  }, { skinName });

  // Measure fps and per-molecule skin update rates over the rest of this second
  const stats = await page.evaluate((ms) => {
    return new Promise(resolve => {
      const t = window.__test;
      const start = performance.now();
      const frameTimes = [];

      const geoIds = new Map();
      const geoCounts = new Map();
      for (const [k, e] of t.moleculeSkins.entries()) {
        geoIds.set(k, e.mesh?.geometry?.id ?? -1);
        geoCounts.set(k, 0);
      }

      function tick() {
        const now = performance.now();
        frameTimes.push(now);

        for (const [k, e] of t.moleculeSkins.entries()) {
          const gid = e.mesh?.geometry?.id ?? -1;
          if (gid !== (geoIds.get(k) ?? -1) && gid !== -1) {
            geoIds.set(k, gid);
            geoCounts.set(k, (geoCounts.get(k) || 0) + 1);
          }
        }

        if (now - start < ms) requestAnimationFrame(tick);
        else {
          const ft = [];
          for (let i = 1; i < frameTimes.length; i++) ft.push(frameTimes[i] - frameTimes[i - 1]);
          if (ft.length === 0) { resolve({ fps: 0, atoms: t.atoms.length, molecules: 0, skinRates: [] }); return; }
          ft.sort((a, b) => a - b);
          const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
          const secs = ms / 1000;

          const skinRates = [];
          for (const [k, e] of t.moleculeSkins.entries()) {
            const updates = geoCounts.get(k) || 0;
            skinRates.push({
              key: k.length > 12 ? k.substring(0, 10) + '..' : k,
              atoms: e.atomIds.length,
              skin: e.skinType,
              rate: (updates / secs).toFixed(1),
            });
          }

          resolve({
            fps: Math.round(1000 / avg),
            worstMs: ft[ft.length - 1].toFixed(0),
            atoms: t.atoms.length,
            connections: t.connections.length,
            molecules: t.moleculeSkins.size,
            skinRates,
          });
        }
      }
      requestAnimationFrame(tick);
    });
  }, MEASURE_WINDOW_MS);

  // Print round summary
  const avgSkinRate = stats.skinRates.length > 0
    ? (stats.skinRates.reduce((s, r) => s + parseFloat(r.rate), 0) / stats.skinRates.length).toFixed(1)
    : '0';
  const minSkinRate = stats.skinRates.length > 0
    ? Math.min(...stats.skinRates.map(r => parseFloat(r.rate))).toFixed(1)
    : '0';

  console.log(
    `Round ${String(round).padStart(2)}: ` +
    `${String(stats.atoms).padStart(3)} atoms, ` +
    `${String(stats.molecules).padStart(2)} mols, ` +
    `${String(stats.connections).padStart(3)} conns | ` +
    `${String(stats.fps).padStart(3)}fps (worst ${stats.worstMs}ms) | ` +
    `skin: avg=${avgSkinRate}/s min=${minSkinRate}/s`
  );

  // Print per-molecule detail every 5 rounds
  if (round % 5 === 0 || stats.fps < 10) {
    for (const r of stats.skinRates) {
      const flag = parseFloat(r.rate) < 5 ? ' !!!' : '';
      console.log(`    [${r.key}] ${r.atoms} atoms ${r.skin}: ${r.rate}/s${flag}`);
    }
  }

  if (stats.fps < MIN_FPS_THRESHOLD) {
    console.log(`\n══ DEAD at round ${round}: ${stats.fps}fps with ${stats.atoms} atoms, ${stats.molecules} molecules ══\n`);
    alive = false;
  }

  if (round > 50) {
    console.log(`\n══ SURVIVED 50 rounds: ${stats.fps}fps with ${stats.atoms} atoms, ${stats.molecules} molecules ══\n`);
    alive = false;
  }
}

await browser.close();
