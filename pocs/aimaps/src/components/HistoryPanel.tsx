import { useState, useRef, type FormEvent, type ChangeEvent } from 'react';
import type { HistoryEntry, MaterialScalars, MapKey } from '../lib/types';
import { DEFAULT_SCALARS } from '../lib/types';

// Re-export HistoryEntry so existing imports from '../App' keep working
export type { HistoryEntry };

/** Shape of the bundled JSON file we save / load */
interface ShaderBundle {
  prompt: string;
  scalars: MaterialScalars;
  maps: Partial<Record<MapKey, string>>;
}

interface HistoryPanelProps {
  history: HistoryEntry[];
  activeMapId: string | null;
  loading: boolean;
  loadingStatus: string;
  scalarOverrides: Record<string, MaterialScalars>;
  onGenerate: (prompt: string) => void;
  onSelect: (id: string) => void;
  onLoad: (entry: HistoryEntry, scalars: MaterialScalars) => void;
}

/** Human-readable labels for map thumbnails */
const MAP_LABELS: Record<MapKey, string> = {
  displacement: 'Disp',
  normal: 'Norm',
  albedo: 'Color',
  roughness: 'Rough',
  metalness: 'Metal',
  emissive: 'Emit',
};

/** Display order for map thumbnails */
const MAP_DISPLAY_ORDER: MapKey[] = [
  'albedo',
  'displacement',
  'normal',
  'roughness',
  'metalness',
  'emissive',
];

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function slugify(text: string, maxLen = 30): string {
  return text
    .slice(0, maxLen)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function saveShader(entry: HistoryEntry, overrides?: MaterialScalars) {
  const bundle: ShaderBundle = {
    prompt: entry.prompt,
    scalars: overrides ?? entry.recipe.scalars,
    maps: entry.maps,
  };
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${slugify(entry.prompt)}.shader.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Pick the best thumbnail: prefer albedo, fall back to displacement, then first available */
function primaryThumb(entry: HistoryEntry): string | null {
  return (
    entry.maps.albedo ??
    entry.maps.displacement ??
    Object.values(entry.maps).find(Boolean) ??
    null
  );
}

export function HistoryPanel({
  history,
  activeMapId,
  loading,
  loadingStatus,
  scalarOverrides,
  onGenerate,
  onSelect,
  onLoad,
}: HistoryPanelProps) {
  const [prompt, setPrompt] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;
    onGenerate(trimmed);
    setPrompt('');
  };

  const handleFileOpen = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be reopened
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const bundle = JSON.parse(reader.result as string) as ShaderBundle;
        const entry: HistoryEntry = {
          id: crypto.randomUUID(),
          prompt: bundle.prompt ?? 'Loaded shader',
          recipe: {
            mapsToGenerate: [],
            mapDescriptions: {},
            scalars: { ...DEFAULT_SCALARS, ...bundle.scalars },
          },
          maps: bundle.maps ?? {},
          timestamp: Date.now(),
        };
        onLoad(entry, entry.recipe.scalars);
      } catch (err) {
        console.error('Failed to load shader file:', err);
        alert('Invalid shader file');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="history-panel">
      <div className="panel-header">Physically Based Materials</div>

      <div className="history-list">
        {history.length === 0 && !loading ? (
          <div className="empty-state">
            Describe a surface material to generate PBR texture maps for the 3D
            primitives
          </div>
        ) : (
          history.map((entry) => {
            const isActive = entry.id === activeMapId;
            const thumb = primaryThumb(entry);
            const availableMaps = MAP_DISPLAY_ORDER.filter((k) => entry.maps[k]);

            return (
              <div
                key={entry.id}
                className={`history-item ${isActive ? 'active' : ''}`}
                onClick={() => onSelect(entry.id)}
              >
                {/* Main row */}
                <div className="history-row">
                  {thumb ? (
                    <img className="history-thumb" src={thumb} alt={entry.prompt} />
                  ) : (
                    <div className="history-thumb history-thumb-empty" />
                  )}
                  <div className="history-info">
                    <div className="history-prompt" title={entry.prompt}>
                      {entry.prompt}
                    </div>
                    <div className="history-meta">
                      <span className="history-time">{formatTime(entry.timestamp)}</span>
                      <span className="history-map-count">
                        {availableMaps.length} map{availableMaps.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  <button
                    className="history-download"
                    onClick={(e) => {
                      e.stopPropagation();
                      saveShader(entry, scalarOverrides[entry.id]);
                    }}
                    title="Save shader bundle"
                  >
                    Save
                  </button>
                </div>

                {/* Map thumbnails — shown when active */}
                {isActive && availableMaps.length > 0 && (
                  <div className="map-thumbs">
                    {availableMaps.map((key) => (
                      <div key={key} className="map-thumb-preview">
                        <img
                          className="map-thumb-img"
                          src={entry.maps[key]!}
                          alt={key}
                        />
                        <span className="map-thumb-label">{MAP_LABELS[key]}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Prompt input area */}
      <form className="prompt-area" onSubmit={handleSubmit}>
        {loading && loadingStatus && (
          <div className="loading-status">{loadingStatus}</div>
        )}
        <textarea
          className="prompt-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe a surface material... (e.g. shiny translucent jagged gold, rough lava rock, smooth blue ceramic)"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <div className="prompt-actions">
          <button
            className="generate-btn"
            type="submit"
            disabled={!prompt.trim() || loading}
          >
            {loading ? 'Generating...' : 'Create'}
          </button>
          <button
            className="open-btn"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            Open shader&hellip;
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.shader.json"
          style={{ display: 'none' }}
          onChange={handleFileOpen}
        />
      </form>
    </div>
  );
}
