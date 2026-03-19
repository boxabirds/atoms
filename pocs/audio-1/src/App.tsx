import { useCallback, useEffect, useRef, useState } from "react";
import { AudioController, AudioControllerState } from "./audio/controller";
import { ConvolutionMatrix } from "./components/ConvolutionMatrix";
import { DemoCard } from "./components/DemoCard";
import { DEMOS } from "./demos";

const DEFAULT_MASTER_VOLUME = 0.7;

export function App() {
  const controllerRef = useRef<AudioController | null>(null);
  const [masterVolume, setMasterVolume] = useState(DEFAULT_MASTER_VOLUME);
  const [audioState, setAudioState] = useState<AudioControllerState>({
    initialized: false,
    ready: false,
    failed: null,
  });

  useEffect(() => {
    const ctrl = new AudioController(setAudioState);
    controllerRef.current = ctrl;

    // Pre-initialize on mount (audio won't play until user clicks)
    ctrl.ensureInitialized().catch(() => {
      // State will be reported via callback
    });

    return () => {
      ctrl.destroy();
      controllerRef.current = null;
    };
  }, []);

  const handleMasterVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setMasterVolume(val);
    controllerRef.current?.setMasterVolume(val);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Synthesis Gallery</h1>
        <p className="app-subtitle">
          Rust DSP compiled to WASM, running in AudioWorklet with SharedArrayBuffer parameter control
        </p>
        {audioState.failed && (
          <div className="app-error">
            Audio failed: {audioState.failed}
          </div>
        )}
        {!audioState.ready && !audioState.failed && (
          <div className="app-loading">Initializing audio engine...</div>
        )}
        <div className="master-volume">
          <label className="master-volume-label">
            <span>Master Volume</span>
            <span>{Math.round(masterVolume * 100)}%</span>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={masterVolume}
            onChange={handleMasterVolume}
            className="master-volume-slider"
          />
        </div>
      </header>

      <div className="demo-grid">
        {DEMOS.map((demo) => (
          <DemoCard
            key={demo.index}
            demo={demo}
            controller={controllerRef.current}
          />
        ))}
      </div>

      <ConvolutionMatrix controller={controllerRef.current} />
    </div>
  );
}
