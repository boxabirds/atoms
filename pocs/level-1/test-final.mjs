import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

await page.goto('http://localhost:8000', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Drop Oscillator at center-left
const osc = page.locator('.machine-card', { hasText: 'Oscillator' });
let box = await osc.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(450, 380, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(1500);

// Drop Tracker at center-right
const tracker = page.locator('.machine-card', { hasText: 'Tracker' });
box = await tracker.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(750, 380, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(1500);

// Skin 80%
const slider = page.locator('#skin-slider');
await slider.fill('80');
await slider.dispatchEvent('input');
await page.waitForTimeout(500);

// 1. Both machines, flat color, aligned
await page.screenshot({ path: '/tmp/final-1-flat.png' });

// 2. Apply rusty to Oscillator
await page.locator('#select-tool-btn').click();
await page.waitForTimeout(300);
await page.mouse.dblclick(450, 380);
await page.waitForTimeout(1000);
if (await page.locator('#skin-picker').isVisible()) {
  await page.locator('#skin-select').selectOption('rusty-and-warped');
  await page.waitForTimeout(2000);
}
await page.screenshot({ path: '/tmp/final-2-osc-rusty.png' });

// 3. Apply gold to Tracker
await page.mouse.dblclick(750, 380);
await page.waitForTimeout(1000);
if (await page.locator('#skin-picker').isVisible()) {
  await page.locator('#skin-select').selectOption('lumpy-translucent-gold');
  await page.waitForTimeout(2000);
}
await page.screenshot({ path: '/tmp/final-3-both-skins.png' });

// 4. Orbit to side view
const cx = 640, cy = 360;
await page.mouse.move(cx + 150, cy);
await page.mouse.down();
for (let i = 0; i < 25; i++) {
  await page.mouse.move(cx + 150 - i * 12, cy, { steps: 1 });
  await page.waitForTimeout(30);
}
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/final-4-orbited.png' });

// 5. Debug view
await page.keyboard.press('d');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/final-5-debug.png' });

console.log('Errors:', errors.length ? errors.join('; ') : 'none');
await browser.close();
