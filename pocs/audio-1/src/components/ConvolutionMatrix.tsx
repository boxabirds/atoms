import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { AudioController, P_ACTIVE, P_GAIN, P_PARAM_A, P_PARAM_B, P_PARAM_C } from "../audio/controller";

// ─── Matrix configuration ──────────────────────────────────────────────────

interface SampleDef {
  label: string;
  shortLabel: string;
  file: string;
  description: string;
}

const EXCITATIONS: SampleDef[] = [
  { label: "Anvil Strike", shortLabel: "Anvil", file: "/samples/excitations/anvil-strike.wav", description: "Steel hammer on hot anvil" },
  { label: "Relay Click", shortLabel: "Relay", file: "/samples/excitations/relay-click-01.wav", description: "Electrical relay snap" },
  { label: "Bubble Pop", shortLabel: "Bubble", file: "/samples/excitations/bubble-pop.wav", description: "Single air bubble burst" },
  { label: "Hammer Hit", shortLabel: "Hammer", file: "/samples/excitations/hammer-anvil-hit-01.wav", description: "Metal hammer impact" },
  { label: "Spring Twang", shortLabel: "Spring", file: "/samples/excitations/door-stop-twang-01.wav", description: "Door stop spring release" },
  { label: "Air Hiss", shortLabel: "Air", file: "/samples/excitations/air-hiss-01.wav", description: "Pressurised air burst" },
];

const BODIES: SampleDef[] = [
  { label: "Metal Bar", shortLabel: "Bar", file: "/samples/bodies/metal-bar-resonance-01.wav", description: "Struck metal bar resonance" },
  { label: "Metal Tube", shortLabel: "Tube", file: "/samples/bodies/metal-tube-clear-01.wav", description: "Hollow pipe resonance" },
  { label: "Glass", shortLabel: "Glass", file: "/samples/bodies/glass-resonance-01.wav", description: "Wine glass modal ring" },
  { label: "Wine Glass", shortLabel: "Wine", file: "/samples/bodies/wine-glass-ring-01.wav", description: "Thin crystal resonance" },
  { label: "Tubular Bell", shortLabel: "Bell", file: "/samples/bodies/tubular-bell-strike-01.wav", description: "Large tubular bell decay" },
];

const TOTAL_COMBINATIONS = EXCITATIONS.length * BODIES.length;
const MATRIX_DEMO_INDEX = 7;
const COMMUTED_EXCITATION_SAMPLES = 16384;
const COMMUTED_FADE_SAMPLES = 512;
const PLAYBACK_INDICATOR_MS = 3000;
const DEFAULT_PITCH = 0.3;
const DEFAULT_BRIGHTNESS = 0.6;
const DEFAULT_DECAY = 0.5;
const DEFAULT_MATRIX_GAIN = 0.6;
const NORMALIZE_PEAK = 0.5;
const NORMALIZE_FLOOR = 0.001;

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchAudioBuffer(
  ctx: AudioContext,
  url: string
): Promise<AudioBuffer> {
  const response = await fetch(url);
  const arrayBuf = await response.arrayBuffer();
  return ctx.decodeAudioData(arrayBuf);
}

function cellKey(row: number, col: number): string {
  return `${row}-${col}`;
}

/**
 * Pre-convolve excitation × body IR offline, truncate to a compact
 * wavetable for waveguide excitation (commuted synthesis).
 */
async function preConvolve(
  excitation: AudioBuffer,
  bodyIR: AudioBuffer
): Promise<Float32Array> {
  const fullLength = excitation.length + bodyIR.length - 1;
  const sr = excitation.sampleRate;

  const offline = new OfflineAudioContext(1, fullLength, sr);
  const source = offline.createBufferSource();
  source.buffer = excitation;
  const convolver = new ConvolverNode(offline, { buffer: bodyIR });
  source.connect(convolver);
  convolver.connect(offline.destination);
  source.start();

  const rendered = await offline.startRendering();

  // Truncate — the waveguide handles sustain
  const fullData = rendered.getChannelData(0);
  const len = Math.min(fullData.length, COMMUTED_EXCITATION_SAMPLES);
  const data = new Float32Array(len);
  data.set(fullData.subarray(0, len));

  // Cosine fade-out at truncation boundary
  const fadeLen = Math.min(COMMUTED_FADE_SAMPLES, len);
  for (let i = 0; i < fadeLen; i++) {
    const t = i / fadeLen;
    data[len - fadeLen + i] *= 0.5 * (1 + Math.cos(Math.PI * t));
  }

  // Normalize
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
  }
  if (peak > NORMALIZE_FLOOR) {
    const scale = NORMALIZE_PEAK / peak;
    for (let i = 0; i < len; i++) {
      data[i] *= scale;
    }
  }

  return data;
}

// ─── Component ──────────────────────────────────────────────────────────────

interface ConvolutionMatrixProps {
  controller: AudioController | null;
}

