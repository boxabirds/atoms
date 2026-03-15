import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', msg => { if (msg.type() === 'error') console.log(`ERR: ${msg.text()}`); });

await page.goto('http://localhost:8000', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Drop Oscillator (doesn't fly off on spacebar)
const osc = page.locator('.machine-card', { hasText: 'Oscillator' });
const box = await osc.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(640, 360, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(2000);

// Set skin to 70%
const slider = page.locator('#skin-slider');
await slider.fill('70');
await slider.dispatchEvent('input');
await page.waitForTimeout(500);

// Default view — skin should align with atoms
await page.screenshot({ path: '/tmp/align-1-default.png' });

// Orbit: drag on canvas area (avoid UI panels)
const canvas = page.locator('canvas');
const cbox = await canvas.boundingBox();
const cx = cbox.x + cbox.width / 2;
const cy = cbox.y + cbox.height / 2;

// Orbit right
await page.mouse.move(cx - 100, cy);
await page.mouse.down();
for (let i = 0; i < 20; i++) {
  await page.mouse.move(cx - 100 + i * 10, cy, { steps: 1 });
  await page.waitForTimeout(30);
}
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/align-2-orbit-right.png' });

// Orbit up
await page.mouse.move(cx, cy + 80);
await page.mouse.down();
for (let i = 0; i < 20; i++) {
  await page.mouse.move(cx, cy + 80 - i * 8, { steps: 1 });
  await page.waitForTimeout(30);
}
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/align-3-orbit-up.png' });

// Set skin to 0 for reference
await slider.fill('0');
await slider.dispatchEvent('input');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/align-4-noskin.png' });

await browser.close();
