import { useState, type FormEvent } from 'react';
import type { HistoryEntry } from '../App';

interface HistoryPanelProps {
  history: HistoryEntry[];
  activeMapId: string | null;
  loading: boolean;
  onGenerate: (prompt: string) => void;
  onSelect: (id: string) => void;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Sanitise prompt into a usable filename fragment */
function slugify(text: string, maxLen = 30): string {
  return text
    .slice(0, maxLen)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function downloadMap(entry: HistoryEntry) {
  const a = document.createElement('a');
  a.href = entry.imageDataUrl;
  a.download = `displacement-${slugify(entry.prompt)}.png`;
  a.click();
}

export function HistoryPanel({
  history,
  activeMapId,
  loading,
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
      <div className="panel-header">Displacement Maps</div>

      <div className="history-list">
        {history.length === 0 ? (
          <div className="empty-state">
            Describe a surface texture to generate displacement maps for the 3D
            primitives
          </div>
        ) : (
          history.map((entry) => (
            <div
              key={entry.id}
              className={`history-item ${entry.id === activeMapId ? 'active' : ''}`}
              onClick={() => onSelect(entry.id)}
            >
              <img
                className="history-thumb"
                src={entry.imageDataUrl}
                alt={entry.prompt}
              />
              <div className="history-info">
                <div className="history-prompt" title={entry.prompt}>
                  {entry.prompt}
                </div>
                <div className="history-time">{formatTime(entry.timestamp)}</div>
              </div>
              <button
                className="history-download"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadMap(entry);
                }}
                title="Download displacement map"
              >
                Save
              </button>
            </div>
          ))
        )}
      </div>

      <form className="prompt-area" onSubmit={handleSubmit}>
        <textarea
          className="prompt-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe a surface texture... (e.g. rocky terrain, ocean waves, alien skin)"
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
