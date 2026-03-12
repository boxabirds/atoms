/**
 * CPU-side displacement mapping with seam vertex welding.
 *
 * Three.js's GPU displacement (`displacementMap` on MeshPhysicalMaterial)
 * displaces vertices in the vertex shader per their UV coordinates. At UV
 * seams — where vertices share the same world position but have different UVs —
 * the shader samples different displacement values and tears the mesh apart.
 *
 * This module solves that by:
 * 1. Sampling displacement per vertex on the CPU
 * 2. Grouping coincident vertices (seam vertices) by position
 * 3. Averaging displacement within each group so seam vertices move identically
 * 4. Displacing along the original surface normals
 */

/** Decimal places for position hashing (~0.1mm precision at unit scale) */
const HASH_PRECISION = 4;

/** RGBA stride in pixel data */
const RGBA = 4;

/** Normalised byte range for displacement sampling */
const BYTE_MAX = 255;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DisplacementData {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Image loading
// ---------------------------------------------------------------------------

/** Decode a data-URL displacement image into raw pixel data */
export function loadDisplacementData(dataUrl: string): Promise<DisplacementData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, img.width, img.height);
      resolve({ pixels: data, width, height });
    };
    img.onerror = () => reject(new Error('Failed to load displacement image'));
    img.src = dataUrl;
  });
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/** Sample displacement (0–1) at UV with bilinear interpolation and wrapping */
function sampleDisplacement(data: DisplacementData, u: number, v: number): number {
  // Wrap UVs to [0, 1)
  u = ((u % 1) + 1) % 1;
  v = ((v % 1) + 1) % 1;

  // Pixel coordinates (V is flipped: UV origin bottom-left, image origin top-left)
  const px = u * (data.width - 1);
  const py = (1 - v) * (data.height - 1);

  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, data.width - 1);
  const y1 = Math.min(y0 + 1, data.height - 1);

  const fx = px - x0;
  const fy = py - y0;

  // Red channel (grayscale displacement maps have R ≈ G ≈ B)
  const v00 = data.pixels[(y0 * data.width + x0) * RGBA] / BYTE_MAX;
  const v10 = data.pixels[(y0 * data.width + x1) * RGBA] / BYTE_MAX;
  const v01 = data.pixels[(y1 * data.width + x0) * RGBA] / BYTE_MAX;
  const v11 = data.pixels[(y1 * data.width + x1) * RGBA] / BYTE_MAX;

  return (
    v00 * (1 - fx) * (1 - fy) +
    v10 * fx * (1 - fy) +
    v01 * (1 - fx) * fy +
    v11 * fx * fy
  );
}

// ---------------------------------------------------------------------------
// Seam vertex grouping
// ---------------------------------------------------------------------------

function positionHash(x: number, y: number, z: number): string {
  return `${x.toFixed(HASH_PRECISION)},${y.toFixed(HASH_PRECISION)},${z.toFixed(HASH_PRECISION)}`;
}

/**
 * Group vertex indices by coincident position.
 * Returns only groups with >= 2 vertices (actual seam vertices).
 */
export function buildSeamGroups(positions: Float32Array): number[][] {
  const count = positions.length / 3;
  const map = new Map<string, number[]>();

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const key = positionHash(positions[i3], positions[i3 + 1], positions[i3 + 2]);
    let group = map.get(key);
    if (!group) {
      group = [];
      map.set(key, group);
    }
    group.push(i);
  }

  return [...map.values()].filter((g) => g.length > 1);
}

// ---------------------------------------------------------------------------
// CPU displacement
// ---------------------------------------------------------------------------

/**
 * Displace geometry vertices along their original normals, averaging
 * displacement at seam vertices to prevent polygon tearing.
 *
 * Mutates `positions` in place. Uses `originalPositions` as the base.
 */
export function displace(
  positions: Float32Array,
  originalPositions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  seamGroups: number[][],
  data: DisplacementData,
  scale: number,
): void {
  const vertexCount = positions.length / 3;

  // 1. Sample per-vertex displacement
  const disp = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    disp[i] = sampleDisplacement(data, uvs[i * 2], uvs[i * 2 + 1]);
  }

  // 2. Average displacement at seam vertices
  for (const group of seamGroups) {
    let sum = 0;
    for (const idx of group) sum += disp[idx];
    const avg = sum / group.length;
    for (const idx of group) disp[idx] = avg;
  }

  // 3. Displace along original normals
  for (let i = 0; i < vertexCount; i++) {
    const d = disp[i] * scale;
    const i3 = i * 3;
    positions[i3] = originalPositions[i3] + normals[i3] * d;
    positions[i3 + 1] = originalPositions[i3 + 1] + normals[i3 + 1] * d;
    positions[i3 + 2] = originalPositions[i3 + 2] + normals[i3 + 2] * d;
  }
}

/**
 * Average vertex normals at seam positions to prevent lighting discontinuities.
 * Mutates `normals` in place.
 */
export function averageSeamNormals(normals: Float32Array, seamGroups: number[][]): void {
  for (const group of seamGroups) {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (const idx of group) {
      const i3 = idx * 3;
      nx += normals[i3];
      ny += normals[i3 + 1];
      nz += normals[i3 + 2];
    }
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    for (const idx of group) {
      const i3 = idx * 3;
      normals[i3] = nx;
      normals[i3 + 1] = ny;
      normals[i3 + 2] = nz;
    }
  }
}
