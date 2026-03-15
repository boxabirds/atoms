/**
 * GPU Compute Marching Cubes
 *
 * Runs the marching cubes isosurface algorithm entirely on the GPU via
 * WebGPU compute shaders. Returns static vertex data via async readback.
 * Zero per-frame buffer mutations — safe for WebGPURenderer.
 *
 * Architecture: 3 compute passes + readback
 *   1. Classify — sample metaball field at voxel corners, build case index
 *   2. Prefix Sum — exclusive scan of triangle counts (3-dispatch Blelloch)
 *   3. Generate — interpolate edge vertices, compute gradient normals
 *   4. Readback — mapAsync staging buffers to CPU
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const MC_GRID_SIZE = 32;
const MC_ISO_LEVEL = 0.3;
const MC_STRENGTH = 1.5;
const MC_INFLUENCE_RADIUS = 2.0;   // field drops to zero at this × atom radius
const MC_EPSILON = 0.0001;
const MC_NORMAL_EPSILON = 0.02;
const MC_PADDING_FACTOR = 3.0;
const MC_MAX_TRIS = 20000;
const SCAN_WORKGROUP_SIZE = 256;

// ─── Marching Cubes Lookup Tables ────────────────────────────────────────────

// Edge table: bitmask of which edges are intersected for each of the 256 cases
const EDGE_TABLE = new Uint32Array([
  0x0,0x109,0x203,0x30a,0x406,0x50f,0x605,0x70c,0x80c,0x905,0xa0f,0xb06,0xc0a,0xd03,0xe09,0xf00,
  0x190,0x99,0x393,0x29a,0x596,0x49f,0x795,0x69c,0x99c,0x895,0xb9f,0xa96,0xd9a,0xc93,0xf99,0xe90,
  0x230,0x339,0x33,0x13a,0x636,0x73f,0x435,0x53c,0xa3c,0xb35,0x83f,0x936,0xe3a,0xf33,0xc39,0xd30,
  0x3a0,0x2a9,0x1a3,0xaa,0x7a6,0x6af,0x5a5,0x4ac,0xbac,0xaa5,0x9af,0x8a6,0xfaa,0xea3,0xda9,0xca0,
  0x460,0x569,0x663,0x76a,0x66,0x16f,0x265,0x36c,0xc6c,0xd65,0xe6f,0xf66,0x86a,0x963,0xa69,0xb60,
  0x5f0,0x4f9,0x7f3,0x6fa,0x1f6,0xff,0x3f5,0x2fc,0xdfc,0xcf5,0xfff,0xef6,0x9fa,0x8f3,0xbf9,0xaf0,
  0x650,0x759,0x453,0x55a,0x256,0x35f,0x55,0x15c,0xe5c,0xf55,0xc5f,0xd56,0xa5a,0xb53,0x859,0x950,
  0x7c0,0x6c9,0x5c3,0x4ca,0x3c6,0x2cf,0x1c5,0xcc,0xfcc,0xec5,0xdcf,0xcc6,0xbca,0xac3,0x9c9,0x8c0,
  0x8c0,0x9c9,0xac3,0xbca,0xcc6,0xdcf,0xec5,0xfcc,0xcc,0x1c5,0x2cf,0x3c6,0x4ca,0x5c3,0x6c9,0x7c0,
  0x950,0x859,0xb53,0xa5a,0xd56,0xc5f,0xf55,0xe5c,0x15c,0x55,0x35f,0x256,0x55a,0x453,0x759,0x650,
  0xaf0,0xbf9,0x8f3,0x9fa,0xef6,0xfff,0xcf5,0xdfc,0x2fc,0x3f5,0xff,0x1f6,0x6fa,0x7f3,0x4f9,0x5f0,
  0xb60,0xa69,0x963,0x86a,0xf66,0xe6f,0xd65,0xc6c,0x36c,0x265,0x16f,0x66,0x76a,0x663,0x569,0x460,
  0xca0,0xda9,0xea3,0xfaa,0x8a6,0x9af,0xaa5,0xbac,0x4ac,0x5a5,0x6af,0x7a6,0xaa,0x1a3,0x2a9,0x3a0,
  0xd30,0xc39,0xf33,0xe3a,0x936,0x83f,0xb35,0xa3c,0x53c,0x435,0x73f,0x636,0x13a,0x33,0x339,0x230,
  0xe90,0xf99,0xc93,0xd9a,0xa96,0xb9f,0x895,0x99c,0x69c,0x795,0x49f,0x596,0x29a,0x393,0x99,0x190,
  0xf00,0xe09,0xd03,0xc0a,0xb06,0xa0f,0x905,0x80c,0x70c,0x605,0x50f,0x406,0x30a,0x203,0x109,0x0
]);

// Tri table: up to 5 triangles (15 edge indices, -1 terminated) per case
// Flattened 256×16 array
const TRI_TABLE = new Int32Array([
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,8,3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,1,9,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,8,3,9,8,1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,2,10,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,8,3,1,2,10,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  9,2,10,0,2,9,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  2,8,3,2,10,8,10,9,8,-1,-1,-1,-1,-1,-1,-1,
  3,11,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,11,2,8,11,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,9,0,2,3,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,11,2,1,9,11,9,8,11,-1,-1,-1,-1,-1,-1,-1,
  3,10,1,11,10,3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,10,1,0,8,10,8,11,10,-1,-1,-1,-1,-1,-1,-1,
  3,9,0,3,11,9,11,10,9,-1,-1,-1,-1,-1,-1,-1,
  9,8,10,10,8,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,7,8,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,3,0,7,3,4,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,1,9,8,4,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,1,9,4,7,1,7,3,1,-1,-1,-1,-1,-1,-1,-1,
  1,2,10,8,4,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  3,4,7,3,0,4,1,2,10,-1,-1,-1,-1,-1,-1,-1,
  9,2,10,9,0,2,8,4,7,-1,-1,-1,-1,-1,-1,-1,
  2,10,9,2,9,7,2,7,3,7,9,4,-1,-1,-1,-1,
  8,4,7,3,11,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  11,4,7,11,2,4,2,0,4,-1,-1,-1,-1,-1,-1,-1,
  9,0,1,8,4,7,2,3,11,-1,-1,-1,-1,-1,-1,-1,
  4,7,11,9,4,11,9,11,2,9,2,1,-1,-1,-1,-1,
  3,10,1,3,11,10,7,8,4,-1,-1,-1,-1,-1,-1,-1,
  1,11,10,1,4,11,1,0,4,7,11,4,-1,-1,-1,-1,
  4,7,8,9,0,11,9,11,10,11,0,3,-1,-1,-1,-1,
  4,7,11,4,11,9,9,11,10,-1,-1,-1,-1,-1,-1,-1,
  9,5,4,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  9,5,4,0,8,3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,5,4,1,5,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  8,5,4,8,3,5,3,1,5,-1,-1,-1,-1,-1,-1,-1,
  1,2,10,9,5,4,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  3,0,8,1,2,10,4,9,5,-1,-1,-1,-1,-1,-1,-1,
  5,2,10,5,4,2,4,0,2,-1,-1,-1,-1,-1,-1,-1,
  2,10,5,3,2,5,3,5,4,3,4,8,-1,-1,-1,-1,
  9,5,4,2,3,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,11,2,0,8,11,4,9,5,-1,-1,-1,-1,-1,-1,-1,
  0,5,4,0,1,5,2,3,11,-1,-1,-1,-1,-1,-1,-1,
  2,1,5,2,5,8,2,8,11,4,8,5,-1,-1,-1,-1,
  10,3,11,10,1,3,9,5,4,-1,-1,-1,-1,-1,-1,-1,
  4,9,5,0,8,1,8,10,1,8,11,10,-1,-1,-1,-1,
  5,4,0,5,0,11,5,11,10,11,0,3,-1,-1,-1,-1,
  5,4,8,5,8,10,10,8,11,-1,-1,-1,-1,-1,-1,-1,
  9,7,8,5,7,9,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  9,3,0,9,5,3,5,7,3,-1,-1,-1,-1,-1,-1,-1,
  0,7,8,0,1,7,1,5,7,-1,-1,-1,-1,-1,-1,-1,
  1,5,3,3,5,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  9,7,8,9,5,7,10,1,2,-1,-1,-1,-1,-1,-1,-1,
  10,1,2,9,5,0,5,3,0,5,7,3,-1,-1,-1,-1,
  8,0,2,8,2,5,8,5,7,10,5,2,-1,-1,-1,-1,
  2,10,5,2,5,3,3,5,7,-1,-1,-1,-1,-1,-1,-1,
  7,9,5,7,8,9,3,11,2,-1,-1,-1,-1,-1,-1,-1,
  9,5,7,9,7,2,9,2,0,2,7,11,-1,-1,-1,-1,
  2,3,11,0,1,8,1,7,8,1,5,7,-1,-1,-1,-1,
  11,2,1,11,1,7,7,1,5,-1,-1,-1,-1,-1,-1,-1,
  9,5,8,8,5,7,10,1,3,10,3,11,-1,-1,-1,-1,
  5,7,0,5,0,9,7,11,0,1,0,10,11,10,0,-1,
  11,10,0,11,0,3,10,5,0,8,0,7,5,7,0,-1,
  11,10,5,7,11,5,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  10,6,5,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,8,3,5,10,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  9,0,1,5,10,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,8,3,1,9,8,5,10,6,-1,-1,-1,-1,-1,-1,-1,
  1,6,5,2,6,1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,6,5,1,2,6,3,0,8,-1,-1,-1,-1,-1,-1,-1,
  9,6,5,9,0,6,0,2,6,-1,-1,-1,-1,-1,-1,-1,
  5,9,8,5,8,2,5,2,6,3,2,8,-1,-1,-1,-1,
  2,3,11,10,6,5,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  11,0,8,11,2,0,10,6,5,-1,-1,-1,-1,-1,-1,-1,
  0,1,9,2,3,11,5,10,6,-1,-1,-1,-1,-1,-1,-1,
  5,10,6,1,9,2,9,11,2,9,8,11,-1,-1,-1,-1,
  6,3,11,6,5,3,5,1,3,-1,-1,-1,-1,-1,-1,-1,
  0,8,11,0,11,5,0,5,1,5,11,6,-1,-1,-1,-1,
  3,11,6,0,3,6,0,6,5,0,5,9,-1,-1,-1,-1,
  6,5,9,6,9,11,11,9,8,-1,-1,-1,-1,-1,-1,-1,
  5,10,6,4,7,8,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,3,0,4,7,3,6,5,10,-1,-1,-1,-1,-1,-1,-1,
  1,9,0,5,10,6,8,4,7,-1,-1,-1,-1,-1,-1,-1,
  10,6,5,1,9,7,1,7,3,7,9,4,-1,-1,-1,-1,
  6,1,2,6,5,1,4,7,8,-1,-1,-1,-1,-1,-1,-1,
  1,2,5,5,2,6,3,0,4,3,4,7,-1,-1,-1,-1,
  8,4,7,9,0,5,0,6,5,0,2,6,-1,-1,-1,-1,
  7,3,9,7,9,4,3,2,9,5,9,6,2,6,9,-1,
  3,11,2,7,8,4,10,6,5,-1,-1,-1,-1,-1,-1,-1,
  5,10,6,4,7,2,4,2,0,2,7,11,-1,-1,-1,-1,
  0,1,9,4,7,8,2,3,11,5,10,6,-1,-1,-1,-1,
  9,2,1,9,11,2,9,4,11,7,11,4,5,10,6,-1,
  8,4,7,3,11,5,3,5,1,5,11,6,-1,-1,-1,-1,
  5,1,11,5,11,6,1,0,11,7,11,4,0,4,11,-1,
  0,5,9,0,6,5,0,3,6,11,6,3,8,4,7,-1,
  6,5,9,6,9,11,4,7,9,7,11,9,-1,-1,-1,-1,
  10,4,9,6,4,10,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,10,6,4,9,10,0,8,3,-1,-1,-1,-1,-1,-1,-1,
  10,0,1,10,6,0,6,4,0,-1,-1,-1,-1,-1,-1,-1,
  8,3,1,8,1,6,8,6,4,6,1,10,-1,-1,-1,-1,
  1,4,9,1,2,4,2,6,4,-1,-1,-1,-1,-1,-1,-1,
  3,0,8,1,2,9,2,4,9,2,6,4,-1,-1,-1,-1,
  0,2,4,4,2,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  8,3,2,8,2,4,4,2,6,-1,-1,-1,-1,-1,-1,-1,
  10,4,9,10,6,4,11,2,3,-1,-1,-1,-1,-1,-1,-1,
  0,8,2,2,8,11,4,9,10,4,10,6,-1,-1,-1,-1,
  3,11,2,0,1,6,0,6,4,6,1,10,-1,-1,-1,-1,
  6,4,1,6,1,10,4,8,1,2,1,11,8,11,1,-1,
  9,6,4,9,3,6,9,1,3,11,6,3,-1,-1,-1,-1,
  8,11,1,8,1,0,11,6,1,9,1,4,6,4,1,-1,
  3,11,6,3,6,0,0,6,4,-1,-1,-1,-1,-1,-1,-1,
  6,4,8,11,6,8,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  7,10,6,7,8,10,8,9,10,-1,-1,-1,-1,-1,-1,-1,
  0,7,3,0,10,7,0,9,10,6,7,10,-1,-1,-1,-1,
  10,6,7,1,10,7,1,7,8,1,8,0,-1,-1,-1,-1,
  10,6,7,10,7,1,1,7,3,-1,-1,-1,-1,-1,-1,-1,
  1,2,6,1,6,8,1,8,9,8,6,7,-1,-1,-1,-1,
  2,6,9,2,9,1,6,7,9,0,9,3,7,3,9,-1,
  7,8,0,7,0,6,6,0,2,-1,-1,-1,-1,-1,-1,-1,
  7,3,2,6,7,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  2,3,11,10,6,8,10,8,9,8,6,7,-1,-1,-1,-1,
  2,0,7,2,7,11,0,9,7,6,7,10,9,10,7,-1,
  1,8,0,1,7,8,1,10,7,6,7,10,2,3,11,-1,
  11,2,1,11,1,7,10,6,1,6,7,1,-1,-1,-1,-1,
  8,9,6,8,6,7,9,1,6,11,6,3,1,3,6,-1,
  0,9,1,11,6,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  7,8,0,7,0,6,3,11,0,11,6,0,-1,-1,-1,-1,
  7,11,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  7,6,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  3,0,8,11,7,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,1,9,11,7,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  8,1,9,8,3,1,11,7,6,-1,-1,-1,-1,-1,-1,-1,
  10,1,2,6,11,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,2,10,3,0,8,6,11,7,-1,-1,-1,-1,-1,-1,-1,
  2,9,0,2,10,9,6,11,7,-1,-1,-1,-1,-1,-1,-1,
  6,11,7,2,10,3,10,8,3,10,9,8,-1,-1,-1,-1,
  7,2,3,6,2,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  7,0,8,7,6,0,6,2,0,-1,-1,-1,-1,-1,-1,-1,
  2,7,6,2,3,7,0,1,9,-1,-1,-1,-1,-1,-1,-1,
  1,6,2,1,8,6,1,9,8,8,7,6,-1,-1,-1,-1,
  10,7,6,10,1,7,1,3,7,-1,-1,-1,-1,-1,-1,-1,
  10,7,6,1,7,10,1,8,7,1,0,8,-1,-1,-1,-1,
  0,3,7,0,7,10,0,10,9,6,10,7,-1,-1,-1,-1,
  7,6,10,7,10,8,8,10,9,-1,-1,-1,-1,-1,-1,-1,
  6,8,4,11,8,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  3,6,11,3,0,6,0,4,6,-1,-1,-1,-1,-1,-1,-1,
  8,6,11,8,4,6,9,0,1,-1,-1,-1,-1,-1,-1,-1,
  9,4,6,9,6,3,9,3,1,11,3,6,-1,-1,-1,-1,
  6,8,4,6,11,8,2,10,1,-1,-1,-1,-1,-1,-1,-1,
  1,2,10,3,0,11,0,6,11,0,4,6,-1,-1,-1,-1,
  4,11,8,4,6,11,0,2,9,2,10,9,-1,-1,-1,-1,
  10,9,3,10,3,2,9,4,3,11,3,6,4,6,3,-1,
  8,2,3,8,4,2,4,6,2,-1,-1,-1,-1,-1,-1,-1,
  0,4,2,4,6,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,9,0,2,3,4,2,4,6,4,3,8,-1,-1,-1,-1,
  1,9,4,1,4,2,2,4,6,-1,-1,-1,-1,-1,-1,-1,
  8,1,3,8,6,1,8,4,6,6,10,1,-1,-1,-1,-1,
  10,1,0,10,0,6,6,0,4,-1,-1,-1,-1,-1,-1,-1,
  4,6,3,4,3,8,6,10,3,0,3,9,10,9,3,-1,
  10,9,4,6,10,4,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,9,5,7,6,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,8,3,4,9,5,11,7,6,-1,-1,-1,-1,-1,-1,-1,
  5,0,1,5,4,0,7,6,11,-1,-1,-1,-1,-1,-1,-1,
  11,7,6,8,3,4,3,5,4,3,1,5,-1,-1,-1,-1,
  9,5,4,10,1,2,7,6,11,-1,-1,-1,-1,-1,-1,-1,
  6,11,7,1,2,10,0,8,3,4,9,5,-1,-1,-1,-1,
  7,6,11,5,4,10,4,2,10,4,0,2,-1,-1,-1,-1,
  3,4,8,3,5,4,3,2,5,10,5,2,11,7,6,-1,
  7,2,3,7,6,2,5,4,9,-1,-1,-1,-1,-1,-1,-1,
  9,5,4,0,8,6,0,6,2,6,8,7,-1,-1,-1,-1,
  3,6,2,3,7,6,1,5,0,5,4,0,-1,-1,-1,-1,
  6,2,8,6,8,7,2,1,8,4,8,5,1,5,8,-1,
  9,5,4,10,1,6,1,7,6,1,3,7,-1,-1,-1,-1,
  1,6,10,1,7,6,1,0,7,8,7,0,9,5,4,-1,
  4,0,10,4,10,5,0,3,10,6,10,7,3,7,10,-1,
  7,6,10,7,10,8,5,4,10,4,8,10,-1,-1,-1,-1,
  6,9,5,6,11,9,11,8,9,-1,-1,-1,-1,-1,-1,-1,
  3,6,11,0,6,3,0,5,6,0,9,5,-1,-1,-1,-1,
  0,11,8,0,5,11,0,1,5,5,6,11,-1,-1,-1,-1,
  6,11,3,6,3,5,5,3,1,-1,-1,-1,-1,-1,-1,-1,
  1,2,10,9,5,11,9,11,8,11,5,6,-1,-1,-1,-1,
  0,11,3,0,6,11,0,9,6,5,6,9,1,2,10,-1,
  11,8,5,11,5,6,8,0,5,10,5,2,0,2,5,-1,
  6,11,3,6,3,5,2,10,3,10,5,3,-1,-1,-1,-1,
  5,8,9,5,2,8,5,6,2,3,8,2,-1,-1,-1,-1,
  9,5,6,9,6,0,0,6,2,-1,-1,-1,-1,-1,-1,-1,
  1,5,8,1,8,0,5,6,8,3,8,2,6,2,8,-1,
  1,5,6,2,1,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,3,6,1,6,10,3,8,6,5,6,9,8,9,6,-1,
  10,1,0,10,0,6,9,5,0,5,6,0,-1,-1,-1,-1,
  0,3,8,5,6,10,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  10,5,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  11,5,10,7,5,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  11,5,10,11,7,5,8,3,0,-1,-1,-1,-1,-1,-1,-1,
  5,11,7,5,10,11,1,9,0,-1,-1,-1,-1,-1,-1,-1,
  10,7,5,10,11,7,9,8,1,8,3,1,-1,-1,-1,-1,
  11,1,2,11,7,1,7,5,1,-1,-1,-1,-1,-1,-1,-1,
  0,8,3,1,2,7,1,7,5,7,2,11,-1,-1,-1,-1,
  9,7,5,9,2,7,9,0,2,2,11,7,-1,-1,-1,-1,
  7,5,2,7,2,11,5,9,2,3,2,8,9,8,2,-1,
  2,5,10,2,3,5,3,7,5,-1,-1,-1,-1,-1,-1,-1,
  8,2,0,8,5,2,8,7,5,10,2,5,-1,-1,-1,-1,
  9,0,1,5,10,3,5,3,7,3,10,2,-1,-1,-1,-1,
  9,8,2,9,2,1,8,7,2,10,2,5,7,5,2,-1,
  1,3,5,3,7,5,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,8,7,0,7,1,1,7,5,-1,-1,-1,-1,-1,-1,-1,
  9,0,3,9,3,5,5,3,7,-1,-1,-1,-1,-1,-1,-1,
  9,8,7,5,9,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  5,8,4,5,10,8,10,11,8,-1,-1,-1,-1,-1,-1,-1,
  5,0,4,5,11,0,5,10,11,11,3,0,-1,-1,-1,-1,
  0,1,9,8,4,10,8,10,11,10,4,5,-1,-1,-1,-1,
  10,11,4,10,4,5,11,3,4,9,4,1,3,1,4,-1,
  2,5,1,2,8,5,2,11,8,4,5,8,-1,-1,-1,-1,
  0,4,11,0,11,3,4,5,11,2,11,1,5,1,11,-1,
  0,2,5,0,5,9,2,11,5,4,5,8,11,8,5,-1,
  9,4,5,2,11,3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  2,5,10,3,5,2,3,4,5,3,8,4,-1,-1,-1,-1,
  5,10,2,5,2,4,4,2,0,-1,-1,-1,-1,-1,-1,-1,
  3,10,2,3,5,10,3,8,5,4,5,8,0,1,9,-1,
  5,10,2,5,2,4,1,9,2,9,4,2,-1,-1,-1,-1,
  8,4,5,8,5,3,3,5,1,-1,-1,-1,-1,-1,-1,-1,
  0,4,5,1,0,5,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  8,4,5,8,5,3,9,0,5,0,3,5,-1,-1,-1,-1,
  9,4,5,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,11,7,4,9,11,9,10,11,-1,-1,-1,-1,-1,-1,-1,
  0,8,3,4,9,7,9,11,7,9,10,11,-1,-1,-1,-1,
  1,10,11,1,11,4,1,4,0,7,4,11,-1,-1,-1,-1,
  3,1,4,3,4,8,1,10,4,7,4,11,10,11,4,-1,
  4,11,7,9,11,4,9,2,11,9,1,2,-1,-1,-1,-1,
  9,7,4,9,11,7,9,1,11,2,11,1,0,8,3,-1,
  11,7,4,11,4,2,2,4,0,-1,-1,-1,-1,-1,-1,-1,
  11,7,4,11,4,2,8,3,4,3,2,4,-1,-1,-1,-1,
  2,9,10,2,7,9,2,3,7,7,4,9,-1,-1,-1,-1,
  9,10,7,9,7,4,10,2,7,8,7,0,2,0,7,-1,
  3,7,10,3,10,2,7,4,10,1,10,0,4,0,10,-1,
  1,10,2,8,7,4,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,9,1,4,1,7,7,1,3,-1,-1,-1,-1,-1,-1,-1,
  4,9,1,4,1,7,0,8,1,8,7,1,-1,-1,-1,-1,
  4,0,3,7,4,3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,8,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  9,10,8,10,11,8,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  3,0,9,3,9,11,11,9,10,-1,-1,-1,-1,-1,-1,-1,
  0,1,10,0,10,8,8,10,11,-1,-1,-1,-1,-1,-1,-1,
  3,1,10,11,3,10,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,2,11,1,11,9,9,11,8,-1,-1,-1,-1,-1,-1,-1,
  3,0,9,3,9,11,1,2,9,2,11,9,-1,-1,-1,-1,
  0,2,11,8,0,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  3,2,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  2,3,8,2,8,10,10,8,9,-1,-1,-1,-1,-1,-1,-1,
  9,10,2,0,9,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  2,3,8,2,8,10,0,1,8,1,10,8,-1,-1,-1,-1,
  1,10,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,3,8,9,1,8,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,9,1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,3,8,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
]);

// 12 edges: pairs of corner indices [corner0, corner1]
const EDGE_TO_CORNERS = new Uint32Array([
  0,1, 1,2, 2,3, 3,0,
  4,5, 5,6, 6,7, 7,4,
  0,4, 1,5, 2,6, 3,7,
]);

// 8 corner offsets in a unit cube (x,y,z for each)
const CORNER_OFFSETS = new Uint32Array([
  0,0,0, 1,0,0, 1,1,0, 0,1,0,
  0,0,1, 1,0,1, 1,1,1, 0,1,1,
]);

// ─── WGSL Shader Source ──────────────────────────────────────────────────────

const SHARED_WGSL = /* wgsl */`
struct Params {
  gridSize: u32,
  atomCount: u32,
  isoLevel: f32,
  cellSize: f32,
  gridOrigin: vec3<f32>,
  _pad: f32,
  dispScale: f32,
  dispWidth: u32,
  dispHeight: u32,
  _pad2: f32,
  dispCentroid: vec3<f32>,
  _pad3: f32,
}

@group(0) @binding(0) var<storage, read> triTable: array<i32>;
@group(0) @binding(1) var<storage, read> edgeTable: array<u32>;
@group(1) @binding(0) var<uniform> params: Params;
@group(1) @binding(1) var<storage, read> atoms: array<vec4<f32>>;

const MC_STRENGTH: f32 = ${MC_STRENGTH};
const MC_INFLUENCE_RADIUS: f32 = ${MC_INFLUENCE_RADIUS};
const MC_EPSILON: f32 = ${MC_EPSILON};
const MC_NORMAL_EPS: f32 = ${MC_NORMAL_EPSILON};

// Edge-to-corner pairs (12 edges × 2 corners) — hardcoded to save a storage buffer binding
const EDGE_CORNERS = array<u32, 24>(
  0u,1u, 1u,2u, 2u,3u, 3u,0u,
  4u,5u, 5u,6u, 6u,7u, 7u,4u,
  0u,4u, 1u,5u, 2u,6u, 3u,7u
);

// Corner offsets in a unit cube (8 corners × 3 components) — hardcoded
const CORNER_OFFS = array<u32, 24>(
  0u,0u,0u, 1u,0u,0u, 1u,1u,0u, 0u,1u,0u,
  0u,0u,1u, 1u,0u,1u, 1u,1u,1u, 0u,1u,1u
);

fn cornerOffset(i: u32) -> vec3<f32> {
  return vec3<f32>(
    f32(CORNER_OFFS[i * 3u]),
    f32(CORNER_OFFS[i * 3u + 1u]),
    f32(CORNER_OFFS[i * 3u + 2u])
  );
}

fn worldPos(gridPos: vec3<f32>) -> vec3<f32> {
  return params.gridOrigin + gridPos * params.cellSize;
}

// Compact support kernel: each atom's field drops to zero at MC_INFLUENCE_RADIUS × its radius.
// Prevents field accumulation from distant atoms (which caused giant-sphere artifacts).
fn sampleField(pos: vec3<f32>) -> f32 {
  var val = 0.0;
  for (var i = 0u; i < params.atomCount; i++) {
    let atom = atoms[i];
    let diff = pos - atom.xyz;
    let d2 = dot(diff, diff);
    let r = atom.w;
    let influence = r * MC_INFLUENCE_RADIUS;
    let inf2 = influence * influence;
    if (d2 < inf2) {
      let s = 1.0 - d2 / inf2;
      val += s * s * MC_STRENGTH;
    }
  }
  return val;
}

fn flatIndex(pos: vec3<u32>) -> u32 {
  return pos.x + pos.y * params.gridSize + pos.z * params.gridSize * params.gridSize;
}
`;

