import { useState, useCallback } from 'react';
import type { AtomInstance, ShellParams, FlexParams, PushParams, SenseParams, ZapParams, PushMode, ZapEffect, SenseDetection, SenseTrigger, ShellShape, ZapShape } from '../lib/types';
import { ATOM_COLORS } from '../lib/types';
import { getWorldState } from './Viewport';
import { applyShellParams } from '../lib/atoms/shell';
import { applyFlexParams } from '../lib/atoms/flex';
import { applySenseParams } from '../lib/atoms/sense';
import type { SenseAtom } from '../lib/atoms/sense';
import { totalEnergy, atomEnergyCost, MAX_ENERGY } from '../lib/energy';

// ---------------------------------------------------------------------------
// Force-update hook
// ---------------------------------------------------------------------------

function useForceUpdate() {
  const [, setState] = useState(0);
  return useCallback(() => setState((c) => c + 1), []);
}

// ---------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step, onChange }: SliderProps) {
  return (
    <div className="param-slider">
      <div className="param-slider-header">
        <span className="param-slider-label">{label}</span>
        <span className="param-slider-value">{value.toFixed(step < 1 ? 1 : 0)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Option selector
// ---------------------------------------------------------------------------

interface OptionProps<T extends string> {
  label: string;
  value: T;
  options: T[];
  onChange: (value: T) => void;
}

function OptionSelect<T extends string>({ label, value, options, onChange }: OptionProps<T>) {
  return (
    <div className="param-option">
      <span className="param-slider-label">{label}</span>
      <div className="option-buttons">
        {options.map((opt) => (
          <button key={opt} className={`option-btn ${opt === value ? 'active' : ''}`}
            onClick={() => onChange(opt)}>{opt}</button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-kind editors (wire params to physics on change)
// ---------------------------------------------------------------------------

function ShellEditor({ atom }: { atom: AtomInstance }) {
  const p = atom.params as ShellParams;
  const forceUpdate = useForceUpdate();
  const ws = getWorldState();

  const apply = () => {
    if (ws) applyShellParams(atom, ws.physics.world, ws.physics.rapier);
    forceUpdate();
  };

  return (
    <>
      <OptionSelect<ShellShape>
        label="shape" value={p.shape}
        options={['box', 'sphere', 'cylinder', 'wedge', 'plate']}
        onChange={(v) => { p.shape = v; apply(); }}
      />
      <Slider label="size" value={p.size} min={0.3} max={1.5} step={0.1}
        onChange={(v) => { p.size = v; apply(); }} />
      <Slider label="density" value={p.density} min={0.5} max={5} step={0.1}
        onChange={(v) => { p.density = v; apply(); }} />
    </>
  );
}

function FlexEditor({ atom }: { atom: AtomInstance }) {
  const p = atom.params as FlexParams;
  const forceUpdate = useForceUpdate();
  const ws = getWorldState();

  const apply = () => {
    if (ws) applyFlexParams(atom, ws.physics.world, ws.physics.rapier);
    forceUpdate();
  };

  return (
    <>
      <OptionSelect
        label="DOF" value={String(p.dof)}
        options={['1', '2', '3']}
        onChange={(v) => { p.dof = parseInt(v) as 1 | 3; apply(); }}
      />
      <Slider label="stiffness" value={p.stiffness} min={0} max={100} step={1}
        onChange={(v) => { p.stiffness = v; apply(); }} />
      <Slider label="damping" value={p.damping} min={0} max={10} step={0.1}
        onChange={(v) => { p.damping = v; apply(); }} />
      <Slider label="angle limit" value={p.angleLimit} min={0.1} max={Math.PI} step={0.1}
        onChange={(v) => { p.angleLimit = v; apply(); }} />
    </>
  );
}

function PushEditor({ atom }: { atom: AtomInstance }) {
  const p = atom.params as PushParams;
  const forceUpdate = useForceUpdate();

  return (
    <>
      <Slider label="magnitude" value={p.magnitude} min={1} max={100} step={1}
        onChange={(v) => { p.magnitude = v; forceUpdate(); }} />
      <OptionSelect<PushMode>
        label="mode" value={p.mode}
        options={['continuous', 'burst', 'oscillating', 'spin']}
        onChange={(v) => { p.mode = v; forceUpdate(); }}
      />
      <Slider label="responsiveness" value={p.responsiveness} min={0} max={1} step={0.05}
        onChange={(v) => { p.responsiveness = v; forceUpdate(); }} />
      <div className="param-option">
        <span className="param-slider-label">direction</span>
        <div className="option-buttons">
          {[
            { label: 'fwd', dir: [0, 0, -1] },
            { label: 'back', dir: [0, 0, 1] },
            { label: 'up', dir: [0, 1, 0] },
            { label: 'down', dir: [0, -1, 0] },
            { label: 'left', dir: [-1, 0, 0] },
            { label: 'right', dir: [1, 0, 0] },
          ].map((d) => {
            const isActive = p.direction[0] === d.dir[0] && p.direction[1] === d.dir[1] && p.direction[2] === d.dir[2];
            return (
              <button key={d.label}
                className={`option-btn ${isActive ? 'active' : ''}`}
                onClick={() => { p.direction = d.dir as [number, number, number]; forceUpdate(); }}>
                {d.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function SenseEditor({ atom }: { atom: AtomInstance }) {
  const p = atom.params as SenseParams;
  const forceUpdate = useForceUpdate();
  const ws = getWorldState();

  return (
    <>
      <Slider label="range" value={p.range} min={1} max={20} step={0.5}
        onChange={(v) => {
          p.range = v;
          if (ws) applySenseParams(atom as SenseAtom, ws.scene.scene);
          forceUpdate();
        }} />
      <OptionSelect<SenseDetection>
        label="detection" value={p.detection}
        options={['proximity', 'contact', 'speed', 'angle', 'altitude', 'light-level', 'player-input']}
        onChange={(v) => { p.detection = v; forceUpdate(); }}
      />
      <OptionSelect<SenseTrigger>
        label="trigger" value={p.trigger}
        options={['continuous', 'threshold', 'toggle']}
        onChange={(v) => { p.trigger = v; forceUpdate(); }}
      />
      <Slider label="threshold" value={p.triggerThreshold} min={0} max={1} step={0.05}
        onChange={(v) => { p.triggerThreshold = v; forceUpdate(); }} />
    </>
  );
}

function ZapEditor({ atom }: { atom: AtomInstance }) {
  const p = atom.params as ZapParams;
  const forceUpdate = useForceUpdate();

  return (
    <>
      <OptionSelect<ZapEffect>
        label="effect" value={p.effect}
        options={['projectile', 'push-field', 'grab', 'damage-zone', 'heal', 'emit-particles']}
        onChange={(v) => { p.effect = v; forceUpdate(); }}
      />
      <OptionSelect<ZapShape>
        label="shape" value={p.shape}
        options={['sphere', 'cone', 'beam', 'targeted']}
        onChange={(v) => { p.shape = v; forceUpdate(); }}
      />
      <Slider label="range" value={p.range} min={1} max={30} step={1}
        onChange={(v) => { p.range = v; forceUpdate(); }} />
      <Slider label="intensity" value={p.intensity} min={1} max={50} step={1}
        onChange={(v) => { p.intensity = v; forceUpdate(); }} />
      <Slider label="cooldown" value={p.cooldown} min={0.1} max={3} step={0.1}
        onChange={(v) => { p.cooldown = v; forceUpdate(); }} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Energy bar
// ---------------------------------------------------------------------------

function EnergyBar({ atoms }: { atoms: AtomInstance[] }) {
  const used = totalEnergy(atoms);
  const pct = Math.min((used / MAX_ENERGY) * 100, 100);
  const overBudget = used > MAX_ENERGY;

  return (
    <div className="energy-bar-container">
      <div className="param-slider-header">
        <span className="param-slider-label">energy</span>
        <span className="param-slider-value" style={{ color: overBudget ? '#ff4444' : undefined }}>
          {used.toFixed(0)} / {MAX_ENERGY}
        </span>
      </div>
      <div className="energy-bar-track">
        <div
          className="energy-bar-fill"
          style={{
            width: `${Math.min(pct, 100)}%`,
            backgroundColor: overBudget ? '#ff4444' : pct > 80 ? '#f97316' : '#6699cc',
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ParamPanelProps {
  selectedAtom: AtomInstance | null;
  atomCount: number;
}

export function ParamPanel({ selectedAtom, atomCount }: ParamPanelProps) {
  const ws = getWorldState();
  const atoms = ws?.atoms ?? [];

  if (!selectedAtom) {
    return (
      <div className="param-panel">
        <div className="panel-title">INFO</div>
        <div className="panel-empty">
          <p>Select an atom from the toolbar to place, or use <strong>select</strong> mode to click existing atoms.</p>
          <p>Use <strong>connect</strong> mode to bridge two atoms with a Flex joint.</p>
          <p className="atom-count">{atoms.length} atoms in scene</p>
        </div>
        <div className="panel-section">
          <EnergyBar atoms={atoms} />
        </div>
      </div>
    );
  }

  const color = `#${ATOM_COLORS[selectedAtom.kind].toString(16).padStart(6, '0')}`;
  const cost = atomEnergyCost(selectedAtom);

  return (
    <div className="param-panel">
      <div className="panel-title" style={{ color }}>
        {selectedAtom.kind.toUpperCase()} #{selectedAtom.id}
      </div>
      <div className="panel-cost">cost: {cost.toFixed(0)} energy</div>

      <div className="panel-section">
        <div className="section-title">PARAMETERS</div>
        {selectedAtom.kind === 'shell' && <ShellEditor atom={selectedAtom} />}
        {selectedAtom.kind === 'flex' && <FlexEditor atom={selectedAtom} />}
        {selectedAtom.kind === 'push' && <PushEditor atom={selectedAtom} />}
        {selectedAtom.kind === 'sense' && <SenseEditor atom={selectedAtom} />}
        {selectedAtom.kind === 'zap' && <ZapEditor atom={selectedAtom} />}
      </div>

      <div className="panel-section">
        <div className="section-title">CONNECTIONS</div>
        {selectedAtom.connections.length === 0 ? (
          <p className="panel-hint">No connections. Use connect mode to link atoms.</p>
        ) : (
          <ul className="connection-list">
            {selectedAtom.connections.map((id) => {
              const other = atoms.find((a) => a.id === id);
              return (
                <li key={id} className="connection-item">
                  {other ? `${other.kind} #${other.id}` : `#${id}`}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="panel-section">
        <div className="section-title">STATE</div>
        <p className="param-state">active: {selectedAtom.active ? 'yes' : 'no'}</p>
      </div>

      <div className="panel-section">
        <EnergyBar atoms={atoms} />
      </div>
    </div>
  );
}
