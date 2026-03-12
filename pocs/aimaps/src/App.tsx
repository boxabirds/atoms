import { useState, useCallback } from 'react';
import { ShapeGrid } from './components/ShapeGrid';
import { HistoryPanel } from './components/HistoryPanel';

export interface HistoryEntry {
  id: string;
  prompt: string;
  imageDataUrl: string;
  timestamp: number;
}

/**
 * Force an image to tile seamlessly using offset-blend:
 * 1. Shift the image by half its dimensions (so original edges land in the center)
 * 2. Crossfade between original and shifted version — original dominates the center
 *    (preserving detail), shifted version dominates the edges (ensuring continuity).
 */
function makeSeamless(srcDataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;
      const hw = w >> 1;
      const hh = h >> 1;

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;

      // Draw original
      ctx.drawImage(img, 0, 0);
      const original = ctx.getImageData(0, 0, w, h);

      // Draw shifted by half (wrapping quadrants)
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, hw, hh, hw, hh, 0, 0, hw, hh); // bottom-right → top-left
      ctx.drawImage(img, 0, hh, hw, hh, hw, 0, hw, hh); // bottom-left → top-right
      ctx.drawImage(img, hw, 0, hw, hh, 0, hh, hw, hh); // top-right → bottom-left
      ctx.drawImage(img, 0, 0, hw, hh, hw, hh, hw, hh); // top-left → bottom-right
      const shifted = ctx.getImageData(0, 0, w, h);

      // Blend: original at center, shifted at edges
      const out = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const dy = Math.abs(y - hh) / hh; // 0 at center, 1 at edge
        for (let x = 0; x < w; x++) {
          const dx = Math.abs(x - hw) / hw; // 0 at center, 1 at edge
          const t = Math.max(dx, dy);
          // Smoothstep: blend=0 at center (use original), blend=1 at edges (use shifted)
          const blend = t * t * (3 - 2 * t);

          const idx = (y * w + x) * 4;
          for (let c = 0; c < 4; c++) {
            out.data[idx + c] =
              original.data[idx + c] * (1 - blend) +
              shifted.data[idx + c] * blend;
          }
        }
      }

      ctx.putImageData(out, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load image for seamless processing'));
    img.src = srcDataUrl;
  });
}

export function App() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const activeMap = history.find((h) => h.id === activeMapId) ?? null;

  const handleGenerate = useCallback(async (prompt: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      const data = await res.json();

      if (data.error) {
        throw new Error(
          typeof data.error === 'string'
            ? data.error
            : data.error.message ?? 'API error',
        );
      }

      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find(
        (p: Record<string, unknown>) => p.inlineData,
      );

      if (!imagePart) {
        throw new Error('No image returned from Gemini');
      }

      const { mimeType, data: base64 } = imagePart.inlineData as {
        mimeType: string;
        data: string;
      };
      const rawDataUrl = `data:${mimeType};base64,${base64}`;
      const imageDataUrl = await makeSeamless(rawDataUrl);

      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        prompt,
        imageDataUrl,
        timestamp: Date.now(),
      };

      setHistory((prev) => [entry, ...prev]);
      setActiveMapId(entry.id);
    } catch (err) {
      console.error('Generation failed:', err);
      alert(`Generation failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="app">
      <ShapeGrid displacementMapUrl={activeMap?.imageDataUrl ?? null} />
      <HistoryPanel
        history={history}
        activeMapId={activeMapId}
        loading={loading}
        onGenerate={handleGenerate}
        onSelect={setActiveMapId}
      />
    </div>
  );
}
