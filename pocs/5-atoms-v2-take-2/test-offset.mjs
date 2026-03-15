import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', msg => { if (msg.type() === 'error') console.log(`ERR: ${msg.text()}`); });

await page.goto('http://localhost:8000', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Drop Walker at center
const walker = page.locator('.machine-card', { hasText: 'Walker' });
const box = await walker.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(640, 360, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(2000);

// Freeze so atoms don't move
await page.keyboard.press('Space');
await page.waitForTimeout(500);

// Zoom in closer
await page.mouse.move(640, 360);
for (let i = 0; i < 5; i++) {
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(100);
}
await page.waitForTimeout(500);

// Set skin to 60% so we can see atoms through skin
const slider = page.locator('#skin-slider');
await slider.fill('60');
await slider.dispatchEvent('input');
await page.waitForTimeout(500);

// Default view
await page.screenshot({ path: '/tmp/offset-1-default.png' });

// Use evaluate to orbit the camera via OrbitControls
// OrbitControls listens on pointermove with button pressed
// We need to use the canvas element specifically
const canvas = page.locator('canvas');
const cbox = await canvas.boundingBox();

// Orbit by dragging on the canvas (not UI)
// Small orbit left
await page.mouse.move(cbox.x + cbox.width * 0.6, cbox.y + cbox.height * 0.5);
await page.mouse.down();
await page.mouse.move(cbox.x + cbox.width * 0.4, cbox.y + cbox.height * 0.5, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/offset-2-orbit-left.png' });

// Orbit up
await page.mouse.move(cbox.x + cbox.width * 0.5, cbox.y + cbox.height * 0.6);
await page.mouse.down();
await page.mouse.move(cbox.x + cbox.width * 0.5, cbox.y + cbox.height * 0.4, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/offset-3-orbit-up.png' });

// More extreme orbit
await page.mouse.move(cbox.x + cbox.width * 0.7, cbox.y + cbox.height * 0.5);
await page.mouse.down();
await page.mouse.move(cbox.x + cbox.width * 0.2, cbox.y + cbox.height * 0.5, { steps: 30 });
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/offset-4-orbit-extreme.png' });

// Now skin=0 for atom-only reference at same angle
await slider.fill('0');
await slider.dispatchEvent('input');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/offset-5-noskin-reference.png' });

await browser.close();