const CLASSIFY_WGSL = SHARED_WGSL + /* wgsl */`
@group(1) @binding(2) var<storage, read_write> triCounts: array<u32>;
@group(1) @binding(3) var<storage, read_write> caseIndices: array<u32>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let gs = params.gridSize;
  if (id.x >= gs - 1u || id.y >= gs - 1u || id.z >= gs - 1u) {
    // Boundary voxels beyond the grid: write 0
    if (id.x < gs && id.y < gs && id.z < gs) {
      let idx = flatIndex(id);
      triCounts[idx] = 0u;
      caseIndices[idx] = 0u;
    }
    return;
  }

  var cubeVals: array<f32, 8>;
  for (var i = 0u; i < 8u; i++) {
    let corner = vec3<f32>(id) + cornerOffset(i);
    cubeVals[i] = sampleField(worldPos(corner));
  }

  // Standard MC tables use convention: bit set when value < isoLevel
  // Our metaball field is high inside, so invert: bit set when value < isoLevel
  var caseIndex = 0u;
  for (var i = 0u; i < 8u; i++) {
    if (cubeVals[i] < params.isoLevel) {
      caseIndex |= (1u << i);
    }
  }

  var numTris = 0u;
  if (edgeTable[caseIndex] != 0u) {
    for (var i = 0u; i < 16u; i += 3u) {
      if (triTable[caseIndex * 16u + i] < 0) { break; }
      numTris++;
    }
  }

  let idx = flatIndex(id);
  triCounts[idx] = numTris;
  caseIndices[idx] = caseIndex;
}
`;

