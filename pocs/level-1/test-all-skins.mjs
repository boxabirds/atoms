import { chromium } from 'playwright';

const SKINS = [
  'none',
  'rusty-and-warped',
  'lumpy-translucent-gold',
  'aquamarine-glass',
  'flickering-flame',
  'rainbow-marshmallow',
  'william-slime',
  'xmas-decorations',
];

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

await page.goto('http://localhost:8000', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Drop Oscillator at center
const osc = page.locator('.machine-card', { hasText: 'Oscillator' });
let box = await osc.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(640, 380, { steps: 15 });
await page.mouse.up();
await page.waitForTimeout(1500);

// Set skin to 80%
const slider = page.locator('#skin-slider');
await slider.fill('80');
await slider.dispatchEvent('input');
await page.waitForTimeout(500);

// Freeze for consistent screenshots
await page.keyboard.press('Space');
await page.waitForTimeout(500);

// Screenshot flat first
await page.screenshot({ path: '/tmp/allskins-0-none.png' });

// Apply each skin via the exposed test API
for (let i = 1; i < SKINS.length; i++) {
  const skinName = SKINS[i];

  const result = await page.evaluate(async (name) => {
    const t = window.__test;
    if (!t) return 'no __test';

    // Find the first molecule skin entry
    const entries = [...t.moleculeSkins.values()];
    if (entries.length === 0) return 'no skin entries';
    const entry = entries[0];

    // Load textures if needed
    const reg = t.SKIN_REGISTRY.find(s => s.name === name);
    if (reg && reg.type === 'json') {
      await t.loadSkinFromJSON(reg.name, reg.path);
    }

    // Ensure displacement geometry
    await t.ensureDisplacementData(name);

    // Set skin type and recreate material + geometry
    entry.skinType = name;
    const skinCol = t.getSkinColor(entry.atomIds);
    const newMat = t.createSkinMaterial(name, skinCol.color);
    if (entry.material) entry.material.dispose();
    entry.material = newMat;
    const geom = t.getSkinGeometry(name);
    for (const mesh of (entry.meshes || [])) {
      mesh.geometry = geom;
      mesh.material = newMat;
    }

    return 'ok';
  }, skinName);

  if (result !== 'ok') {
    console.log(`${skinName}: ${result}`);
  }

  await page.waitForTimeout(2000);
  await page.screenshot({ path: `/tmp/allskins-${i}-${skinName}.png` });
  console.log(`  ${i}. ${skinName} — captured`);
}

console.log('Errors:', errors.length ? errors.join('; ') : 'none');
await browser.close();
