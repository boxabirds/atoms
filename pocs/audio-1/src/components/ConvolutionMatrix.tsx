import { Fragment, useCallback, useEffect, useRef, useState } from "react";

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

const CELL_FADE_DURATION_MS = 600;
const TOTAL_COMBINATIONS = EXCITATIONS.length * BODIES.length;

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

const FADE_OUT_SAMPLES = 128;

/** Render the full convolution offline so the IR tail rings out completely. */
async function renderConvolution(
  excitation: AudioBuffer,
  bodyIR: AudioBuffer
): Promise<AudioBuffer> {
  const channels = Math.max(excitation.numberOfChannels, bodyIR.numberOfChannels);
  // Convolution output length = excitation + IR - 1
  const length = excitation.length + bodyIR.length - 1;
  const sr = excitation.sampleRate;

  const offline = new OfflineAudioContext(channels, length, sr);
  const source = offline.createBufferSource();
  source.buffer = excitation;
  const convolver = new ConvolverNode(offline, { buffer: bodyIR });
  source.connect(convolver);
  convolver.connect(offline.destination);
  source.start();

  const rendered = await offline.startRendering();

  // Apply a short fade-out to the end to avoid any click at the tail
  const fadeLen = Math.min(FADE_OUT_SAMPLES, rendered.length);
  for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
    const data = rendered.getChannelData(ch);
    for (let i = 0; i < fadeLen; i++) {
      data[rendered.length - fadeLen + i] *= 1 - i / fadeLen;
    }
  }

  return rendered;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ConvolutionMatrix() {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const excitationBuffers = useRef<Map<string, AudioBuffer>>(new Map());
  const bodyBuffers = useRef<Map<string, AudioBuffer>>(new Map());
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playingCell, setPlayingCell] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  // Lazy-init AudioContext
  const ensureContext = useCallback(async (): Promise<AudioContext> => {
    if (ctxRef.current && ctxRef.current.state !== "closed") {
      if (ctxRef.current.state === "suspended") {
        await ctxRef.current.resume();
      }
      return ctxRef.current;
    }

    const ctx = new AudioContext({ latencyHint: "interactive" });
    ctxRef.current = ctx;

    const master = new GainNode(ctx, { gain: 0.8 });
    const compressor = new DynamicsCompressorNode(ctx, {
      threshold: -18,
      knee: 10,
      ratio: 4,
      attack: 0.003,
      release: 0.18,
    });
    master.connect(compressor);
    compressor.connect(ctx.destination);
    masterRef.current = master;

    return ctx;
  }, []);

  // Load all samples on mount
  useEffect(() => {
    let cancelled = false;

    async function loadSamples() {
      try {
        const ctx = await ensureContext();

        const excitationLoads = EXCITATIONS.map(async (ex) => {
          const buf = await fetchAudioBuffer(ctx, ex.file);
          excitationBuffers.current.set(ex.file, buf);
        });

        const bodyLoads = BODIES.map(async (body) => {
          const buf = await fetchAudioBuffer(ctx, body.file);
          bodyBuffers.current.set(body.file, buf);
        });

        await Promise.all([...excitationLoads, ...bodyLoads]);

        if (!cancelled) {
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(String(err));
          setLoading(false);
        }
      }
    }

    loadSamples();
    return () => {
      cancelled = true;
    };
  }, [ensureContext]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeSourceRef.current?.stop();
      ctxRef.current?.close();
    };
  }, []);

  const playConvolution = useCallback(
    async (rowIdx: number, colIdx: number) => {
      const ctx = await ensureContext();
      const master = masterRef.current;
      if (!ctx || !master) return;

      // Stop any currently playing sound
      if (activeSourceRef.current) {
        try {
          activeSourceRef.current.stop();
        } catch {
          // Already stopped
        }
        activeSourceRef.current = null;
      }

      const key = cellKey(rowIdx, colIdx);
      const excitation = excitationBuffers.current.get(EXCITATIONS[rowIdx].file);
      const bodyIR = bodyBuffers.current.get(BODIES[colIdx].file);

      if (!excitation || !bodyIR) return;

      // Render full convolution offline (includes the complete IR tail)
      const convolved = await renderConvolution(excitation, bodyIR);

      const source = ctx.createBufferSource();
      source.buffer = convolved;
      source.connect(master);

      source.onended = () => {
        setPlayingCell((current) => (current === key ? null : current));
        source.disconnect();
        if (activeSourceRef.current === source) {
          activeSourceRef.current = null;
        }
      };

      activeSourceRef.current = source;
      setPlayingCell(key);
      source.start();
    },
    [ensureContext]
  );

  // Derive hovered row/col for highlighting
  const hoveredRow = hoveredCell ? parseInt(hoveredCell.split("-")[0]) : null;
  const hoveredCol = hoveredCell ? parseInt(hoveredCell.split("-")[1]) : null;
  const playingRow = playingCell ? parseInt(playingCell.split("-")[0]) : null;
  const playingCol = playingCell ? parseInt(playingCell.split("-")[1]) : null;

  // Active row/col for label highlighting (playing takes precedence over hover)
  const activeRow = playingRow ?? hoveredRow;
  const activeCol = playingCol ?? hoveredCol;

  return (
    <section className="cm-section">
      {/* ─── Header ─── */}
      <div className="cm-header">
        <h2 className="cm-title">What hits what?</h2>
        <p className="cm-lead">
          Pick an <strong>energy source</strong> (left) and a <strong>resonant body</strong> (top).
          The browser convolves them in real time &mdash; {TOTAL_COMBINATIONS} unique instruments from {EXCITATIONS.length + BODIES.length} recordings.
        </p>
      </div>

      {/* ─── How it works ─── */}
      <div className="cm-explainer">
        <div className="cm-explainer-step">
          <div className="cm-explainer-num">1</div>
          <div>
            <strong>Excitation</strong>
            <span className="cm-explainer-detail">A short transient — a strike, click, pop, or hiss. This is the energy entering the system.</span>
          </div>
        </div>
        <div className="cm-explainer-arrow">&times;</div>
        <div className="cm-explainer-step">
          <div className="cm-explainer-num">2</div>
          <div>
            <strong>Body impulse response</strong>
            <span className="cm-explainer-detail">The resonant character of a physical object — its modes, decay, and timbre captured as a recording.</span>
          </div>
        </div>
        <div className="cm-explainer-arrow">=</div>
        <div className="cm-explainer-step">
          <div className="cm-explainer-num">3</div>
          <div>
            <strong>New instrument</strong>
            <span className="cm-explainer-detail">Convolution merges them: the excitation's energy excites the body's resonances. 5-10 ops/sample.</span>
          </div>
        </div>
      </div>

      {loadError && (
        <div className="cm-error">
          Failed to load samples: {loadError}
        </div>
      )}

      {loading && !loadError && (
        <div className="cm-loading">Loading {EXCITATIONS.length + BODIES.length} samples...</div>
      )}

      {/* ─── Current selection readout ─── */}
      <div className="cm-readout">
        {activeRow !== null && activeCol !== null ? (
          <>
            <span className="cm-readout-excitation">{EXCITATIONS[activeRow].label}</span>
            <span className="cm-readout-through">through</span>
            <span className="cm-readout-body">{BODIES[activeCol].label}</span>
          </>
        ) : (
          <span className="cm-readout-hint">Hover or click a cell to hear a combination</span>
        )}
      </div>

      {/* ─── Grid ─── */}
      <div className="cm-grid-wrapper">
        <div
          className="cm-grid"
          style={{
            gridTemplateColumns: `140px repeat(${BODIES.length}, 1fr)`,
          }}
        >
          {/* Corner: axis labels */}
          <div className="cm-corner">
            <span className="cm-corner-body">Body &rarr;</span>
            <span className="cm-corner-excitation">&darr; Excitation</span>
          </div>

          {/* Column headers */}
          {BODIES.map((body, ci) => (
            <div
              key={ci}
              className={`cm-col-label ${activeCol === ci ? "active" : ""}`}
            >
              <span className="cm-col-label-name">{body.shortLabel}</span>
              <span className="cm-col-label-desc">{body.description}</span>
            </div>
          ))}

          {/* Rows */}
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
                    style={
                      {
                        "--fade-duration": `${CELL_FADE_DURATION_MS}ms`,
                      } as React.CSSProperties
                    }
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
        Uses the Web Audio <code>ConvolverNode</code> — the same convolution that
        runs reverb in DAWs. Each combination is generated live, not pre-rendered.
        This is the core of Julius Smith&apos;s <em>commuted synthesis</em>: the
        most expensive part of a physical model (the resonant body) collapses into
        a single pre-recorded impulse response.
      </p>
    </section>
  );
}