const PREFIX_SUM_SCAN_WGSL = /* wgsl */`
@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@group(0) @binding(1) var<storage, read_write> blockSums: array<u32>;

var<workgroup> wgData: array<u32, ${SCAN_WORKGROUP_SIZE * 2}>;

@compute @workgroup_size(${SCAN_WORKGROUP_SIZE})
fn main(
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(workgroup_id) wid: vec3<u32>,
  @builtin(num_workgroups) nwg: vec3<u32>,
) {
  let BLOCK = ${SCAN_WORKGROUP_SIZE * 2}u;
  let globalBase = wid.x * BLOCK;
  let n = arrayLength(&data);

  // Load two elements per thread into workgroup memory
  let ai = lid.x;
  let bi = lid.x + ${SCAN_WORKGROUP_SIZE}u;
  wgData[ai] = select(0u, data[globalBase + ai], globalBase + ai < n);
  wgData[bi] = select(0u, data[globalBase + bi], globalBase + bi < n);

  // Up-sweep (reduce)
  var offset = 1u;
  for (var d = ${SCAN_WORKGROUP_SIZE}u; d > 0u; d >>= 1u) {
    workgroupBarrier();
    if (lid.x < d) {
      let ai2 = offset * (2u * lid.x + 1u) - 1u;
      let bi2 = offset * (2u * lid.x + 2u) - 1u;
      wgData[bi2] += wgData[ai2];
    }
    offset <<= 1u;
  }

  // Store block total and clear last element
  workgroupBarrier();
  if (lid.x == 0u) {
    blockSums[wid.x] = wgData[BLOCK - 1u];
    wgData[BLOCK - 1u] = 0u;
  }

  // Down-sweep
  for (var d = 1u; d < BLOCK; d <<= 1u) {
    offset >>= 1u;
    workgroupBarrier();
    if (lid.x < d) {
      let ai2 = offset * (2u * lid.x + 1u) - 1u;
      let bi2 = offset * (2u * lid.x + 2u) - 1u;
      let t = wgData[ai2];
      wgData[ai2] = wgData[bi2];
      wgData[bi2] += t;
    }
  }

  workgroupBarrier();
  if (globalBase + ai < n) { data[globalBase + ai] = wgData[ai]; }
  if (globalBase + bi < n) { data[globalBase + bi] = wgData[bi]; }
}
`;

