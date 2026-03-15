# Marching Cubes with WebGPU + Three.js

Zero-copy GPU compute → GPU render implementation guide. All isosurface extraction runs on the GPU via WebGPU compute shaders. The CPU never touches vertex data.

---

## Architecture Overview

The implementation splits into **three compute passes** followed by a **render pass**:

1. **Classification** — For each voxel, sample the scalar field at all 8 corners, build the case index (0–255), and look up the triangle count from the edge table.
2. **Prefix sum (scan)** — Compute an exclusive prefix sum over triangle counts so each voxel knows where in the output vertex buffer to write its triangles.
3. **Vertex generation** — Each voxel reads its case, looks up the triangulation from the tri-table, interpolates vertex positions along edges, and writes them to the output buffer at its computed offset. Also writes the final vertex count into an indirect draw buffer.
4. **Render** — Draw the output vertex buffer using `drawIndirect` so the CPU never reads back the count.

---

## Three.js Context

Three.js's existing `MarchingCubes` addon (from `three/examples/jsm/objects/MarchingCubes`) runs entirely on the CPU. It's JavaScript doing the isosurface extraction, then handing geometry to whichever renderer (WebGL or WebGPU) for drawing. It is not suitable for high-performance real-time use.

Three.js's `WebGPURenderer` does expose compute via TSL (Three Shading Language) nodes, but TSL's compute support is still maturing — prefix sum, indirect dispatch, and complex buffer bindings are friction points.

**The recommended approach**: raw WebGPU compute for marching cubes, composited with Three.js's render output. You own the compute pipelines and the MC render pass entirely. Three.js handles the rest of the scene.

---

## Getting the WebGPU Device from Three.js

```js
import { WebGPURenderer } from 'three/webgpu';

const renderer = new WebGPURenderer({ antialias: true });
await renderer.init();

const device = renderer.backend.device;
```

---

## Lookup Tables as Storage Buffers

The classic 256-entry edge table and 256×16 tri-table are uploaded as `GPUBuffer`s with `STORAGE` usage:

```wgsl
@group(0) @binding(0) var<storage, read> triTable: array<i32>;   // 256 * 16
@group(0) @binding(1) var<storage, read> edgeTable: array<u32>;  // 256
```

These are static — upload once at init.

---

## Scalar Field Sampling

Two options:

**3D texture** (if the field is voxelised):

```wgsl
@group(0) @binding(2) var volumeTex: texture_3d<f32>;
@group(0) @binding(3) var volumeSampler: sampler;
```

**Analytical SDF** (evaluated inline in the shader — no texture needed):

```wgsl
fn sampleField(pos: vec3<f32>) -> f32 {
    // e.g. metaballs, noise field, signed distance function
    return length(pos - centre) - radius;
}
```

---

## Compute Pass 1: Classification

Dispatch one workgroup per chunk of voxels. Each invocation handles one voxel.

```wgsl
@compute @workgroup_size(4, 4, 4)
fn classify(@builtin(global_invocation_id) id: vec3<u32>) {
    let gridPos = id;

    // Sample 8 corners
    var cubeVals: array<f32, 8>;
    for (var i = 0u; i < 8u; i++) {
        cubeVals[i] = sampleField(gridPos + cornerOffsets[i]);
    }

    // Build case index
    var caseIndex = 0u;
    for (var i = 0u; i < 8u; i++) {
        if (cubeVals[i] < isoLevel) {
            caseIndex |= (1u << i);
        }
    }

    // Count triangles from triTable (-1 terminated, every 3 edges = 1 tri)
    var numTris = 0u;
    for (var i = 0u; i < 16u; i += 3u) {
        if (triTable[caseIndex * 16u + i] < 0) { break; }
        numTris++;
    }

    let idx = flatIndex(gridPos);
    triCounts[idx] = numTris;
    caseIndices[idx] = caseIndex;
}
```

