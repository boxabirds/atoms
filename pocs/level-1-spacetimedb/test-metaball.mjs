import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', msg => {
  if (msg.type() === 'error') errors.push(msg.text());
  if (msg.type() === 'warning' && msg.text().includes('WebGPU')) errors.push(msg.text());
});
page.on('pageerror', err => errors.push(err.message));

await page.goto('http://localhost:8000', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.screenshot({ path: '/tmp/meta-1-empty.png' });

// Drop Walker
const walker = page.locator('.machine-card', { hasText: 'Walker' });
const box = await walker.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(500, 400, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/meta-2-walker.png' });

// Drop Tracker
const tracker = page.locator('.machine-card', { hasText: 'Tracker' });
const tbox = await tracker.boundingBox();
await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2);
await page.mouse.down();
await page.mouse.move(700, 350, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/meta-3-two-machines.png' });

// Drop Oscillator
const osc = page.locator('.machine-card', { hasText: 'Oscillator' });
const obox = await osc.boundingBox();
await page.mouse.move(obox.x + obox.width / 2, obox.y + obox.height / 2);
await page.mouse.down();
await page.mouse.move(350, 300, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/meta-4-three-machines.png' });

// Test skin opacity slider — move to 0%
const slider = page.locator('#skin-slider');
await slider.fill('0');
await slider.dispatchEvent('input');
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/meta-5-opacity-0.png' });

// Restore opacity to 80%
await slider.fill('80');
await slider.dispatchEvent('input');
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/meta-6-opacity-80.png' });

// --- Phase 2: PBR texture test ---
// Switch to select tool, then double-click an atom to open skin picker
await page.locator('#select-tool-btn').click();
await page.waitForTimeout(500);

// Double-click on walker atoms (around 500, 400)
await page.mouse.dblclick(500, 400);
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/meta-7-skin-picker.png' });

// Select "rusty-and-warped" from the skin picker dropdown
const skinSelect = page.locator('#skin-select');
const pickerVisible = await page.locator('#skin-picker').isVisible();
if (pickerVisible) {
  await skinSelect.selectOption('rusty-and-warped');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/meta-8-pbr-texture.png' });
} else {
  console.log('Skin picker not visible — trying direct click on atom center');
  // Atoms might be slightly offset; click center of scene
  await page.mouse.dblclick(500, 420);
  await page.waitForTimeout(500);
  if (await page.locator('#skin-picker').isVisible()) {
    await skinSelect.selectOption('rusty-and-warped');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/meta-8-pbr-texture.png' });
  } else {
    console.log('Could not open skin picker');
    await page.screenshot({ path: '/tmp/meta-8-no-picker.png' });
  }
}

console.log('Errors:', errors.length ? errors : 'none');
await browser.close();
console.log('Done — screenshots in /tmp/meta-*.png');