const PREFIX_SUM_ADD_WGSL = /* wgsl */`
@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@group(0) @binding(1) var<storage, read_write> blockSums: array<u32>;

@compute @workgroup_size(${SCAN_WORKGROUP_SIZE})
fn main(
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(workgroup_id) wid: vec3<u32>,
) {
  if (wid.x == 0u) { return; } // First block has no offset to add
  let BLOCK = ${SCAN_WORKGROUP_SIZE * 2}u;
  let globalBase = wid.x * BLOCK;
  let n = arrayLength(&data);
  let blockPrefix = blockSums[wid.x];

  let ai = globalBase + lid.x;
  let bi = globalBase + lid.x + ${SCAN_WORKGROUP_SIZE}u;
  if (ai < n) { data[ai] += blockPrefix; }
  if (bi < n) { data[bi] += blockPrefix; }
}
`;

const GENERATE_WGSL = SHARED_WGSL + /* wgsl */`
@group(1) @binding(2) var<storage, read> triOffsets: array<u32>;
@group(1) @binding(3) var<storage, read> caseIndicesIn: array<u32>;
@group(1) @binding(4) var<storage, read_write> outputVerts: array<f32>;
@group(1) @binding(5) var<storage, read_write> vertexCounter: array<atomic<u32>>;
@group(1) @binding(6) var<storage, read> dispPixels: array<u32>;

const DISP_TWO_PI: f32 = 6.283185307;
const DISP_PI: f32 = 3.141592654;

// Sample displacement map (R channel) at UV with bilinear interpolation
fn sampleDisp(u_in: f32, v_in: f32) -> f32 {
  if (params.dispWidth == 0u || params.dispHeight == 0u) { return 0.0; }
  let u = fract(u_in);
  let v = fract(v_in);
  let px = u * f32(params.dispWidth - 1u);
  let py = (1.0 - v) * f32(params.dispHeight - 1u);
  let x0 = u32(floor(px));
  let y0 = u32(floor(py));
  let x1 = min(x0 + 1u, params.dispWidth - 1u);
  let y1 = min(y0 + 1u, params.dispHeight - 1u);
  let fx = px - floor(px);
  let fy = py - floor(py);
  // Each pixel is packed as a u32 (RGBA little-endian); extract R channel
  let v00 = f32(dispPixels[y0 * params.dispWidth + x0] & 0xffu) / 255.0;
  let v10 = f32(dispPixels[y0 * params.dispWidth + x1] & 0xffu) / 255.0;
  let v01 = f32(dispPixels[y1 * params.dispWidth + x0] & 0xffu) / 255.0;
  let v11 = f32(dispPixels[y1 * params.dispWidth + x1] & 0xffu) / 255.0;
  return v00 * (1.0 - fx) * (1.0 - fy) + v10 * fx * (1.0 - fy) + v01 * (1.0 - fx) * fy + v11 * fx * fy;
}

// Compute displacement offset for a vertex: spherical UV → sample → scale along normal
fn displaceVertex(pos: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
  if (params.dispScale == 0.0) { return pos; }
  let d = pos - params.dispCentroid;
  let len = length(d);
  if (len < 0.0001) { return pos; }
  let dn = d / len;
  let u = 0.5 + atan2(dn.z, dn.x) / DISP_TWO_PI;
  let v = 0.5 + asin(clamp(dn.y, -1.0, 1.0)) / DISP_PI;
  let disp = sampleDisp(u, v) * params.dispScale;
  return pos + normal * disp;
}

fn interpolateEdge(gridPosF: vec3<f32>, edgeNum: u32, cubeVals: ptr<function, array<f32, 8>>) -> vec3<f32> {
  let c0 = EDGE_CORNERS[edgeNum * 2u];
  let c1 = EDGE_CORNERS[edgeNum * 2u + 1u];
  let p0 = worldPos(gridPosF + cornerOffset(c0));
  let p1 = worldPos(gridPosF + cornerOffset(c1));
  let v0 = (*cubeVals)[c0];
  let v1 = (*cubeVals)[c1];
  let denom = v1 - v0;
  let t = select(0.5, (params.isoLevel - v0) / denom, abs(denom) > 0.00001);
  return mix(p0, p1, clamp(t, 0.0, 1.0));
}

fn computeNormal(pos: vec3<f32>) -> vec3<f32> {
  // Gradient points toward increasing field (into the blob).
  // We negate so normals point outward (away from the surface).
  let e = MC_NORMAL_EPS;
  return normalize(-vec3<f32>(
    sampleField(pos + vec3(e, 0.0, 0.0)) - sampleField(pos - vec3(e, 0.0, 0.0)),
    sampleField(pos + vec3(0.0, e, 0.0)) - sampleField(pos - vec3(0.0, e, 0.0)),
    sampleField(pos + vec3(0.0, 0.0, e)) - sampleField(pos - vec3(0.0, 0.0, e))
  ));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let gs = params.gridSize;
  let totalVoxels = gs * gs * gs;
  let voxelIdx = id.x;
  if (voxelIdx >= totalVoxels) { return; }

  let caseIndex = caseIndicesIn[voxelIdx];
  if (edgeTable[caseIndex] == 0u) { return; }

  let gz = voxelIdx / (gs * gs);
  let gy = (voxelIdx - gz * gs * gs) / gs;
  let gx = voxelIdx - gz * gs * gs - gy * gs;
  let gridPosF = vec3<f32>(f32(gx), f32(gy), f32(gz));

  // Sample field at all 8 corners
  var cubeVals: array<f32, 8>;
  for (var c = 0u; c < 8u; c++) {
    cubeVals[c] = sampleField(worldPos(gridPosF + cornerOffset(c)));
  }

  let triOffset = triOffsets[voxelIdx];
  var vertBase = triOffset * 3u; // 3 verts per tri

  for (var i = 0u; i < 16u; i += 3u) {
    let e0 = triTable[caseIndex * 16u + i];
    if (e0 < 0) { break; }
    let e1 = triTable[caseIndex * 16u + i + 1u];
    let e2 = triTable[caseIndex * 16u + i + 2u];

    let v0 = interpolateEdge(gridPosF, u32(e0), &cubeVals);
    let v1 = interpolateEdge(gridPosF, u32(e1), &cubeVals);
    let v2 = interpolateEdge(gridPosF, u32(e2), &cubeVals);

    let n0 = computeNormal(v0);
    let n1 = computeNormal(v1);
    let n2 = computeNormal(v2);

    // Apply displacement along normals (no-op if dispScale == 0)
    let dv0 = displaceVertex(v0, n0);
    let dv1 = displaceVertex(v1, n1);
    let dv2 = displaceVertex(v2, n2);

    // Write interleaved: [px,py,pz, nx,ny,nz] per vertex
    let b = vertBase * 6u;
    outputVerts[b]      = dv0.x; outputVerts[b + 1u]  = dv0.y; outputVerts[b + 2u]  = dv0.z;
    outputVerts[b + 3u] = n0.x;  outputVerts[b + 4u]  = n0.y;  outputVerts[b + 5u]  = n0.z;
    outputVerts[b + 6u] = dv1.x; outputVerts[b + 7u]  = dv1.y; outputVerts[b + 8u]  = dv1.z;
    outputVerts[b + 9u] = n1.x;  outputVerts[b + 10u] = n1.y;  outputVerts[b + 11u] = n1.z;
    outputVerts[b + 12u]= dv2.x; outputVerts[b + 13u] = dv2.y; outputVerts[b + 14u] = dv2.z;
    outputVerts[b + 15u]= n2.x;  outputVerts[b + 16u] = n2.y;  outputVerts[b + 17u] = n2.z;

    vertBase += 3u;
  }

  // Atomically accumulate total vertex count
  let numTris = triOffsets[min(voxelIdx + 1u, totalVoxels - 1u)] - triOffset;
  // Only the last voxel writes the total using the last offset + its own count
  // Instead, each voxel adds its own contribution
  atomicAdd(&vertexCounter[0], numTris * 3u);
}
`;