**Workgroup size**: `(4, 4, 4)` = 64 threads per workgroup, maps naturally to the 3D grid with good occupancy.

---

## Compute Pass 2: Prefix Sum

This is the trickiest part on the GPU. Use a **Blelloch-style work-efficient parallel scan** (up-sweep / down-sweep):

- Each workgroup scans its local segment.
- A second dispatch scans the per-workgroup block sums.
- A third dispatch propagates the block sums back down.

For large grids this requires multiple dispatches. `@workgroup_size(256)` is typical for 1D scan operations.

The prefix sum output tells each voxel the **offset** into the vertex buffer where it should write its triangles.

---

## Compute Pass 3: Vertex Generation

Each invocation reads its voxel's case, looks up the tri-table, interpolates along edges, and writes vertices + normals to the output buffer. Also atomically increments the vertex count in the indirect draw buffer.

```wgsl
@compute @workgroup_size(64)
fn generateVertices(@builtin(global_invocation_id) id: vec3<u32>) {
    let voxelIdx = id.x;
    let caseIndex = caseIndices[voxelIdx];
    let offset = triOffsets[voxelIdx] * 3u; // 3 verts per tri

    for (var i = 0u; i < 16u; i += 3u) {
        let e0 = triTable[caseIndex * 16u + i];
        if (e0 < 0) { break; }
        let e1 = triTable[caseIndex * 16u + i + 1u];
        let e2 = triTable[caseIndex * 16u + i + 2u];

        let v0 = interpolateEdge(voxelIdx, u32(e0));
        let v1 = interpolateEdge(voxelIdx, u32(e1));
        let v2 = interpolateEdge(voxelIdx, u32(e2));

        let base = offset + i;
        outputVerts[base]     = v0;
        outputVerts[base + 1] = v1;
        outputVerts[base + 2] = v2;
    }
}
```

### Edge Interpolation

Maps each of the 12 edges to its two corner indices, samples the field at both, and lerps:

```wgsl
fn interpolateEdge(voxelIdx: u32, edgeNum: u32) -> vec3<f32> {
    let c0 = edgeToCorners[edgeNum][0];
    let c1 = edgeToCorners[edgeNum][1];
    let p0 = cornerPosition(voxelIdx, c0);
    let p1 = cornerPosition(voxelIdx, c1);
    let v0 = fieldAt(p0);
    let v1 = fieldAt(p1);
    let t = (isoLevel - v0) / (v1 - v0);
    return mix(p0, p1, t);
}
```

---

## Shared Buffers: Zero-Copy Compute → Render

The critical piece. A single `GPUBuffer` is written by compute and read by the render pass as a vertex buffer:

```js
// Worst case: gridSize³ × 5 tris × 3 verts × (3 floats pos + 3 floats normal) × 4 bytes
const maxTris = gridSize * gridSize * gridSize * 5;

const vertexBuffer = device.createBuffer({
    size: maxTris * 3 * 6 * 4,  // pos + normal per vert
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    label: 'marching-cubes-verts',
});

// Indirect draw buffer — compute writes the vertex count here
const indirectBuffer = device.createBuffer({
    size: 16,  // vertexCount, instanceCount, firstVertex, firstInstance
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    label: 'draw-indirect',
});
```

Key usage flags:
- `STORAGE` — writable from compute
- `VERTEX` — readable as vertex buffer in render pass
- `INDIRECT` — usable with `drawIndirect()`

---

## Orchestrating the Compute Passes

