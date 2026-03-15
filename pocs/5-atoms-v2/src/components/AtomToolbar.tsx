import { ATOM_KINDS, ATOM_COLORS, type AtomKind, type InteractionMode } from '../lib/types';

const ATOM_DESCRIPTIONS: Record<AtomKind, string> = {
  shell: 'Structure & mass — passive building material',
  flex: 'Joint — articulation between parts',
  push: 'Force — propulsion & locomotion',
  sense: 'Eye — detection & awareness',
  zap: 'Effector — acts on the world',
};

const ATOM_ICONS: Record<AtomKind, string> = {
  shell: '\u25A3',
  flex: '\u2B58',
  push: '\u25B6',
  sense: '\u25C9',
  zap: '\u2726',
};

interface AtomToolbarProps {
  activeTool: AtomKind | null;
  mode: InteractionMode;
  onSelectTool: (kind: AtomKind | null) => void;
  onModeChange: (mode: InteractionMode) => void;
  onReset: () => void;
}

export function AtomToolbar({ activeTool, mode, onSelectTool, onModeChange, onReset }: AtomToolbarProps) {
  return (
    <div className="atom-toolbar">
      <div className="toolbar-title">ATOMS</div>

      {ATOM_KINDS.map((kind) => {
        const color = `#${ATOM_COLORS[kind].toString(16).padStart(6, '0')}`;
        const isActive = activeTool === kind;

        return (
          <button
            key={kind}
            className={`atom-button ${isActive ? 'active' : ''}`}
            style={{
              '--atom-color': color,
              borderColor: isActive ? color : 'transparent',
            } as React.CSSProperties}
            onClick={() => onSelectTool(isActive ? null : kind)}
            title={ATOM_DESCRIPTIONS[kind]}
          >
            <span className="atom-icon">{ATOM_ICONS[kind]}</span>
            <span className="atom-name">{kind}</span>
          </button>
        );
      })}

      <div className="toolbar-divider" />

      <div className="toolbar-title">MODE</div>

      <button
        className={`atom-button mode-button ${mode === 'select' ? 'active' : ''}`}
        style={{ '--atom-color': '#6699cc' } as React.CSSProperties}
        onClick={() => onModeChange('select')}
        title="Select & drag atoms"
      >
        <span className="atom-icon">{'\u2BBD'}</span>
        <span className="atom-name">select</span>
      </button>

      <button
        className={`atom-button mode-button ${mode === 'connect' ? 'active' : ''}`}
        style={{ '--atom-color': '#2dd4bf' } as React.CSSProperties}
        onClick={() => onModeChange('connect')}
        title="Connect two atoms with a Flex joint"
      >
        <span className="atom-icon">{'\u2194'}</span>
        <span className="atom-name">connect</span>
      </button>

      <div className="toolbar-divider" />

      <button className="atom-button reset-button" onClick={onReset} title="Clear all atoms">
        <span className="atom-icon">{'\u21BA'}</span>
        <span className="atom-name">reset</span>
      </button>
    </div>
  );
}
