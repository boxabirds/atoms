import { useState, type FormEvent } from 'react';
import type { HistoryEntry, MapKey } from '../lib/types';

// Re-export HistoryEntry so existing imports from '../App' keep working
export type { HistoryEntry };

interface HistoryPanelProps {
  history: HistoryEntry[];
  activeMapId: string | null;
  loading: boolean;
  loadingStatus: string;
  onGenerate: (prompt: string) => void;
  onSelect: (id: string) => void;
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

function downloadSingleMap(entry: HistoryEntry, key: MapKey) {
  const dataUrl = entry.maps[key];
  if (!dataUrl) return;
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `${key}-${slugify(entry.prompt)}.png`;
  a.click();
}

function downloadAllMaps(entry: HistoryEntry) {
  for (const key of MAP_DISPLAY_ORDER) {
    if (entry.maps[key]) downloadSingleMap(entry, key);
  }
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
  onGenerate,
  onSelect,
}: HistoryPanelProps) {
  const [prompt, setPrompt] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;
    onGenerate(trimmed);
    setPrompt('');
  };

  return (
    <div className="history-panel">
      <div className="panel-header">PBR Materials</div>

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
                      downloadAllMaps(entry);
                    }}
                    title="Download all maps"
                  >
                    Save
                  </button>
                </div>

                {/* Map thumbnails — shown when active */}
                {isActive && availableMaps.length > 0 && (
                  <div className="map-thumbs">
                    {availableMaps.map((key) => (
                      <button
                        key={key}
                        className="map-thumb-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadSingleMap(entry, key);
                        }}
                        title={`Download ${key} map`}
                      >
                        <img
                          className="map-thumb-img"
                          src={entry.maps[key]!}
                          alt={key}
                        />
                        <span className="map-thumb-label">{MAP_LABELS[key]}</span>
                      </button>
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
        <button
          className="generate-btn"
          type="submit"
          disabled={!prompt.trim() || loading}
        >
          {loading ? 'Generating...' : 'Create'}
        </button>
      </form>
    </div>
  );
}