```js
// Reset indirect buffer each frame
device.queue.writeBuffer(indirectBuffer, 0, new Uint32Array([0, 1, 0, 0]));

const commandEncoder = device.createCommandEncoder();

// Pass 1: classify
const classifyPass = commandEncoder.beginComputePass();
classifyPass.setPipeline(classifyPipeline);
classifyPass.setBindGroup(0, classifyBindGroup);
classifyPass.dispatchWorkgroups(
    Math.ceil(gridSize / 4),
    Math.ceil(gridSize / 4),
    Math.ceil(gridSize / 4)
);
classifyPass.end();

// Pass 2: prefix sum (multiple dispatches for large grids)
// ... up-sweep, scan block sums, down-sweep ...

// Pass 3: generate vertices, write count to indirect buffer
const genPass = commandEncoder.beginComputePass();
genPass.setPipeline(generatePipeline);
genPass.setBindGroup(0, generateBindGroup);
genPass.dispatchWorkgroups(Math.ceil(totalVoxels / 64));
genPass.end();

device.queue.submit([commandEncoder.finish()]);
```

---

## Rendering: Dual Render Pass Compositing

The recommended approach is to let Three.js render the scene first, then composite the marching cubes mesh on top using your own render pass with `loadOp: 'load'` (preserving Three.js output).

### Camera Matrix Sync

Extract view/projection matrices from Three.js's camera and upload to your own uniform buffer:

```js
camera.updateMatrixWorld();
const viewMatrix = camera.matrixWorldInverse;
const projMatrix = camera.projectionMatrix;
const mvp = new THREE.Matrix4().multiplyMatrices(projMatrix, viewMatrix);
device.queue.writeBuffer(cameraUniformBuffer, 0, new Float32Array(mvp.elements));
```

### The MC Render Pass

```js
const renderPassDescriptor = {
    colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: 'load',   // preserve Three.js output
        storeOp: 'store',
    }],
    depthStencilAttachment: {
        view: depthTexture.createView(),
        depthLoadOp: 'load',
        depthStoreOp: 'store',
    }
};

const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
passEncoder.setPipeline(mcRenderPipeline);
passEncoder.setBindGroup(0, cameraBindGroup);
passEncoder.setVertexBuffer(0, vertexBuffer);
passEncoder.drawIndirect(indirectBuffer, 0);
passEncoder.end();
```

`drawIndirect` reads the vertex count from the GPU buffer directly — no CPU readback.

### Depth Buffer Sharing

This is the one thing to be careful about. You need Three.js's depth texture so your MC mesh depth-tests correctly against the rest of the scene. Either:

- Access it through `renderer.backend` internals
- Create a shared depth texture and configure both pipelines to use it

---

## Normals

Two approaches:

**Gradient-based (smooth normals):** Sample the scalar field at ±epsilon around each vertex position and compute the central difference. More common for marching cubes since the field is available.

```wgsl
fn computeNormal(pos: vec3<f32>) -> vec3<f32> {
    let eps = 0.01;
    return normalize(vec3<f32>(
        sampleField(pos + vec3(eps, 0, 0)) - sampleField(pos - vec3(eps, 0, 0)),
        sampleField(pos + vec3(0, eps, 0)) - sampleField(pos - vec3(0, eps, 0)),
        sampleField(pos + vec3(0, 0, eps)) - sampleField(pos - vec3(0, 0, eps))
    ));
}
```

**Face normals:** Cross product of triangle edges. Cheaper but faceted.

---

## Performance Notes

- **Dynamic fields** (metaballs, fluid sim): re-run all three compute passes each frame.
- **Static fields**: cache the output vertex buffer — compute once, render many.
- **Over-allocation**: the vertex buffer is sized for worst case (5 tris per voxel). `drawIndirect` ensures you only render what was generated.
- **Workgroup sizing**: `(4,4,4)` for 3D classification/generation passes, `(256)` for 1D prefix sum.

---

## Why Not the Other Approaches

| Approach | Problem |
|----------|---------|
| Three.js `MarchingCubes` addon | CPU-side extraction, main thread bottleneck |
| TSL compute nodes | Immature, poor support for prefix sum / indirect dispatch / complex bindings |
| Hacking buffers into Three.js geometry (`backend.get()`) | Fragile internals, no `drawIndirect` support, API not stable |

The dual render pass approach (Three.js renders scene → you render MC mesh on top) gives full control, zero-copy, `drawIndirect`, and no dependency on Three.js internals.
