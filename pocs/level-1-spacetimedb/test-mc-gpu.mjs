/**
 * Playwright test for GPU Marching Cubes standalone validation.
 *
 * Run: node test-mc-gpu.mjs
 * Requires: http-server running on port 8000 serving this directory
 */

import { chromium } from 'playwright';

const TEST_PAGE_URL = process.env.TEST_PAGE_URL || 'http://localhost:8000/mc-gpu-test.html';
const TEST_TIMEOUT_MS = 15000;
const SCREENSHOT_PATH = '/tmp/mc-gpu-test.png';

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const consoleMessages = [];
const errors = [];

page.on('console', msg => {
  const text = msg.text();
  consoleMessages.push({ type: msg.type(), text });
  console.log(`[${msg.type()}] ${text}`);
  if (msg.type() === 'error' && !text.includes('favicon')) errors.push(text);
});

page.on('pageerror', err => {
  const msg = `PAGE ERROR: ${err.message}`;
  console.log(msg);
  errors.push(msg);
});

console.log(`\nLoading ${TEST_PAGE_URL}...`);
await page.goto(TEST_PAGE_URL, { waitUntil: 'networkidle' });

// Wait for tests to complete (poll for __mcTestResults)
console.log('Waiting for compute tests to finish...');
const testResult = await page.evaluate(() => {
  return new Promise((resolve, reject) => {
    const POLL_INTERVAL_MS = 200;
    const deadline = Date.now() + 15000; // 15s timeout
    const check = () => {
      if (window.__mcTestResults) {
        resolve({
          results: window.__mcTestResults,
          allPassed: window.__mcTestPassed,
        });
      } else if (Date.now() > deadline) {
        reject(new Error('Timeout waiting for MC test results'));
      } else {
        setTimeout(check, POLL_INTERVAL_MS);
      }
    };
    check();
  });
});

// Screenshot
await page.screenshot({ path: SCREENSHOT_PATH });
console.log(`\nScreenshot saved: ${SCREENSHOT_PATH}`);

// Report
console.log('\n════════════════════════════════════════');
console.log('  GPU Marching Cubes Test Results');
console.log('════════════════════════════════════════');

const { results, allPassed } = testResult;

for (const [name, r] of Object.entries(results)) {
  if (name === '_responsiveness') {
    console.log(`  Responsiveness: ${r.elapsed}ms ${r.passed ? '✓' : '✗ FAIL'}`);
    continue;
  }
  if (name === 'error') {
    console.log(`  ERROR: ${r}`);
    continue;
  }
  const status = r.passed ? '✓' : '✗';
  const extras = [];
  if (r.outOfBounds > 0) extras.push(`${r.outOfBounds} out-of-bounds`);
  if (r.badNormals > 0) extras.push(`${r.badNormals} bad normals`);
  console.log(`  ${status} ${name}: ${r.vertexCount} verts, ${r.elapsed}ms${extras.length ? ' (' + extras.join(', ') + ')' : ''}`);
}

console.log('════════════════════════════════════════');
console.log(`  ${allPassed ? 'ALL PASSED ✓' : 'SOME FAILED ✗'}`);
console.log('════════════════════════════════════════');

if (errors.length > 0) {
  console.log(`\nConsole errors (${errors.length}):`);
  errors.forEach(e => console.log(`  - ${e}`));
}

await browser.close();
process.exit(allPassed && errors.length === 0 ? 0 : 1);
