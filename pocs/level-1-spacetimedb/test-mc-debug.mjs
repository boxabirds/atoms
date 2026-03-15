import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', msg => {
  const text = msg.text();
  console.log(`[${msg.type()}] ${text}`);
  if (msg.type() === 'error') errors.push(text);
});

page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
await page.goto('http://localhost:8000', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Drop Oscillator
const osc = page.locator('.machine-card', { hasText: 'Oscillator' });
let box = await osc.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(640, 380, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(2000);

// Set skin to 80%
const slider = page.locator('#skin-slider');
await slider.fill('80');
await slider.dispatchEvent('input');
await page.waitForTimeout(1000);

// Debug MC state
const debug = await page.evaluate(() => {
  const t = window.__test;
  if (!t) return 'no __test';
  const entries = [...t.moleculeSkins.values()];
  return entries.map(e => ({
    key: e.key,
    skinType: e.skinType,
    hasMC: !!e.mc,
    mcVisible: e.mc?.visible,
    mcInScene: e.mc?.parent?.type,
    mcPos: e.mc ? [e.mc.position.x, e.mc.position.y, e.mc.position.z].map(v => +v.toFixed(3)) : null,
    mcScale: e.mc ? [e.mc.scale.x, e.mc.scale.y, e.mc.scale.z].map(v => +v.toFixed(3)) : null,
    mcHasGeom: !!e.mc?.geometry,
    mcVertexCount: e.mc?.geometry?.getAttribute('position')?.count ?? 0,
    mcCount: e.mc?.count ?? 0,
    mcSize: e.mc?.size ?? 0,
    mcIsolation: e.mc?.isolation,
    atomCount: e.atomIds?.length,
    atomPositions: e.atomIds?.map(id => {
      const atoms = t.atoms;
      const a = atoms.find(a => a.id === id);
      return a ? [+a.group.position.x.toFixed(3), +a.group.position.y.toFixed(3), +a.group.position.z.toFixed(3)] : null;
    }),
  }));
});
console.log('MC Debug:', JSON.stringify(debug, null, 2));

await page.screenshot({ path: '/tmp/mc-debug.png' });
console.log('Errors:', errors.length ? errors.join('; ') : 'none');
await browser.close();
