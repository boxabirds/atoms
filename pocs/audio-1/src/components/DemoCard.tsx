import { useCallback, useEffect, useRef, useState } from "react";
import { AudioController, P_ACTIVE, P_GAIN } from "../audio/controller";
import { DemoConfig, ParamDef } from "../demos";

interface DemoCardProps {
  demo: DemoConfig;
  controller: AudioController | null;
}

const DEFAULT_GAIN = 0.6;
const METER_UPDATE_INTERVAL_MS = 50;

export function DemoCard({ demo, controller }: DemoCardProps) {
  const [active, setActive] = useState(false);
  const [paramValues, setParamValues] = useState<Record<number, number>>(() => {
    const initial: Record<number, number> = {};
    for (const p of demo.params) {
      initial[p.paramIndex] = p.defaultValue;
    }
    return initial;
  });
  const [rms, setRms] = useState(0);
  const meterRef = useRef<number>(0);

  // Push params to SAB whenever they change
  useEffect(() => {
    if (!controller) return;
    controller.setParam(demo.index, P_ACTIVE, active ? 1.0 : 0.0);
    controller.setParam(demo.index, P_GAIN, active ? DEFAULT_GAIN : 0.0);
    for (const [idx, val] of Object.entries(paramValues)) {
      controller.setParam(demo.index, Number(idx), val);
    }
  }, [controller, demo.index, active, paramValues]);

  // Telemetry polling
  useEffect(() => {
    if (!active || !controller) {
      setRms(0);
      return;
    }
    const interval = setInterval(() => {
      const tel = controller.readTelemetry(demo.index);
      setRms(tel.rms);
    }, METER_UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [active, controller, demo.index]);

  const toggle = useCallback(async () => {
    if (!controller) return;
    try {
      await controller.resume();
      setActive((prev) => !prev);
    } catch (err) {
      console.error("Audio resume failed:", err);
    }
  }, [controller]);

  const handleParamChange = useCallback(
    (param: ParamDef, value: number) => {
      setParamValues((prev) => ({ ...prev, [param.paramIndex]: value }));
    },
    []
  );

  const meterWidth = Math.min(rms * 400, 100);

  return (
    <div
      className="demo-card"
      style={{ "--accent": demo.color } as React.CSSProperties}
    >
      <div className="demo-header">
        <div className="demo-titles">
          <h2 className="demo-title">{demo.title}</h2>
          <span className="demo-subtitle">{demo.subtitle}</span>
        </div>
        <button
          className={`demo-toggle ${active ? "active" : ""}`}
          onClick={toggle}
          aria-label={active ? "Stop" : "Start"}
        >
          {active ? "Stop" : "Start"}
        </button>
      </div>

      <p className="demo-description">{demo.description}</p>
      <details className="demo-why">
        <summary>Why this is interesting</summary>
        <p>{demo.whyInteresting}</p>
      </details>

      {/* Level meter */}
      <div className="demo-meter">
        <div
          className="demo-meter-fill"
          style={{ width: `${meterWidth}%` }}
        />
      </div>

      {/* Parameter sliders */}
      <div className="demo-params">
        {demo.params.map((param) => (
          <div key={param.paramIndex} className="demo-param">
            <label className="demo-param-label">
              <span>{param.label}</span>
              <span className="demo-param-value">
                {(paramValues[param.paramIndex] ?? param.defaultValue).toFixed(2)}
              </span>
            </label>
            <input
              type="range"
              min={param.min}
              max={param.max}
              step={param.step ?? 0.01}
              value={paramValues[param.paramIndex] ?? param.defaultValue}
              onChange={(e) => handleParamChange(param, Number(e.target.value))}
              className="demo-slider"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
