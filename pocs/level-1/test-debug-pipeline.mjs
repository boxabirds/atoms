import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => logs.push('PAGE ERROR: ' + err.message));

await page.goto('http://localhost:8000', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Drop Walker
const walker = page.locator('.machine-card', { hasText: 'Walker' });
const box = await walker.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(500, 400, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(2000);

// Normal view
await page.screenshot({ path: '/tmp/pipe-1-normal.png' });

// Toggle pipeline debugger
await page.keyboard.press('d');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/pipe-2-debug.png' });

// Drop a second machine for color comparison
const tracker = page.locator('.machine-card', { hasText: 'Tracker' });
const tbox = await tracker.boundingBox();
await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2);
await page.mouse.down();
await page.mouse.move(700, 350, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/pipe-3-two-debug.png' });

// Toggle back to normal view
await page.keyboard.press('d');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/pipe-4-two-normal.png' });

console.log('\n--- Console logs ---');
for (const l of logs) console.log(l);

await browser.close();
console.log('Done — screenshots in /tmp/pipe-*.png');
