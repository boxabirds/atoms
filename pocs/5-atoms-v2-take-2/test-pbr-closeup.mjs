import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', msg => { if (msg.type() === 'error') console.log(`ERR: ${msg.text()}`); });

await page.goto('http://localhost:8000', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Drop Walker
const walker = page.locator('.machine-card', { hasText: 'Walker' });
const box = await walker.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(640, 400, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(2000);

// Increase skin opacity to 100% for clearer view
const slider = page.locator('#skin-slider');
await slider.fill('100');
await slider.dispatchEvent('input');
await page.waitForTimeout(500);

// Before PBR — zoom in
await page.mouse.move(640, 400);
for (let i = 0; i < 8; i++) {
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(150);
}
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/closeup-1-before.png' });

// Apply PBR via skin picker
await page.locator('#select-tool-btn').click();
await page.waitForTimeout(500);
await page.mouse.dblclick(640, 400);
await page.waitForTimeout(1000);

if (await page.locator('#skin-picker').isVisible()) {
  await page.locator('#skin-select').selectOption('rusty-and-warped');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/closeup-2-after-pbr.png' });

  // Debug view
  await page.keyboard.press('d');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/closeup-3-debug.png' });
} else {
  console.log('Picker not visible');
  await page.screenshot({ path: '/tmp/closeup-2-no-picker.png' });
}

await browser.close();
