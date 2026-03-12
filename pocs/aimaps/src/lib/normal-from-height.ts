/**
 * Compute a tangent-space normal map from a grayscale height/displacement map.
 *
 * Uses a Sobel-like gradient with wrapping edges so the output is seamless
 * when the input is seamless.
 */

/** Controls how aggressively height differences translate to normal perturbation */
const DEFAULT_STRENGTH = 2.5;

export function computeNormalMap(
  heightDataUrl: string,
  strength = DEFAULT_STRENGTH,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;

      ctx.drawImage(img, 0, 0);
      const src = ctx.getImageData(0, 0, w, h);
      const out = ctx.createImageData(w, h);

      /** Read luminance (0-1) at pixel, wrapping at edges */
      const heightAt = (x: number, y: number): number => {
        const wx = ((x % w) + w) % w;
        const wy = ((y % h) + h) % h;
        const idx = (wy * w + wx) * 4;
        // Average RGB channels (grayscale images have R≈G≈B)
        return (src.data[idx] + src.data[idx + 1] + src.data[idx + 2]) / (3 * 255);
      };

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          // Central difference gradients (wrapping for seamless edges)
          const dx = heightAt(x + 1, y) - heightAt(x - 1, y);
          const dy = heightAt(x, y + 1) - heightAt(x, y - 1);

          // Normal vector: (-dx * strength, -dy * strength, 1), then normalise
          const nx = -dx * strength;
          const ny = -dy * strength;
          const nz = 1.0;
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

          // Encode to tangent-space RGB: remap [-1,1] → [0,255]
          const idx = (y * w + x) * 4;
          out.data[idx] = ((nx / len) * 0.5 + 0.5) * 255;     // R
          out.data[idx + 1] = ((ny / len) * 0.5 + 0.5) * 255; // G
          out.data[idx + 2] = ((nz / len) * 0.5 + 0.5) * 255; // B
          out.data[idx + 3] = 255;                              // A
        }
      }

      ctx.putImageData(out, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () =>
      reject(new Error('Failed to load height map for normal computation'));
    img.src = heightDataUrl;
  });
}