// ─── MarchingCubesGPU Class ──────────────────────────────────────────────────

export class MarchingCubesGPU {
  constructor(device) {
    this.device = device;
    this._initialized = false;
    this._gridSize = 0;
    // Serial queue: prevents concurrent computeMolecule() calls from
    // corrupting shared GPU buffers (staging, output, params, atoms).
    this._computeQueue = Promise.resolve();
  }

  async init() {
    const device = this.device;

    // Upload static lookup tables (edgeToCorners and cornerOffsets are WGSL constants)
    this._triTableBuf = this._createStorageBuffer(TRI_TABLE.buffer, 'triTable');
    this._edgeTableBuf = this._createStorageBuffer(EDGE_TABLE.buffer, 'edgeTable');

    // Shared bind group layout (group 0) — static lookup tables
    this._sharedBGL = device.createBindGroupLayout({
      label: 'mc-shared-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });

    this._sharedBG = device.createBindGroup({
      label: 'mc-shared-bg',
      layout: this._sharedBGL,
      entries: [
        { binding: 0, resource: { buffer: this._triTableBuf } },
        { binding: 1, resource: { buffer: this._edgeTableBuf } },
      ],
    });

    // ── Classify pipeline ──
    this._classifyBGL = device.createBindGroupLayout({
      label: 'mc-classify-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    this._classifyPipeline = device.createComputePipeline({
      label: 'mc-classify',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._sharedBGL, this._classifyBGL] }),
      compute: { module: device.createShaderModule({ code: CLASSIFY_WGSL }), entryPoint: 'main' },
    });

