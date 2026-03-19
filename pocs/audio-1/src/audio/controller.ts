/**
 * Main-thread audio controller.
 * Manages AudioContext, WASM loading, worklet instantiation, and SAB parameter passing.
 */

const PARAMS_PER_DEMO = 20;
const MAX_DEMOS = 8;
const SAB_TOTAL_FLOATS = PARAMS_PER_DEMO * MAX_DEMOS;
const SAB_BYTES = SAB_TOTAL_FLOATS * Float32Array.BYTES_PER_ELEMENT;

// Parameter slot indices — must match lib.rs
export const P_ACTIVE = 0;
export const P_GAIN = 1;
export const P_PARAM_A = 2;
export const P_PARAM_B = 3;
export const P_PARAM_C = 4;
export const P_PARAM_D = 5;
export const P_PARAM_E = 6;
export const P_PARAM_F = 7;
export const P_RMS_OUT = 16;
export const P_PEAK_OUT = 17;

export interface AudioControllerState {
  initialized: boolean;
  ready: boolean;
  failed: string | null;
}

export type StateCallback = (state: AudioControllerState) => void;

export class AudioController {
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private master: GainNode | null = null;
  private sabFloat32: Float32Array | null = null;
  private initPromise: Promise<void> | null = null;

  ready = false;
  failed: string | null = null;

  constructor(private onStateChange: StateCallback = () => {}) {}

  private report() {
    this.onStateChange({
      initialized: Boolean(this.context),
      ready: this.ready,
      failed: this.failed,
    });
  }

  async ensureInitialized(): Promise<void> {
    if (this.failed) throw new Error(this.failed);
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initialize();
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    if (typeof SharedArrayBuffer === "undefined") {
      this.failed =
        "SharedArrayBuffer not available. Ensure COOP/COEP headers are set.";
      this.report();
      throw new Error(this.failed);
    }

    // Load WASM module from public/wasm/
    const wasmUrl = new URL("/wasm/synth_gallery_dsp_bg.wasm", window.location.origin);

    let wasmModule: WebAssembly.Module;
    try {
      const response = await fetch(wasmUrl);
      wasmModule = await WebAssembly.compileStreaming(response);
    } catch {
      const response = await fetch(wasmUrl);
      const bytes = await response.arrayBuffer();
      wasmModule = await WebAssembly.compile(bytes);
    }

    // Create AudioContext
    this.context = new AudioContext({ latencyHint: "interactive" });

    // SharedArrayBuffer for real-time parameter passing
    const sab = new SharedArrayBuffer(SAB_BYTES);
    this.sabFloat32 = new Float32Array(sab);

    // Load worklet processor from public/
    await this.context.audioWorklet.addModule("/worklet-processor.js");

    // Create worklet node
    this.node = new AudioWorkletNode(this.context, "synth-gallery-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasmModule, sab },
    });

    // Gain and compression for output
    this.master = new GainNode(this.context, { gain: 0.7 });
    const compressor = new DynamicsCompressorNode(this.context, {
      threshold: -18,
      knee: 10,
      ratio: 4,
      attack: 0.003,
      release: 0.18,
    });

    this.node.connect(compressor);
    compressor.connect(this.master);
    this.master.connect(this.context.destination);

    this.node.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === "ready") {
        this.ready = true;
        this.report();
      } else if (msg.type === "error") {
        this.failed = msg.message;
        this.report();
      }
    };

    this.report();
  }

  async resume(): Promise<void> {
    await this.ensureInitialized();
    if (this.context?.state === "suspended") {
      await this.context.resume();
    }
  }

  /** Set a parameter for a demo. Writes directly to SharedArrayBuffer. */
  setParam(demoIndex: number, paramIndex: number, value: number): void {
    if (!this.sabFloat32) return;
    const idx = demoIndex * PARAMS_PER_DEMO + paramIndex;
    if (idx < SAB_TOTAL_FLOATS) {
      this.sabFloat32[idx] = value;
    }
  }

  /** Read telemetry for a demo from SharedArrayBuffer. */
  readTelemetry(demoIndex: number): { rms: number; peak: number } {
    if (!this.sabFloat32) return { rms: 0, peak: 0 };
    const base = demoIndex * PARAMS_PER_DEMO;
    return {
      rms: this.sabFloat32[base + P_RMS_OUT],
      peak: this.sabFloat32[base + P_PEAK_OUT],
    };
  }

  /** Set master volume (0..1). */
  setMasterVolume(value: number): void {
    if (this.master) {
      this.master.gain.value = value;
    }
  }

  /** Upload a pre-convolved wavetable to the WASM matrix synth (auto-triggers). */
  uploadMatrixWavetable(data: Float32Array): void {
    if (!this.node) return;
    this.node.port.postMessage({ type: "upload-wavetable", data });
  }

  /** Re-trigger the matrix waveguide with the already-uploaded wavetable. */
  retriggerMatrix(): void {
    if (!this.node) return;
    this.node.port.postMessage({ type: "retrigger-matrix" });
  }

  destroy(): void {
    this.node?.disconnect();
    this.master?.disconnect();
    this.context?.close();
    this.context = null;
    this.node = null;
    this.master = null;
  }
}
