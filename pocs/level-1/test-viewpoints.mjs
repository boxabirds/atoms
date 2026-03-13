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
await page.mouse.move(640, 400, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(2000);

// Freeze
await page.keyboard.press('Space');
await page.waitForTimeout(500);

// Set skin to 80%
const slider = page.locator('#skin-slider');
await slider.fill('80');
await slider.dispatchEvent('input');
await page.waitForTimeout(500);

// Screenshot from default view
await page.screenshot({ path: '/tmp/vp-1-default.png' });

// Orbit left (drag right-to-left with right button or middle button)
// OrbitControls: left-drag = rotate
async function orbit(startX, startY, endX, endY, steps = 20) {
  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: 'left' });
  for (let i = 1; i <= steps; i++) {
    const x = startX + (endX - startX) * (i / steps);
    const y = startY + (endY - startY) * (i / steps);
    await page.mouse.move(x, y);
    await page.waitForTimeout(30);
  }
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(500);
}

// Orbit: drag from right to left (rotate around Y)
await orbit(800, 300, 500, 300);
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/vp-2-rotated-left.png' });

// Orbit more
await orbit(700, 300, 400, 300);
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/vp-3-rotated-more.png' });

// Orbit up (drag down to look from above)
await orbit(640, 250, 640, 450);
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/vp-4-from-above.png' });

// Orbit to side view
await orbit(800, 400, 400, 400);
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/vp-5-side.png' });

// Now set skin to 0% to see atoms only for comparison
await slider.fill('0');
await slider.dispatchEvent('input');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/vp-6-noskin-same-angle.png' });

await browser.close();
