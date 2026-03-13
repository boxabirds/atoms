/**
 * Visual regression test suite for the metaball skin pipeline.
 *
 * Usage:
 *   node test-regression.mjs              # compare against golden screenshots
 *   node test-regression.mjs --update     # capture new golden screenshots
 *   node test-regression.mjs --diff       # save diff images for failures
 *
 * Requires: playwright, pixelmatch, pngjs
 * Expects a local server at http://localhost:8000
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(__dirname, 'test', 'golden');
const DIFF_DIR = join(__dirname, 'test', 'diffs');
const PIXEL_DIFF_THRESHOLD = 0.1;  // pixelmatch color threshold (0-1)
const MAX_DIFF_PERCENT = 2.0;      // max % of pixels that can differ before failing

const UPDATE_MODE = process.argv.includes('--update');
const SAVE_DIFFS = process.argv.includes('--diff');

// ---------------------------------------------------------------------------
// Test scenario definitions
// ---------------------------------------------------------------------------

const scenarios = [
  {
    name: 'fresh-load',
    description: 'Empty scene with UI, ground plane visible',
    run: async (page) => {
      // Just wait for render
      await page.waitForTimeout(1000);
    }
  },
  {
    name: 'machine-placed',
    description: 'Oscillator placed at center with default skin opacity',
    run: async (page) => {
      await dropMachine(page, 'Oscillator', 640, 380);
      await page.waitForTimeout(1500);
      // Freeze so atoms stay put for reproducible screenshots
      await page.keyboard.press('Space');
      await page.waitForTimeout(500);
    }
  },
  {
    name: 'skin-opacity-0',
    description: 'Skin at 0% — atoms only, no skin overlay',
    run: async (page) => {
      await setSkinOpacity(page, 0);
      await page.waitForTimeout(500);
    }
  },
  {
    name: 'skin-opacity-100',
    description: 'Skin at 100% — full coverage, no atoms poking through',
    run: async (page) => {
      await setSkinOpacity(page, 100);
      await page.waitForTimeout(500);
    }
  },
  {
    name: 'skin-opacity-50',
    description: 'Skin at 50% — atoms partially visible through skin',
    run: async (page) => {
      await setSkinOpacity(page, 50);
      await page.waitForTimeout(500);
    }
  },
  {
    name: 'pbr-rusty',
    description: 'Rusty-and-warped PBR texture applied via skin picker',
    run: async (page) => {
      await setSkinOpacity(page, 80);
      await applySkin(page, 640, 380, 'rusty-and-warped');
      await page.waitForTimeout(2000);
    }
  },
  {
    name: 'two-machines-flat',
    description: 'Two machines with flat skins — different molecule colors',
    run: async (page) => {
      // Reset skin on first machine
      await applySkin(page, 640, 380, 'none');
      await page.waitForTimeout(500);
      // Unfreeze briefly to add second machine, then freeze again
      await page.keyboard.press('Space');
      await page.waitForTimeout(300);
      await dropMachine(page, 'Tracker', 850, 380);
      await page.waitForTimeout(1500);
      await page.keyboard.press('Space');
      await page.waitForTimeout(500);
    }
  },
  {
    name: 'two-skins',
    description: 'Two machines with different PBR skins simultaneously',
    run: async (page) => {
      await applySkin(page, 640, 380, 'rusty-and-warped');
      await page.waitForTimeout(1500);
      await applySkin(page, 850, 380, 'lumpy-translucent-gold');
      await page.waitForTimeout(2000);
    }
  },
  {
    name: 'debug-view',
    description: 'Pipeline debug view showing RT channels',
    run: async (page) => {
      await page.keyboard.press('d');
      await page.waitForTimeout(500);
    }
  },
  {
    name: 'debug-off',
    description: 'Debug view toggled off — normal rendering restored',
    run: async (page) => {
      await page.keyboard.press('d');
      await page.waitForTimeout(500);
    }
  },
];

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

async function dropMachine(page, name, x, y) {
  const card = page.locator('.machine-card', { hasText: name });
  const box = await card.boundingBox();
  if (!box) throw new Error(`Machine card "${name}" not found`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
}

async function setSkinOpacity(page, percent) {
  const slider = page.locator('#skin-slider');
  await slider.fill(String(percent));
  await slider.dispatchEvent('input');
}

async function applySkin(page, x, y, skinName) {
  await page.locator('#select-tool-btn').click();
  await page.waitForTimeout(300);
  await page.mouse.dblclick(x, y);
  await page.waitForTimeout(1000);
  const picker = page.locator('#skin-picker');
  if (await picker.isVisible()) {
    await page.locator('#skin-select').selectOption(skinName);
    await page.waitForTimeout(500);
  } else {
    console.log(`  ⚠ Skin picker not visible for (${x}, ${y})`);
  }
}

function comparePNG(actualBuf, goldenBuf, diffPath) {
  const actual = PNG.sync.read(actualBuf);
  const golden = PNG.sync.read(goldenBuf);

  if (actual.width !== golden.width || actual.height !== golden.height) {
    return { pass: false, diffPercent: 100, reason: `Size mismatch: ${actual.width}x${actual.height} vs ${golden.width}x${golden.height}` };
  }

  const { width, height } = actual;
  const diff = new PNG({ width, height });
  const numDiff = pixelmatch(actual.data, golden.data, diff.data, width, height, {
    threshold: PIXEL_DIFF_THRESHOLD,
  });

  const totalPixels = width * height;
  const diffPercent = (numDiff / totalPixels) * 100;

  if (SAVE_DIFFS && diffPath && diffPercent > 0) {
    mkdirSync(dirname(diffPath), { recursive: true });
    writeFileSync(diffPath, PNG.sync.write(diff));
  }

  return {
    pass: diffPercent <= MAX_DIFF_PERCENT,
    diffPercent: Math.round(diffPercent * 100) / 100,
    numDiff,
    totalPixels,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(UPDATE_MODE ? '📸 Capturing golden screenshots...\n' : '🔍 Running visual regression tests...\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('http://localhost:8000', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  let passed = 0;
  let failed = 0;
  let updated = 0;
  const failures = [];

  for (const scenario of scenarios) {
    const goldenPath = join(GOLDEN_DIR, `${scenario.name}.png`);
    const diffPath = join(DIFF_DIR, `${scenario.name}-diff.png`);

    try {
      await scenario.run(page);
      const screenshotBuf = await page.screenshot();

      if (UPDATE_MODE) {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(goldenPath, screenshotBuf);
        console.log(`  📸 ${scenario.name} — saved`);
        updated++;
      } else {
        if (!existsSync(goldenPath)) {
          console.log(`  ⏭ ${scenario.name} — no golden (run --update first)`);
          continue;
        }

        const goldenBuf = readFileSync(goldenPath);
        const result = comparePNG(screenshotBuf, goldenBuf, diffPath);

        if (result.pass) {
          console.log(`  ✓ ${scenario.name} — ${result.diffPercent}% diff`);
          passed++;
        } else {
          const reason = result.reason || `${result.diffPercent}% diff (>${MAX_DIFF_PERCENT}% threshold)`;
          console.log(`  ✗ ${scenario.name} — ${reason}`);
          failed++;
          failures.push({ name: scenario.name, ...result });
          // Save the actual screenshot for comparison
          writeFileSync(join(DIFF_DIR, `${scenario.name}-actual.png`), screenshotBuf);
        }
      }
    } catch (err) {
      console.log(`  ✗ ${scenario.name} — ERROR: ${err.message}`);
      failed++;
      failures.push({ name: scenario.name, error: err.message });
    }
  }

  await browser.close();

  // Summary
  console.log('\n' + '─'.repeat(60));
  if (UPDATE_MODE) {
    console.log(`📸 Updated ${updated} golden screenshots in test/golden/`);
  } else {
    console.log(`Results: ${passed} passed, ${failed} failed, ${scenarios.length} total`);
    if (consoleErrors.length > 0) {
      console.log(`\n⚠ Console errors during run:`);
      for (const e of consoleErrors) console.log(`  ${e}`);
    }
    if (failures.length > 0) {
      console.log(`\nFailed scenarios:`);
      for (const f of failures) {
        console.log(`  ${f.name}: ${f.reason || f.error || `${f.diffPercent}% pixel diff`}`);
      }
      if (SAVE_DIFFS) {
        console.log(`\nDiff images saved to test/diffs/`);
      } else {
        console.log(`\nRe-run with --diff to save diff images`);
      }
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