    // ── Prefix sum pipelines ──
    this._scanBGL = device.createBindGroupLayout({
      label: 'mc-scan-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    const scanLayout = device.createPipelineLayout({ bindGroupLayouts: [this._scanBGL] });

    this._scanPipeline = device.createComputePipeline({
      label: 'mc-scan',
      layout: scanLayout,
      compute: { module: device.createShaderModule({ code: PREFIX_SUM_SCAN_WGSL }), entryPoint: 'main' },
    });

    this._scanAddPipeline = device.createComputePipeline({
      label: 'mc-scan-add',
      layout: scanLayout,
      compute: { module: device.createShaderModule({ code: PREFIX_SUM_ADD_WGSL }), entryPoint: 'main' },
    });

    // ── Generate pipeline ──
    this._generateBGL = device.createBindGroupLayout({
      label: 'mc-generate-bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });

    this._generatePipeline = device.createComputePipeline({
      label: 'mc-generate',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this._sharedBGL, this._generateBGL] }),
      compute: { module: device.createShaderModule({ code: GENERATE_WGSL }), entryPoint: 'main' },
    });

    // Empty displacement buffer (used when no displacement map is provided)
    this._emptyDispBuf = device.createBuffer({
      label: 'mc-disp-empty', size: 4,
      usage: GPUBufferUsage.STORAGE,
    });
    this._dispPixelBuf = null;

    this._initialized = true;
  }

  /**
   * Compute isosurface for a molecule.
   * @param {Float32Array} atomData - Packed [x,y,z,radius, ...] per atom (4 floats each)
   * @param {number} gridSize - Voxel grid resolution (default 32)
   * @returns {Promise<{positions: Float32Array, normals: Float32Array, vertexCount: number}>}
   */
  /**
   * Compute isosurface for a molecule.
   * @param {Float32Array} atomData - Packed [x,y,z,radius, ...] per atom (4 floats each)
   * @param {number} gridSize - Voxel grid resolution (default 32)
   * @param {{pixels: Uint8ClampedArray, width: number, height: number, scale: number}|null} displacement
   * @returns {Promise<{positions: Float32Array, normals: Float32Array, vertexCount: number}>}
   */
  computeMolecule(atomData, gridSize = MC_GRID_SIZE, displacement = null) {
    if (!this._initialized) throw new Error('MarchingCubesGPU not initialized');

    const atomCount = atomData.length / 4;
    if (atomCount === 0) return Promise.resolve({ positions: new Float32Array(0), normals: new Float32Array(0), vertexCount: 0 });

    // Serialize: chain onto the queue so concurrent calls don't corrupt shared buffers.
    const result = this._computeQueue.then(() => this._computeMoleculeImpl(atomData, gridSize, displacement));
    this._computeQueue = result.catch(() => {}); // keep queue alive even if one fails
    return result;
  }

