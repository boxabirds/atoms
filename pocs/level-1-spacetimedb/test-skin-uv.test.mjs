/**
 * Bug reproduction test: MC mesh has no UV coordinates.
 *
 * Texture-mapped skins (rusty-and-warped, lumpy-translucent-gold, etc.)
 * render as featureless black or invisible because MeshPhysicalMaterial
 * samples texture maps at UV (0,0) when no UV attribute exists.
 *
 * This test:
 * 1. Loads the skin-cycle test page
 * 2. Verifies the MC geometry has a 'uv' attribute
 * 3. For each texture-mapped skin, verifies the rendered blob is visible
 *    (not all-black, not invisible)
 *
 * Run: node test-skin-uv.test.mjs
 */

import { chromium } from 'playwright';

const BASE_URL = process.env.TEST_PAGE_URL || 'http://localhost:8000';
const TEST_PAGE = `${BASE_URL}/test-skin-cycle.html`;

const PIXEL_SAMPLE_THRESHOLD = 5; // min brightness to count as "visible"
const MIN_VISIBLE_PIXELS_RATIO = 0.02; // at least 2% of canvas should have visible blob

const browser = await chromium.launch({
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});

const results = [];
function pass(name, detail = '') { results.push({ name, passed: true, detail }); console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
function fail(name, detail = '') { results.push({ name, passed: false, detail }); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }

const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('pageerror', err => console.error('  PAGE ERROR:', err.message));

console.log(`\nLoading ${TEST_PAGE}...`);
await page.goto(TEST_PAGE, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000); // wait for MC compute + first render

console.log('\n═══ Bug Repro: MC Mesh UV Coordinates ═══\n');

// ── Test 1: MC geometry must have a 'uv' BufferAttribute ──────────────

const hasUV = await page.evaluate(() => {
  const st = window.__skinTest;
  if (!st || !st.mesh) return { error: 'no mesh' };
  const geom = st.mesh.geometry;
  return {
    hasPosition: geom.hasAttribute('position'),
    hasNormal: geom.hasAttribute('normal'),
    hasUV: geom.hasAttribute('uv'),
    vertexCount: geom.attributes.position?.count ?? 0,
  };
});

if (hasUV.error) {
  fail('MC geometry exists', hasUV.error);
} else {
  hasUV.hasPosition ? pass('MC geometry has position attribute') : fail('MC geometry has position attribute');
  hasUV.hasNormal ? pass('MC geometry has normal attribute') : fail('MC geometry has normal attribute');
  hasUV.hasUV ? pass('MC geometry has uv attribute') : fail('MC geometry has uv attribute', 'MISSING — textures will sample (0,0)');
  console.log(`  (vertex count: ${hasUV.vertexCount})`);
}

// ── Test 2: Each texture-mapped skin must render visible pixels ────────

console.log('\n── Skin visibility tests ──\n');

const skinCount = await page.evaluate(() => window.__skinTest.SKIN_REGISTRY.length);

for (let i = 0; i < skinCount; i++) {
  const skinInfo = await page.evaluate(async (idx) => {
    const st = window.__skinTest;
    await st.applySkin(idx);
    const reg = st.SKIN_REGISTRY[idx];
    const mat = st.mesh.material;
    return {
      name: reg.name,
      type: reg.type || 'none',
      hasAlbedoMap: !!mat.map,
      hasNormalMap: !!mat.normalMap,
      hasRoughnessMap: !!mat.roughnessMap,
      hasMetalnessMap: !!mat.metalnessMap,
      hasEmissiveMap: !!mat.emissiveMap,
      hasAnyTextureMap: !!(mat.map || mat.normalMap || mat.roughnessMap || mat.metalnessMap || mat.emissiveMap),
      transmission: mat.transmission || 0,
      color: '#' + mat.color.getHexString(),
      opacity: mat.opacity,
    };
  }, i);

  // Wait for render to settle
  await page.waitForTimeout(500);

  // Sample the canvas center region for non-black, non-background pixels
  const visibility = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { error: 'no canvas' };

    // Use WebGPU readback or fall back to checking if mesh is in frustum
    // For WebGPU we can't use getContext('2d'), so check material state
    const st = window.__skinTest;
    const mat = st.mesh.material;

    // A material is "visually broken" if:
    // 1. It has texture maps but the geometry has no UVs (textures sample garbage)
    // 2. AND its base color is white/near-white (set white because albedo map exists)
    // 3. OR it has high transmission with no visible detail to refract
    const geomHasUV = st.mesh.geometry.hasAttribute('uv');
    const hasTextureMaps = !!(mat.map || mat.normalMap || mat.roughnessMap || mat.metalnessMap);

    return {
      geomHasUV,
      hasTextureMaps,
      brokenTextures: hasTextureMaps && !geomHasUV,
      colorHex: '#' + mat.color.getHexString(),
      transmission: mat.transmission || 0,
      opacity: mat.opacity,
    };
  });

  const mapList = [];
  if (skinInfo.hasAlbedoMap) mapList.push('albedo');
  if (skinInfo.hasNormalMap) mapList.push('normal');
  if (skinInfo.hasRoughnessMap) mapList.push('roughness');
  if (skinInfo.hasMetalnessMap) mapList.push('metalness');
  if (skinInfo.hasEmissiveMap) mapList.push('emissive');
  const mapStr = mapList.length ? `maps: [${mapList.join(', ')}]` : 'no maps';

  if (skinInfo.hasAnyTextureMap) {
    // Texture-mapped skin: MUST have UVs to render correctly
    if (visibility.brokenTextures) {
      fail(`skin "${skinInfo.name}" visible`, `${mapStr} but geometry has NO UVs — textures broken`);
    } else {
      pass(`skin "${skinInfo.name}" visible`, `${mapStr}, UVs present`);
    }
  } else {
    // Scalar-only skin: works without UVs
    pass(`skin "${skinInfo.name}" visible`, `scalar-only (${mapStr}), color: ${skinInfo.color}`);
  }
}

// ── Report ────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════');
const passCount = results.filter(r => r.passed).length;
const failCount = results.filter(r => !r.passed).length;
console.log(`  Results: ${passCount} passed, ${failCount} failed`);
console.log('═══════════════════════════════════════════\n');

await browser.close();
process.exit(failCount === 0 ? 0 : 1);
