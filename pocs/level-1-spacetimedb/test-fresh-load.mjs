import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', msg => {
  const t = msg.type();
  const txt = msg.text();
  if (t === 'error' || t === 'warn') errors.push(`[${t}] ${txt}`);
});

await page.goto('http://localhost:8000', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

// Screenshot fresh load — should show UI, ground plane, dark background
await page.screenshot({ path: '/tmp/fresh-1-empty.png' });

// Drop a Walker
const walker = page.locator('.machine-card', { hasText: 'Walker' });
const box = await walker.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(640, 400, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(3000);

// Screenshot with Walker — should see atom spheres AND skin overlay
await page.screenshot({ path: '/tmp/fresh-2-walker.png' });

// Set skin opacity to 0 — should see ONLY atom spheres, no skin
const slider = page.locator('#skin-slider');
await slider.fill('0');
await slider.dispatchEvent('input');
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/fresh-3-noskin.png' });

// Set skin opacity back to 50
await slider.fill('50');
await slider.dispatchEvent('input');
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/fresh-4-skin50.png' });

console.log('Errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