export function ConvolutionMatrix({ controller }: ConvolutionMatrixProps) {
  const decodeCtxRef = useRef<AudioContext | null>(null);
  const excitationBuffers = useRef<Map<string, AudioBuffer>>(new Map());
  const bodyBuffers = useRef<Map<string, AudioBuffer>>(new Map());
  const convolutionCache = useRef<Map<string, Float32Array>>(new Map());
  const lastUploadedKey = useRef<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playingCell, setPlayingCell] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const [pitch, setPitch] = useState(DEFAULT_PITCH);
  const [brightness, setBrightness] = useState(DEFAULT_BRIGHTNESS);
  const [decay, setDecay] = useState(DEFAULT_DECAY);

  // Load samples for offline pre-convolution
  useEffect(() => {
    let cancelled = false;

    async function loadSamples() {
      try {
        const ctx = new AudioContext();
        decodeCtxRef.current = ctx;

        const excLoads = EXCITATIONS.map(async (ex) => {
          const buf = await fetchAudioBuffer(ctx, ex.file);
          excitationBuffers.current.set(ex.file, buf);
        });

        const bodyLoads = BODIES.map(async (body) => {
          const buf = await fetchAudioBuffer(ctx, body.file);
          bodyBuffers.current.set(body.file, buf);
        });

        await Promise.all([...excLoads, ...bodyLoads]);
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setLoadError(String(err));
          setLoading(false);
        }
      }
    }

    loadSamples();
    return () => { cancelled = true; };
  }, []);

  // Cleanup decode context
  useEffect(() => {
    return () => { decodeCtxRef.current?.close(); };
  }, []);

  // Sync waveguide params to SAB
  useEffect(() => {
    if (!controller) return;
    controller.setParam(MATRIX_DEMO_INDEX, P_PARAM_A, pitch);
    controller.setParam(MATRIX_DEMO_INDEX, P_PARAM_B, brightness);
    controller.setParam(MATRIX_DEMO_INDEX, P_PARAM_C, decay);
  }, [controller, pitch, brightness, decay]);

  const playConvolution = useCallback(
    async (rowIdx: number, colIdx: number) => {
      if (!controller) return;
      try {
        await controller.resume();
      } catch {
        return;
      }

      const key = cellKey(rowIdx, colIdx);
      const cacheKey = `${EXCITATIONS[rowIdx].file}|${BODIES[colIdx].file}`;

      // Get or compute pre-convolved wavetable
      let wavetable = convolutionCache.current.get(cacheKey);
      if (!wavetable) {
        const exc = excitationBuffers.current.get(EXCITATIONS[rowIdx].file);
        const body = bodyBuffers.current.get(BODIES[colIdx].file);
        if (!exc || !body) return;
        wavetable = await preConvolve(exc, body);
        convolutionCache.current.set(cacheKey, wavetable);
      }

      // Activate demo 7
      controller.setParam(MATRIX_DEMO_INDEX, P_ACTIVE, 1.0);
      controller.setParam(MATRIX_DEMO_INDEX, P_GAIN, DEFAULT_MATRIX_GAIN);

      // Upload or re-trigger
      if (lastUploadedKey.current === cacheKey) {
        controller.retriggerMatrix();
      } else {
        controller.uploadMatrixWavetable(wavetable);
        lastUploadedKey.current = cacheKey;
      }

      setPlayingCell(key);
      setTimeout(() => {
        setPlayingCell((current) => (current === key ? null : current));
      }, PLAYBACK_INDICATOR_MS);
    },
    [controller]
  );

  // Derive hovered/playing row/col for highlighting
  const hoveredRow = hoveredCell ? parseInt(hoveredCell.split("-")[0]) : null;
  const hoveredCol = hoveredCell ? parseInt(hoveredCell.split("-")[1]) : null;
  const playingRow = playingCell ? parseInt(playingCell.split("-")[0]) : null;
  const playingCol = playingCell ? parseInt(playingCell.split("-")[1]) : null;

  const activeRow = playingRow ?? hoveredRow;
  const activeCol = playingCol ?? hoveredCol;

  return (
    <section className="cm-section">
      {/* Header */}
      <div className="cm-header">
        <h2 className="cm-title">What hits what?</h2>
        <p className="cm-lead">
          Pick an <strong>energy source</strong> (left) and a{" "}
          <strong>resonant body</strong> (top). The excitation is pre-convolved
          with the body impulse response, then fed through a{" "}
          <strong>delay-line waveguide</strong> in WASM &mdash; true commuted
          synthesis at 5&ndash;10 ops/sample. {TOTAL_COMBINATIONS} unique
          instruments from {EXCITATIONS.length + BODIES.length} recordings.
        </p>
      </div>

      {/* How it works */}
      <div className="cm-explainer">
        <div className="cm-explainer-step">
          <div className="cm-explainer-num">1</div>
          <div>
            <strong>Pre-convolve</strong>
            <span className="cm-explainer-detail">
              Excitation &times; body impulse response, computed once offline.
              Captures the resonant character in a compact wavetable.
            </span>
          </div>
        </div>
        <div className="cm-explainer-arrow">&rarr;</div>
        <div className="cm-explainer-step">
          <div className="cm-explainer-num">2</div>
          <div>
            <strong>Waveguide</strong>
            <span className="cm-explainer-detail">
              Delay line + one-pole loop filter running in Rust/WASM.
              Pitch, brightness, and decay at ~10 ops/sample.
            </span>
          </div>
        </div>
        <div className="cm-explainer-arrow">=</div>
        <div className="cm-explainer-step">
          <div className="cm-explainer-num">3</div>
          <div>
            <strong>Living instrument</strong>
            <span className="cm-explainer-detail">
              The body&rsquo;s resonance is applied once; the waveguide sustains
              it with real-time controllable pitch, brightness, and decay.
            </span>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="cm-error">Failed to load samples: {loadError}</div>
      )}

      {loading && !loadError && (
        <div className="cm-loading">
          Loading {EXCITATIONS.length + BODIES.length} samples...
        </div>
      )}

      {/* Waveguide controls */}
      <div className="cm-waveguide-params">
        <div className="cm-waveguide-param">
          <label className="cm-waveguide-label">
            <span>Pitch</span>
            <span className="cm-waveguide-value">
              {Math.round(50 + pitch * 500)} Hz
            </span>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={pitch}
            onChange={(e) => setPitch(Number(e.target.value))}
            className="cm-waveguide-slider"
          />
        </div>
        <div className="cm-waveguide-param">
          <label className="cm-waveguide-label">
            <span>Brightness</span>
            <span className="cm-waveguide-value">
              {Math.round(brightness * 100)}%
            </span>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={brightness}
            onChange={(e) => setBrightness(Number(e.target.value))}
            className="cm-waveguide-slider"
          />
        </div>
        <div className="cm-waveguide-param">
          <label className="cm-waveguide-label">
            <span>Decay</span>
            <span className="cm-waveguide-value">
              {Math.round(decay * 100)}%
            </span>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={decay}
            onChange={(e) => setDecay(Number(e.target.value))}
            className="cm-waveguide-slider"
          />
        </div>
      </div>

      {/* Selection readout */}
      <div className="cm-readout">
        {activeRow !== null && activeCol !== null ? (
          <>
            <span className="cm-readout-excitation">
              {EXCITATIONS[activeRow].label}
            </span>
            <span className="cm-readout-through">through</span>
            <span className="cm-readout-body">{BODIES[activeCol].label}</span>
          </>
        ) : (
          <span className="cm-readout-hint">
            Hover or click a cell to hear a combination
          </span>
        )}
      </div>

      {/* Grid */}
      <div className="cm-grid-wrapper">
        <div
          className="cm-grid"
          style={{
            gridTemplateColumns: `140px repeat(${BODIES.length}, 1fr)`,
          }}
        >
          <div className="cm-corner">
            <span className="cm-corner-body">Body &rarr;</span>
            <span className="cm-corner-excitation">&darr; Excitation</span>
          </div>

          {BODIES.map((body, ci) => (
            <div
              key={ci}
              className={`cm-col-label ${activeCol === ci ? "active" : ""}`}
            >
              <span className="cm-col-label-name">{body.shortLabel}</span>
              <span className="cm-col-label-desc">{body.description}</span>
            </div>
          ))}

          {EXCITATIONS.map((ex, ri) => (
            <Fragment key={ri}>
              <div
                className={`cm-row-label ${activeRow === ri ? "active" : ""}`}
              >
                <span className="cm-row-label-name">{ex.shortLabel}</span>
                <span className="cm-row-label-desc">{ex.description}</span>
              </div>

              {BODIES.map((_body, ci) => {
                const key = cellKey(ri, ci);
                const isPlaying = playingCell === key;
                return (
                  <button
                    key={key}
                    className={`cm-cell ${isPlaying ? "playing" : ""}`}
                    onClick={() => playConvolution(ri, ci)}
                    onMouseEnter={() => setHoveredCell(key)}
                    onMouseLeave={() => setHoveredCell(null)}
                    disabled={loading}
                    aria-label={`${ex.label} through ${BODIES[ci].label}`}
                  >
                    {isPlaying ? (
                      <span className="cm-cell-playing-icon" />
                    ) : (
                      <span className="cm-cell-idle-icon" />
                    )}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <p className="cm-footnote">
        True <em>commuted synthesis</em> (Julius Smith): the expensive body
        response is applied once via offline convolution, producing a compact
        wavetable. A cheap delay-line waveguide (5&ndash;10 ops/sample) then
        provides pitched sustain with controllable brightness and decay. The
        entire runtime DSP runs in Rust/WASM inside an AudioWorklet &mdash; no
        Web Audio <code>ConvolverNode</code> in the real-time playback path.
      </p>
    </section>
  );
}
