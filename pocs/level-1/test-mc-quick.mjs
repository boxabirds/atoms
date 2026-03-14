import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', msg => console.log(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => console.log('CRASH:', err.message));
await page.goto('http://localhost:8000', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
// Drop machine
const osc = page.locator('.machine-card', { hasText: 'Oscillator' });
let box = await osc.boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
  await page.mouse.down();
  await page.mouse.move(640, 380, { steps: 15 });
  await page.mouse.up();
}
await page.waitForTimeout(5000);
await page.screenshot({ path: '/tmp/mc-quick.png' });
console.log('Done');
await browser.close();
