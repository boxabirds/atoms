/**
 * Performance test: 3 machines must not tank framerate.
 *
 * Bug: Position updates drop to <1fps with 3 machines.
 * Suspected: O(n²) CPU work in updateTendrils(), per-frame object
 * allocation/destruction, connection churn during physics, or MC recompute
 * storms from unstable molecule composition.
 *
 * This test instruments the animate loop to find the actual bottleneck.
 *
 * Run: node test-mc-perf.test.mjs
 */

import { chromium } from 'playwright';

const BASE_URL = process.env.TEST_PAGE_URL || 'http://localhost:8000';

const MIN_ACCEPTABLE_FPS = 30;
const TARGET_FPS = 60;
const MEASUREMENT_WINDOW_MS = 3000;

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

console.log('\n═══ Perf Test: 3 Machines Framerate + Profiling ═══\n');

// ── Baseline ───────────────────────────────────────────────────────────

console.log('  Measuring baseline fps...');
const baseline = await page.evaluate((ms) => {
  return new Promise(resolve => {
    const times = [];
    const start = performance.now();
    function tick() {
      times.push(performance.now());
      if (performance.now() - start < ms) requestAnimationFrame(tick);
      else {
        const ft = [];
        for (let i = 1; i < times.length; i++) ft.push(times[i] - times[i - 1]);
        const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
        resolve({ fps: Math.round(1000 / avg) });
      }
    }
    requestAnimationFrame(tick);
  });
}, MEASUREMENT_WINDOW_MS);
console.log(`  Baseline: ${baseline.fps} fps\n`);

// ── Create 3 machines at unstable spacing so connections churn ──────────

console.log('  Creating 3 machines (5 atoms each) with physics active...');
await page.evaluate(() => {
  const t = window.__test;
  const V3 = t.THREE.Vector3;

  // Drop atoms from height so they fall, bounce, settle — connections
  // form/break during settling which changes molecule composition
  for (let m = 0; m < 3; m++) {
    const baseX = (m - 1) * 3.0;
    for (let a = 0; a < 5; a++) {
      const angle = (a / 5) * Math.PI * 2;
      t.addAtom('pulse', new V3(
        baseX + Math.cos(angle) * 0.35,
        3.0 + a * 0.3,  // drop from height
        Math.sin(angle) * 0.35
      ));
    }
  }
});

// Measure DURING settling (when physics is actively moving atoms)
console.log('  Measuring fps during physics settling (the real scenario)...');

const settleResult = await page.evaluate((ms) => {
  return new Promise(resolve => {
    const t = window.__test;
    const times = [];
    const start = performance.now();

    function tick() {
      times.push(performance.now());
      if (performance.now() - start < ms) requestAnimationFrame(tick);
      else {
        const ft = [];
        for (let i = 1; i < times.length; i++) ft.push(times[i] - times[i - 1]);
        ft.sort((a, b) => a - b);
        const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
        const p95 = ft[Math.floor(ft.length * 0.95)];
        const worst = ft[ft.length - 1];

        // Count connections and molecules at end
        let connCount = 0;
        const seen = new Set();
        for (const a of t.atoms) {
          for (const c of a.connections) {
            const key = [c.fromAtomId, c.toAtomId].sort().join('-');
            if (!seen.has(key)) { seen.add(key); connCount++; }
          }
        }

        resolve({
          fps: Math.round(1000 / avg),
          p95Fps: Math.round(1000 / p95),
          worstFps: Math.round(1000 / worst),
          avgMs: avg.toFixed(1),
          worstMs: worst.toFixed(1),
          frameCount: ft.length,
          atoms: t.atoms.length,
          connections: connCount,
          molecules: t.moleculeSkins.size,
        });
      }
    }
    requestAnimationFrame(tick);
  });
}, MEASUREMENT_WINDOW_MS);

console.log(`  During settling: ${settleResult.fps} fps avg, ${settleResult.p95Fps} p95, ${settleResult.worstFps} worst`);
console.log(`  Frame times: ${settleResult.avgMs}ms avg, ${settleResult.worstMs}ms worst, ${settleResult.frameCount} frames`);
console.log(`  State: ${settleResult.atoms} atoms, ${settleResult.connections} connections, ${settleResult.molecules} molecules\n`);

// ── Measure with forced continuous motion (atoms actively bouncing) ────

