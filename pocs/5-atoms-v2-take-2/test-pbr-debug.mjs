import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

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

// Before PBR — debug view
await page.keyboard.press('d');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/pbr-1-before-debug.png' });
await page.keyboard.press('d');
await page.waitForTimeout(200);

// Select tool + click Walker atom to open picker
await page.locator('#select-tool-btn').click();
await page.waitForTimeout(500);

// Click on walker atoms — try a single click first (select), then show picker
await page.mouse.click(500, 400);
await page.waitForTimeout(500);

// The picker shows on mouseup after a short drag detection
// Let's try double-click
await page.mouse.dblclick(500, 380);
await page.waitForTimeout(1000);

const pickerVisible = await page.locator('#skin-picker').isVisible();
console.log('Picker visible after dblclick:', pickerVisible);

if (!pickerVisible) {
  // Try clicking directly on an atom mesh
  await page.mouse.click(480, 350);
  await page.waitForTimeout(300);
  await page.mouse.click(480, 350);  // mouseup triggers picker
  await page.waitForTimeout(1000);
  console.log('Picker visible retry:', await page.locator('#skin-picker').isVisible());
}

if (await page.locator('#skin-picker').isVisible()) {
  await page.screenshot({ path: '/tmp/pbr-2-picker-open.png' });

  // Select rusty-and-warped
  await page.locator('#skin-select').selectOption('rusty-and-warped');
  await page.waitForTimeout(2000);

  // Normal view after PBR
  await page.screenshot({ path: '/tmp/pbr-3-after-normal.png' });

  // Debug view after PBR
  await page.keyboard.press('d');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/pbr-4-after-debug.png' });
} else {
  console.log('Could not open skin picker');
  await page.screenshot({ path: '/tmp/pbr-2-no-picker.png' });
}

console.log('\n--- Logs ---');
for (const l of logs.slice(-20)) console.log(l);

await browser.close();
