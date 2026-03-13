import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const logs = [];
page.on('console', msg => {
  const txt = `[${msg.type()}] ${msg.text()}`;
  logs.push(txt);
  if (msg.type() === 'error') errors.push(msg.text());
  if (msg.type() === 'warning' && msg.text().includes('WebGPU')) errors.push(msg.text());
});
page.on('pageerror', err => { errors.push('PAGE ERROR: ' + err.message); });

await page.goto('http://localhost:8000', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);
await page.screenshot({ path: '/tmp/dbg-1-empty.png' });

// Drop Walker
const walker = page.locator('.machine-card', { hasText: 'Walker' });
const box = await walker.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(500, 400, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/dbg-2-walker.png' });

// Select tool + double-click on walker to open skin picker
await page.locator('#select-tool-btn').click();
await page.waitForTimeout(500);
await page.mouse.dblclick(500, 400);
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/dbg-3-picker.png' });

// Apply rusty texture
const pickerVisible = await page.locator('#skin-picker').isVisible();
console.log('Skin picker visible:', pickerVisible);
if (pickerVisible) {
  await page.locator('#skin-select').selectOption('rusty-and-warped');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/dbg-4-pbr-applied.png' });

  // Zoom in on walker for close-up of texture
  await page.mouse.move(500, 400);
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/dbg-5-pbr-closeup.png' });
} else {
  console.log('Skin picker NOT visible — trying offset click');
  await page.mouse.dblclick(480, 420);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/tmp/dbg-4-retry.png' });
}

console.log('\n--- Console logs ---');
for (const l of logs) console.log(l);
console.log('\n--- Errors ---');
console.log(errors.length ? errors.join('\n') : 'none');

await browser.close();