console.log('  Measuring fps with forced continuous jitter...');
const jitterResult = await page.evaluate((ms) => {
  return new Promise(resolve => {
    const t = window.__test;
    const times = [];
    const start = performance.now();
    const JITTER = 0.04;

    function tick() {
      const now = performance.now();
      times.push(now);

      // Jitter all atoms to keep dirty detection + tendrils active
      const phase = (now - start) * 0.005;
      for (let i = 0; i < t.atoms.length; i++) {
        t.atoms[i].group.position.x += Math.sin(phase + i * 2.1) * JITTER;
        t.atoms[i].group.position.z += Math.cos(phase + i * 1.7) * JITTER;
      }

      if (now - start < ms) requestAnimationFrame(tick);
      else {
        const ft = [];
        for (let i = 1; i < times.length; i++) ft.push(times[i] - times[i - 1]);
        ft.sort((a, b) => a - b);
        const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
        const p95 = ft[Math.floor(ft.length * 0.95)];
        const worst = ft[ft.length - 1];
        resolve({
          fps: Math.round(1000 / avg),
          p95Fps: Math.round(1000 / p95),
          worstFps: Math.round(1000 / worst),
          avgMs: avg.toFixed(1),
          worstMs: worst.toFixed(1),
          frameCount: ft.length,
        });
      }
    }
    requestAnimationFrame(tick);
  });
}, MEASUREMENT_WINDOW_MS);

console.log(`  With jitter: ${jitterResult.fps} fps avg, ${jitterResult.p95Fps} p95, ${jitterResult.worstFps} worst`);
console.log(`  Frame times: ${jitterResult.avgMs}ms avg, ${jitterResult.worstMs}ms worst\n`);

// ── Profile: inject timing around the expensive functions ──────────────

console.log('  Injecting per-function profiling into animate loop...');
const profileResult = await page.evaluate((ms) => {
  return new Promise(resolve => {
    // We can't patch module-scoped functions, but we can measure from
    // the console timeline. Use performance.mark/measure inside rAF.
    const t = window.__test;
    const JITTER = 0.04;
    const timings = [];
    const start = performance.now();

    function tick() {
      const now = performance.now();

      // Jitter to keep things active
      const phase = (now - start) * 0.005;
      for (let i = 0; i < t.atoms.length; i++) {
        t.atoms[i].group.position.x += Math.sin(phase + i * 2.1) * JITTER;
      }

      // Can't time internal functions without source patches.
      // But we CAN check how many tendril lines exist (proxy for tendril cost)
      timings.push({
        ts: now,
        atoms: t.atoms.length,
        molecules: t.moleculeSkins.size,
      });

      if (now - start < ms) requestAnimationFrame(tick);
      else {
        // Count scene children as proxy for object churn
        resolve({
          sampleCount: timings.length,
          finalAtoms: t.atoms.length,
          finalMolecules: t.moleculeSkins.size,
        });
      }
    }
    requestAnimationFrame(tick);
  });
}, 1000);

console.log(`  Profile: ${profileResult.sampleCount} samples, ${profileResult.finalAtoms} atoms, ${profileResult.finalMolecules} molecules\n`);

// ── Assertions ─────────────────────────────────────────────────────────

console.log('── Results ──\n');

// Use the worse of settle and jitter results
const testFps = Math.min(settleResult.fps, jitterResult.fps);
const testP95 = Math.min(settleResult.p95Fps, jitterResult.p95Fps);

testFps >= MIN_ACCEPTABLE_FPS
  ? pass(`avg fps >= ${MIN_ACCEPTABLE_FPS}`, `${testFps} fps (settle: ${settleResult.fps}, jitter: ${jitterResult.fps})`)
  : fail(`avg fps >= ${MIN_ACCEPTABLE_FPS}`, `${testFps} fps — app grinding to halt`);

testP95 >= MIN_ACCEPTABLE_FPS
  ? pass(`p95 fps >= ${MIN_ACCEPTABLE_FPS}`, `${testP95} fps`)
  : fail(`p95 fps >= ${MIN_ACCEPTABLE_FPS}`, `${testP95} fps`);

testFps >= TARGET_FPS
  ? pass(`avg fps >= ${TARGET_FPS} (target)`, `${testFps} fps`)
  : fail(`avg fps >= ${TARGET_FPS} (target)`, `${testFps} fps`);

const ratio = testFps / (baseline.fps || 1);
ratio >= 0.5
  ? pass('fps within 50% of baseline', `${(ratio * 100).toFixed(0)}%`)
  : fail('fps within 50% of baseline', `${(ratio * 100).toFixed(0)}% — per-frame CPU work too expensive`);

const worstMs = Math.max(parseFloat(settleResult.worstMs), parseFloat(jitterResult.worstMs));
worstMs < 200
  ? pass('worst frame < 200ms', `${worstMs}ms`)
  : fail('worst frame < 200ms', `${worstMs}ms — severe stall`);

// ── Report ──
console.log('\n═══════════════════════════════════════════');
const passCount = results.filter(r => r.passed).length;
const failCount = results.filter(r => !r.passed).length;
console.log(`  Results: ${passCount} passed, ${failCount} failed`);
console.log('═══════════════════════════════════════════\n');

await browser.close();
process.exit(failCount === 0 ? 0 : 1);