  async _computeMoleculeImpl(atomData, gridSize, displacement) {
    const device = this.device;
    const atomCount = atomData.length / 4;

    // Compute AABB
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let maxRadius = 0;
    for (let i = 0; i < atomCount; i++) {
      const x = atomData[i * 4], y = atomData[i * 4 + 1], z = atomData[i * 4 + 2], r = atomData[i * 4 + 3];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      maxRadius = Math.max(maxRadius, r);
    }
    const pad = maxRadius * MC_PADDING_FACTOR;
    minX -= pad; minY -= pad; minZ -= pad;
    maxX += pad; maxY += pad; maxZ += pad;

    const sizeX = maxX - minX, sizeY = maxY - minY, sizeZ = maxZ - minZ;
    const maxDim = Math.max(sizeX, sizeY, sizeZ, 0.001);
    const cellSize = maxDim / (gridSize - 1);

    // Center the grid
    const originX = (minX + maxX) / 2 - maxDim / 2;
    const originY = (minY + maxY) / 2 - maxDim / 2;
    const originZ = (minZ + maxZ) / 2 - maxDim / 2;

    // Ensure buffers exist for this grid size
    this._ensureBuffers(gridSize);

    const totalVoxels = gridSize * gridSize * gridSize;

    // Compute atom centroid for displacement UV projection
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < atomCount; i++) {
      cx += atomData[i * 4]; cy += atomData[i * 4 + 1]; cz += atomData[i * 4 + 2];
    }
    cx /= atomCount; cy /= atomCount; cz /= atomCount;

    // Displacement params from options
    const dispScale = displacement ? displacement.scale : 0;
    const dispWidth = displacement ? displacement.width : 0;
    const dispHeight = displacement ? displacement.height : 0;

    // Upload params (64 bytes)
    const paramsData = new ArrayBuffer(64);
    const paramsU32 = new Uint32Array(paramsData);
    const paramsF32 = new Float32Array(paramsData);
    paramsU32[0] = gridSize;
    paramsU32[1] = atomCount;
    paramsF32[2] = MC_ISO_LEVEL;
    paramsF32[3] = cellSize;
    paramsF32[4] = originX;
    paramsF32[5] = originY;
    paramsF32[6] = originZ;
    paramsF32[7] = 0; // padding
    paramsF32[8] = dispScale;
    paramsU32[9] = dispWidth;
    paramsU32[10] = dispHeight;
    paramsF32[11] = 0; // padding
    paramsF32[12] = cx;
    paramsF32[13] = cy;
    paramsF32[14] = cz;
    paramsF32[15] = 0; // padding

    device.queue.writeBuffer(this._paramsBuf, 0, paramsData);

