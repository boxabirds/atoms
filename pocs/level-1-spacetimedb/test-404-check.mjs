import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

// Track ALL failed network requests
page.on('response', response => {
  if (response.status() >= 400) {
    console.log(`NETWORK [${response.status()}] ${response.url()}`);
  }
});

page.on('requestfailed', req => {
  console.log(`FAILED: ${req.url()} - ${req.failure()?.errorText}`);
});

page.on('console', msg => {
  if (msg.type() === 'error') {
    // Try to get the URL from the message args
    console.log(`CONSOLE ERROR: ${msg.text()}`);
    console.log(`  location: ${msg.location()?.url}:${msg.location()?.lineNumber}`);
  }
});

await page.goto('http://localhost:8000', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Drop a walker to trigger texture loading
const walker = page.locator('.machine-card', { hasText: 'Walker' });
const box = await walker.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(500, 400, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(2000);

await browser.close();
