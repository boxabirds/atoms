# SDF Raymarching Skin System — Experiment Results (Discarded)

**Date:** 2026-03-12
**Goal:** Replace CPU convex hull skin system (~20fps skin updates) with GPU SDF raymarching for 60fps skins.

---

## Approach

Fullscreen post-processing pass that raymarches a signed distance field (smooth union of spheres) to render blobby skins around connected atom groups. Two-pass compositing: scene renders to a render target, then a fullscreen quad raymarches the SDF field and composites over the scene.

## What Worked

- **PostProcessing + `pass()` from Three.js r173 TSL** — correct way to do multi-pass rendering with the WebGPU backend. Manual `RenderTarget` + `QuadMesh` doesn't bind textures correctly.
- **Explicit camera uniforms** — TSL built-ins (`cameraPosition`, `cameraProjectionMatrixInverse`, `cameraViewMatrix`) reference PostProcessing's internal orthographic camera, not the scene camera. Must pass scene camera data as explicit `uniform()` values.
- **WebGPU NDC Y-flip** — `screenUV.y` runs top-to-bottom in WebGPU. NDC reconstruction needs: `float(1.0).sub(quadUV.y).mul(2.0).sub(1.0)` for the Y component.
- **`camera.updateMatrixWorld(true)` before copying uniforms** — without this, the skin lags behind the scene by one frame because PostProcessing's scene pass calls `updateMatrixWorld` internally.
- **`uniformArray()` for data passing** — `StorageBufferAttribute` + `storage()` nodes don't re-upload on `needsUpdate`. `DataTexture` sampling fails inside dynamic loops (WGSL `textureSample` forbidden in non-uniform control flow, and `.level(0)` for `textureSampleLevel` didn't work in TSL r173). `uniformArray` with constant indices (unrolled JS loop) was the only reliable data path.
- **SDF math** — smooth union (Inigo Quilez polynomial), central-difference normals, and 3-point Blinn-Phong shading all work correctly. The visual result (blobby organic skin) looked good.

## What Failed

### Dynamic loop indexing in TSL

`uniformArray.element(loopVariable)` inside TSL `Loop()` silently produces zeros or wrong results. Also `storage().element(loopVariable)` and `texture().sample(dynamicUV)` inside loops. Only constant indices (`int(literal)`) work reliably. This forced unrolling the atom loop in JS, which:

1. Embeds every atom read as a separate shader instruction
2. Multiplies by march steps (32) × normal evaluations (6) × all pixels
3. Caps practical atom count at ~32 before the shader becomes too heavy

### Fundamental scaling problem

SDF raymarching evaluates **every atom for every pixel for every march step**. Computational cost is `O(pixels × atoms × steps)`. At 1080p with 32 atoms and 32 steps:

- March: 32 steps × 32 atoms = 1,024 sphere evals per pixel
- Normals: 6 × 32 = 192 sphere evals per pixel (on hit)
- Total: ~1,216 evals × 2M pixels = ~2.4 billion sphere evaluations per frame

This fundamentally cannot scale to thousands of atoms. The 200K shape benchmark uses instanced rendering where each shape is independent — the opposite of SDF where every pixel depends on every atom.

### Edge artifacts

Black comic-strip-style edges appear at smooth union creases between spheres. Caused by the ray grazing the thin crease where the SDF gradient is steep — the march overshoots, then escapes. Fixable with larger epsilon or edge softening, but not addressed before discarding.

## Recommendation: Compute Shader → 3D Voxel Texture

Decouple atom evaluation from per-pixel cost:

1. **Compute pass:** Evaluate SDF from all atoms into a 3D texture (e.g. 64³ = 262K voxels). Compute shaders support proper dynamic loops with storage buffers. Cost: `O(voxels × atoms)` — independent of screen resolution.
2. **Fragment pass:** Raymarch the 3D texture. Each step is one texture sample, regardless of atom count. Cost: `O(pixels × steps)` — independent of atom count.

This separates the two scaling dimensions and should support thousands of atoms at 60fps.

### Salvageable from this experiment

- `PostProcessing` + `pass()` pipeline setup
- Camera uniform pattern (explicit uniforms, Y-flip, `updateMatrixWorld` sync)
- Ray reconstruction math
- Smooth union SDF formula
- 3-point lighting shader (`sdfShade`)
- `uploadAtomData()` molecule discovery + data packing logic
- Skin picker UI (`moleculeSkins` Map, `findSkinForAtom`, `showSkinPicker`)

### Not salvageable

- `uniformArray` with unrolled loops for atom data (doesn't scale)
- `StorageBufferAttribute` / `DataTexture` data paths (broken in TSL fragment shaders)
- `sceneSDF` / `sdfNormal` as separate `Fn()` nodes (can't access uniform arrays across Fn scope boundaries)