    // Upload atom data
    const atomBufSize = Math.max(atomCount * 16, 16);
    if (!this._atomBuf || this._atomBuf.size < atomBufSize) {
      if (this._atomBuf) this._atomBuf.destroy();
      this._atomBuf = device.createBuffer({
        label: 'mc-atoms',
        size: atomBufSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }
    device.queue.writeBuffer(this._atomBuf, 0, atomData);

    // Clear vertex counter
    device.queue.writeBuffer(this._counterBuf, 0, new Uint32Array([0]));

    // Upload displacement pixel data (packed as u32 per pixel — RGBA bytes)
    let dispBuf = this._emptyDispBuf;
    if (displacement && displacement.pixels && displacement.pixels.length > 0) {
      const pixelCount = displacement.width * displacement.height;
      const packed = new Uint32Array(pixelCount);
      const px = displacement.pixels;
      for (let i = 0; i < pixelCount; i++) {
        const j = i * 4;
        packed[i] = px[j] | (px[j + 1] << 8) | (px[j + 2] << 16) | (px[j + 3] << 24);
      }
      const bufSize = packed.byteLength;
      if (!this._dispPixelBuf || this._dispPixelBuf.size < bufSize) {
        if (this._dispPixelBuf) this._dispPixelBuf.destroy();
        this._dispPixelBuf = device.createBuffer({
          label: 'mc-disp-pixels', size: bufSize,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
      }
      device.queue.writeBuffer(this._dispPixelBuf, 0, packed);
      dispBuf = this._dispPixelBuf;
    }

    // ── Create bind groups ──
    const classifyBG = device.createBindGroup({
      layout: this._classifyBGL,
      entries: [
        { binding: 0, resource: { buffer: this._paramsBuf } },
        { binding: 1, resource: { buffer: this._atomBuf } },
        { binding: 2, resource: { buffer: this._triCountsBuf } },
        { binding: 3, resource: { buffer: this._caseIndicesBuf } },
      ],
    });

    const generateBG = device.createBindGroup({
      layout: this._generateBGL,
      entries: [
        { binding: 0, resource: { buffer: this._paramsBuf } },
        { binding: 1, resource: { buffer: this._atomBuf } },
        { binding: 2, resource: { buffer: this._triCountsBuf } }, // used as triOffsets after scan
        { binding: 3, resource: { buffer: this._caseIndicesBuf } },
        { binding: 4, resource: { buffer: this._outputVertsBuf } },
        { binding: 5, resource: { buffer: this._counterBuf } },
        { binding: 6, resource: { buffer: dispBuf } },
      ],
    });

    // ── Encode commands ──
    const encoder = device.createCommandEncoder({ label: 'mc-compute' });

    // Pass 1: Classify
    const classifyWG = Math.ceil(gridSize / 4);
    const classifyPass = encoder.beginComputePass();
    classifyPass.setPipeline(this._classifyPipeline);
    classifyPass.setBindGroup(0, this._sharedBG);
    classifyPass.setBindGroup(1, classifyBG);
    classifyPass.dispatchWorkgroups(classifyWG, classifyWG, classifyWG);
    classifyPass.end();

    // Pass 2: Prefix sum on triCounts → becomes triOffsets (in-place)
    this._encodePrefixSum(encoder, this._triCountsBuf, totalVoxels);

    // Pass 3: Generate vertices
    const genWG = Math.ceil(totalVoxels / 64);
    const genPass = encoder.beginComputePass();
    genPass.setPipeline(this._generatePipeline);
    genPass.setBindGroup(0, this._sharedBG);
    genPass.setBindGroup(1, generateBG);
    genPass.dispatchWorkgroups(genWG);
    genPass.end();

    // Copy results to staging
    const maxVertBytes = MC_MAX_TRIS * 3 * 6 * 4;
    encoder.copyBufferToBuffer(this._counterBuf, 0, this._counterStagingBuf, 0, 4);
    encoder.copyBufferToBuffer(this._outputVertsBuf, 0, this._vertsStagingBuf, 0, maxVertBytes);

    device.queue.submit([encoder.finish()]);

    // ── Readback ──
    // Map BOTH staging buffers in parallel — each mapAsync resolves on the
    // next browser frame tick, so sequential awaits double the latency.
    // Both copies are in the same command buffer, so both are ready together.
    await Promise.all([
      this._counterStagingBuf.mapAsync(GPUMapMode.READ),
      this._vertsStagingBuf.mapAsync(GPUMapMode.READ),
    ]);

    const vertexCount = new Uint32Array(this._counterStagingBuf.getMappedRange())[0];
    this._counterStagingBuf.unmap();

    if (vertexCount === 0) {
      this._vertsStagingBuf.unmap();
      return { positions: new Float32Array(0), normals: new Float32Array(0), vertexCount: 0 };
    }

    const actualVertBytes = vertexCount * 6 * 4; // 6 floats per vertex (pos + normal)
    const rawData = new Float32Array(this._vertsStagingBuf.getMappedRange(0, actualVertBytes));

    // De-interleave positions and normals
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      const src = i * 6;
      const dst = i * 3;
      positions[dst] = rawData[src];
      positions[dst + 1] = rawData[src + 1];
      positions[dst + 2] = rawData[src + 2];
      normals[dst] = rawData[src + 3];
      normals[dst + 1] = rawData[src + 4];
      normals[dst + 2] = rawData[src + 5];
    }

    this._vertsStagingBuf.unmap();

    return { positions, normals, vertexCount };
  }

  // ── Internal helpers ──

  _createStorageBuffer(data, label) {
    const buf = this.device.createBuffer({
      label: `mc-${label}`,
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buf, 0, data);
    return buf;
  }

  _ensureBuffers(gridSize) {
    if (this._gridSize === gridSize) return;
    this._gridSize = gridSize;

    const device = this.device;
    const totalVoxels = gridSize * gridSize * gridSize;
    const maxVertBytes = MC_MAX_TRIS * 3 * 6 * 4;

    // Destroy old buffers
    if (this._triCountsBuf) this._triCountsBuf.destroy();
    if (this._caseIndicesBuf) this._caseIndicesBuf.destroy();
    if (this._outputVertsBuf) this._outputVertsBuf.destroy();
    if (this._counterBuf) this._counterBuf.destroy();
    if (this._counterStagingBuf) this._counterStagingBuf.destroy();
    if (this._vertsStagingBuf) this._vertsStagingBuf.destroy();
    if (this._paramsBuf) this._paramsBuf.destroy();
    if (this._blockSumsBuf) this._blockSumsBuf.destroy();

    const voxelBytes = totalVoxels * 4;
    const blockCount = Math.ceil(totalVoxels / (SCAN_WORKGROUP_SIZE * 2));

    this._triCountsBuf = device.createBuffer({
      label: 'mc-triCounts', size: voxelBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this._caseIndicesBuf = device.createBuffer({
      label: 'mc-caseIndices', size: voxelBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this._outputVertsBuf = device.createBuffer({
      label: 'mc-outputVerts', size: maxVertBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this._counterBuf = device.createBuffer({
      label: 'mc-counter', size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this._counterStagingBuf = device.createBuffer({
      label: 'mc-counter-staging', size: 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this._vertsStagingBuf = device.createBuffer({
      label: 'mc-verts-staging', size: maxVertBytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this._paramsBuf = device.createBuffer({
      label: 'mc-params', size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._blockSumsBuf = device.createBuffer({
      label: 'mc-blockSums', size: Math.max(blockCount * 4, 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  _encodePrefixSum(encoder, dataBuf, n) {
    const device = this.device;
    const blockSize = SCAN_WORKGROUP_SIZE * 2;
    const numBlocks = Math.ceil(n / blockSize);

    // Pass 1: scan each workgroup, write block sums
    const scanBG = device.createBindGroup({
      layout: this._scanBGL,
      entries: [
        { binding: 0, resource: { buffer: dataBuf } },
        { binding: 1, resource: { buffer: this._blockSumsBuf } },
      ],
    });

    const pass1 = encoder.beginComputePass();
    pass1.setPipeline(this._scanPipeline);
    pass1.setBindGroup(0, scanBG);
    pass1.dispatchWorkgroups(numBlocks);
    pass1.end();

    // If more than one block, scan the block sums and propagate
    if (numBlocks > 1) {
      // We need a second blockSums buffer for the block-level scan
      const numBlocks2 = Math.ceil(numBlocks / blockSize);
      if (!this._blockSums2Buf || this._blockSums2Buf.size < Math.max(numBlocks2 * 4, 4)) {
        if (this._blockSums2Buf) this._blockSums2Buf.destroy();
        this._blockSums2Buf = device.createBuffer({
          label: 'mc-blockSums2', size: Math.max(numBlocks2 * 4, 4),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
      }

      // Scan block sums
      const scanBlocksBG = device.createBindGroup({
        layout: this._scanBGL,
        entries: [
          { binding: 0, resource: { buffer: this._blockSumsBuf } },
          { binding: 1, resource: { buffer: this._blockSums2Buf } },
        ],
      });

      const pass2 = encoder.beginComputePass();
      pass2.setPipeline(this._scanPipeline);
      pass2.setBindGroup(0, scanBlocksBG);
      pass2.dispatchWorkgroups(numBlocks2);
      pass2.end();

      // Propagate block prefixes back to data
      const addBG = device.createBindGroup({
        layout: this._scanBGL,
        entries: [
          { binding: 0, resource: { buffer: dataBuf } },
          { binding: 1, resource: { buffer: this._blockSumsBuf } },
        ],
      });

      const pass3 = encoder.beginComputePass();
      pass3.setPipeline(this._scanAddPipeline);
      pass3.setBindGroup(0, addBG);
      pass3.dispatchWorkgroups(numBlocks);
      pass3.end();
    }
  }

  dispose() {
    const bufs = [
      '_triTableBuf', '_edgeTableBuf',
      '_triCountsBuf', '_caseIndicesBuf', '_outputVertsBuf', '_counterBuf',
      '_counterStagingBuf', '_vertsStagingBuf', '_paramsBuf', '_blockSumsBuf',
      '_blockSums2Buf', '_atomBuf',
    ];
    for (const name of bufs) {
      if (this[name]) { this[name].destroy(); this[name] = null; }
    }
    this._initialized = false;
  }
}

// ─── UV Generation ──────────────────────────────────────────────────────────
//
// MC meshes have no UVs. Without them, texture-mapped skins (albedo, normal,
// roughness maps) sample at (0,0) and render as black or invisible.
//
// Spherical projection from the centroid produces usable UVs for blobby
// isosurfaces. There's a seam at the atan2 discontinuity but it's acceptable
// for organic shapes.

/**
 * Generate spherical UV coordinates from vertex positions.
 * @param {Float32Array} positions — flat xyz array (3 floats per vertex)
 * @param {number} vertexCount
 * @returns {Float32Array} — flat uv array (2 floats per vertex)
 */
export function generateSphericalUVs(positions, vertexCount) {
  // Compute centroid
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < vertexCount; i++) {
    cx += positions[i * 3];
    cy += positions[i * 3 + 1];
    cz += positions[i * 3 + 2];
  }
  const inv = 1 / vertexCount;
  cx *= inv; cy *= inv; cz *= inv;

  const uvs = new Float32Array(vertexCount * 2);
  const TWO_PI = 2 * Math.PI;

  for (let i = 0; i < vertexCount; i++) {
    const dx = positions[i * 3] - cx;
    const dy = positions[i * 3 + 1] - cy;
    const dz = positions[i * 3 + 2] - cz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

    // Spherical projection: longitude → u, latitude → v
    uvs[i * 2]     = 0.5 + Math.atan2(dz, dx) / TWO_PI;
    uvs[i * 2 + 1] = 0.5 + Math.asin(Math.max(-1, Math.min(1, dy / len))) / Math.PI;
  }

  return uvs;
}
