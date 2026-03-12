import { useState, useCallback, useRef } from 'react';
import { ShapeGrid } from './components/ShapeGrid';
import { HistoryPanel } from './components/HistoryPanel';
import { computeNormalMap } from './lib/normal-from-height';
import type { HistoryEntry, MaterialRecipe, MapType, MapKey } from './lib/types';
import { DEFAULT_SCALARS } from './lib/types';

// Re-export for components that import from App
export type { HistoryEntry };

// ---------------------------------------------------------------------------
// Seamless post-processing (offset-blend)
// ---------------------------------------------------------------------------

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

      ctx.drawImage(img, 0, 0);
      const original = ctx.getImageData(0, 0, w, h);

      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, hw, hh, hw, hh, 0, 0, hw, hh);
      ctx.drawImage(img, 0, hh, hw, hh, hw, 0, hw, hh);
      ctx.drawImage(img, hw, 0, hw, hh, 0, hh, hw, hh);
      ctx.drawImage(img, 0, 0, hw, hh, hw, hh, hw, hh);
      const shifted = ctx.getImageData(0, 0, w, h);

      const out = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        // Use per-axis smoothstep then combine — blends each edge independently
        // so horizontal and vertical seams both get full coverage
        const fy = Math.abs(y - hh) / hh; // 0 at center, 1 at edge
        const sy = fy * fy * (3 - 2 * fy);
        for (let x = 0; x < w; x++) {
          const fx = Math.abs(x - hw) / hw;
          const sx = fx * fx * (3 - 2 * fx);
          // Combine: 1-(1-sx)*(1-sy) ensures each axis contributes independently
          // Both edges and corners get full shifted weight
          const blend = 1 - (1 - sx) * (1 - sy);
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

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchRecipe(prompt: string): Promise<MaterialRecipe> {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json();
  if (data.error) throw new Error(typeof data.error === 'string' ? data.error : data.error.message ?? 'Analyze failed');

  // Validate / apply defaults
  return {
    mapsToGenerate: data.mapsToGenerate ?? [],
    mapDescriptions: data.mapDescriptions ?? {},
    scalars: { ...DEFAULT_SCALARS, ...data.scalars },
  };
}

/** Extract base64 image from a Gemini generateContent response */
function extractImageDataUrl(data: Record<string, unknown>): string {
  if ((data as { error?: unknown }).error) {
    const err = (data as { error: { message?: string } | string }).error;
    throw new Error(typeof err === 'string' ? err : (err as { message?: string }).message ?? 'Image generation failed');
  }
  const candidates = (data as { candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[] }).candidates;
  const parts = candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData);
  if (!imagePart?.inlineData) throw new Error('No image returned from Gemini');
  const { mimeType, data: base64 } = imagePart.inlineData;
  return `data:${mimeType};base64,${base64}`;
}

async function generateMap(type: MapType, description: string): Promise<string> {
  const res = await fetch('/api/generate-map', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, description }),
  });
  const data = await res.json();
  const rawUrl = extractImageDataUrl(data);
  return makeSeamless(rawUrl);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeMapId, setActiveMapId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');

  // Track the "live" entry being built during generation for progressive reveal
  const liveEntryRef = useRef<HistoryEntry | null>(null);
  const [liveEntry, setLiveEntry] = useState<HistoryEntry | null>(null);

  const activeMap = liveEntry?.id === activeMapId
    ? liveEntry
    : history.find((h) => h.id === activeMapId) ?? null;

  const handleGenerate = useCallback(async (prompt: string) => {
    setLoading(true);
    setLoadingStatus('Analyzing prompt...');

    try {
      // 1. Discriminator — get material recipe
      const recipe = await fetchRecipe(prompt);
      console.log('[aimaps] Recipe:', recipe);

      const entryId = crypto.randomUUID();
      const entry: HistoryEntry = {
        id: entryId,
        prompt,
        recipe,
        maps: {},
        timestamp: Date.now(),
      };

      liveEntryRef.current = entry;
      setLiveEntry({ ...entry });
      setActiveMapId(entryId);

      // 2. Generate all maps in parallel, applying each as it arrives
      const mapTypes = recipe.mapsToGenerate;
      if (mapTypes.length === 0) {
        setLoadingStatus('No maps needed — scalars only');
      }

      const updateMap = (key: MapKey, dataUrl: string) => {
        const live = liveEntryRef.current!;
        live.maps = { ...live.maps, [key]: dataUrl };
        setLiveEntry({ ...live });
      };

      await Promise.all(
        mapTypes.map(async (type) => {
          const desc = recipe.mapDescriptions[type];
          if (!desc) return;

          setLoadingStatus(`Generating ${type} map...`);
          try {
            const dataUrl = await generateMap(type, desc);
            updateMap(type, dataUrl);

            // Derive normal map from displacement as soon as it arrives
            if (type === 'displacement') {
              setLoadingStatus('Computing normal map...');
              const normalUrl = await computeNormalMap(dataUrl);
              updateMap('normal', normalUrl);
            }
          } catch (err) {
            console.warn(`[aimaps] Failed to generate ${type} map:`, err);
          }
        }),
      );

      // 3. Finalise — move live entry into history
      const final = { ...liveEntryRef.current! };
      setHistory((prev) => [final, ...prev]);
      liveEntryRef.current = null;
      setLiveEntry(null);
    } catch (err) {
      console.error('Generation failed:', err);
      alert(`Generation failed: ${err instanceof Error ? err.message : err}`);
      liveEntryRef.current = null;
      setLiveEntry(null);
    } finally {
      setLoading(false);
      setLoadingStatus('');
    }
  }, []);

  return (
    <div className="app">
      <ShapeGrid entry={activeMap} />
      <HistoryPanel
        history={history}
        activeMapId={activeMapId}
        loading={loading}
        loadingStatus={loadingStatus}
        onGenerate={handleGenerate}
        onSelect={setActiveMapId}
      />
    </div>
  );
}
