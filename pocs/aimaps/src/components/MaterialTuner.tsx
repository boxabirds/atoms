import { useCallback } from 'react';
import type { MaterialScalars } from '../lib/types';

// ---------------------------------------------------------------------------
// Slider config — defines every tunable scalar
// ---------------------------------------------------------------------------

interface SliderDef {
  key: keyof MaterialScalars;
  label: string;
  min: number;
  max: number;
  step: number;
}

/** Numeric scalars exposed as sliders */
const SLIDERS: SliderDef[] = [
  { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01 },
  { key: 'metalness', label: 'Metalness', min: 0, max: 1, step: 0.01 },
  { key: 'displacementScale', label: 'Displacement', min: 0, max: 1, step: 0.01 },
  { key: 'transmission', label: 'Transmission', min: 0, max: 1, step: 0.01 },
  { key: 'thickness', label: 'Thickness', min: 0, max: 5, step: 0.1 },
  { key: 'ior', label: 'IOR', min: 1, max: 2.5, step: 0.01 },
  { key: 'emissiveIntensity', label: 'Emissive', min: 0, max: 5, step: 0.1 },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MaterialTunerProps {
  scalars: MaterialScalars;
  onChange: (scalars: MaterialScalars) => void;
  disabled?: boolean;
}

export function MaterialTuner({ scalars, onChange, disabled }: MaterialTunerProps) {
  const handleSlider = useCallback(
    (key: keyof MaterialScalars, value: number) => {
      onChange({ ...scalars, [key]: value });
    },
    [scalars, onChange],
  );

  const handleColor = useCallback(
    (key: 'baseColor' | 'emissiveColor', value: string) => {
      onChange({ ...scalars, [key]: value });
    },
    [scalars, onChange],
  );

  return (
    <div className="material-tuner">
      <div className="panel-header">Tune Material</div>
      <div className="tuner-body">
        {SLIDERS.map(({ key, label, min, max, step }) => {
          const value = scalars[key] as number;
          return (
            <label key={key} className="tuner-row">
              <span className="tuner-label">{label}</span>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                disabled={disabled}
                onChange={(e) => handleSlider(key, parseFloat(e.target.value))}
              />
              <span className="tuner-value">{value.toFixed(2)}</span>
            </label>
          );
        })}

        {/* Color pickers */}
        <label className="tuner-row">
          <span className="tuner-label">Base Color</span>
          <input
            type="color"
            className="tuner-color"
            value={scalars.baseColor ?? '#6699cc'}
            disabled={disabled}
            onChange={(e) => handleColor('baseColor', e.target.value)}
          />
        </label>
        <label className="tuner-row">
          <span className="tuner-label">Emissive Color</span>
          <input
            type="color"
            className="tuner-color"
            value={scalars.emissiveColor ?? '#000000'}
            disabled={disabled}
            onChange={(e) => handleColor('emissiveColor', e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
