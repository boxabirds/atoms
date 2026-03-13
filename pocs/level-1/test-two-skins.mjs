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

// Drop Walker at left
const walker = page.locator('.machine-card', { hasText: 'Walker' });
let box = await walker.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(400, 400, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(1500);

// Drop Tracker at right
const tracker = page.locator('.machine-card', { hasText: 'Tracker' });
box = await tracker.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(800, 400, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(1500);

// Max skin opacity
const slider = page.locator('#skin-slider');
await slider.fill('100');
await slider.dispatchEvent('input');
await page.waitForTimeout(500);

await page.screenshot({ path: '/tmp/twoskins-1-flat.png' });

// Apply rusty-and-warped to Walker
await page.locator('#select-tool-btn').click();
await page.waitForTimeout(300);
await page.mouse.dblclick(400, 400);
await page.waitForTimeout(1000);

if (await page.locator('#skin-picker').isVisible()) {
  await page.locator('#skin-select').selectOption('rusty-and-warped');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/twoskins-2-walker-rusty.png' });
} else {
  console.log('Could not open picker for Walker');
  await page.screenshot({ path: '/tmp/twoskins-2-nopicker.png' });
}

// Apply translucent-wobbly-gold to Tracker
await page.mouse.dblclick(800, 400);
await page.waitForTimeout(1000);

if (await page.locator('#skin-picker').isVisible()) {
  await page.locator('#skin-select').selectOption('translucent-wobbly-gold');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/twoskins-3-both-skins.png' });
} else {
  console.log('Could not open picker for Tracker');
  await page.screenshot({ path: '/tmp/twoskins-3-nopicker.png' });
}

// Debug view with both skins
await page.keyboard.press('d');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/twoskins-4-debug.png' });

console.log('Errors:', errors.length ? errors.join('; ') : 'none');
await browser.close();
