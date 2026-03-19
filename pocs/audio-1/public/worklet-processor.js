/**
 * AudioWorklet processor for the synthesis gallery.
 *
 * Loaded via audioWorklet.addModule() — runs in a separate JS context.
 * Receives a pre-compiled WASM module + SharedArrayBuffer from the main thread.
 * Each render block: reads params from SAB, calls WASM render for each active demo,
 * writes audio output + telemetry back to SAB.
 */

import init, {
  init_engine,
  set_param,
  render_demo,
  get_output_ptr,
  get_output_len,
  get_rms,
  get_peak,
  get_matrix_wavetable_ptr,
  set_matrix_wavetable_len,
  trigger_matrix,
} from "./wasm/synth_gallery_dsp.js";

const CHANNELS = 2;
const BLOCK_FRAMES = 128;
const PARAMS_PER_DEMO = 20;
const MAX_DEMOS = 8;

// Telemetry output slots within each demo's param block
const P_RMS_OUT = 16;
const P_PEAK_OUT = 17;

class SynthGalleryProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const { wasmModule, sab } = options.processorOptions || {};

    this.engineReady = false;
    this.wasmExports = null;
    this.outputView = null;
    this.outputPtr = 0;
    this.outputLen = 0;

    // SharedArrayBuffer view for parameter passing
    this.sabFloat32 = sab ? new Float32Array(sab) : null;

    this.port.onmessage = (event) => {
      if (!this.engineReady) return;
      const msg = event.data;
      if (msg.type === "upload-wavetable") {
        const data = msg.data;
        const ptr = get_matrix_wavetable_ptr();
        const view = new Float32Array(
          this.wasmExports.memory.buffer,
          ptr,
          data.length
        );
        view.set(data);
        set_matrix_wavetable_len(data.length);
      } else if (msg.type === "retrigger-matrix") {
        trigger_matrix();
      }
    };

    this.initEngine(wasmModule);
  }

  async initEngine(wasmModule) {
    try {
      this.wasmExports = await init({ module_or_path: wasmModule });
      init_engine(sampleRate);
      this.outputPtr = get_output_ptr();
      this.outputLen = get_output_len();
      this.outputView = new Float32Array(
        this.wasmExports.memory.buffer,
        this.outputPtr,
        this.outputLen
      );
      this.engineReady = true;
      this.port.postMessage({ type: "ready", sampleRate, blockFrames: BLOCK_FRAMES });
    } catch (error) {
      this.port.postMessage({ type: "error", message: String(error) });
    }
  }

  ensureOutputView() {
    if (
      !this.outputView ||
      this.outputView.buffer !== this.wasmExports.memory.buffer
    ) {
      this.outputView = new Float32Array(
        this.wasmExports.memory.buffer,
        this.outputPtr,
        this.outputLen
      );
    }
    return this.outputView;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || !this.engineReady) {
      if (output) {
        for (const channel of output) channel.fill(0);
      }
      return true;
    }

    const left = output[0];
    const right = output[1] || output[0];
    left.fill(0);
    right.fill(0);

    // For each demo: read params from SAB, push to WASM, render if active
    for (let demo = 0; demo < MAX_DEMOS; demo++) {
      const base = demo * PARAMS_PER_DEMO;
      if (!this.sabFloat32) continue;

      const active = this.sabFloat32[base]; // P_ACTIVE at offset 0

      // Push all params to WASM engine
      for (let p = 0; p < PARAMS_PER_DEMO; p++) {
        set_param(demo, p, this.sabFloat32[base + p]);
      }

      if (active < 0.5) continue;

      render_demo(demo);
      const blockBuffer = this.ensureOutputView();
      const frameCount = Math.min(left.length, BLOCK_FRAMES);

      // Additive mix into output (multiple demos can play simultaneously)
      for (let i = 0; i < frameCount; i++) {
        left[i] += blockBuffer[i * CHANNELS];
        right[i] += blockBuffer[i * CHANNELS + 1];
      }

      // Write telemetry back to SAB for main thread to read
      this.sabFloat32[base + P_RMS_OUT] = get_rms(demo);
      this.sabFloat32[base + P_PEAK_OUT] = get_peak(demo);
    }

    // Soft clip to prevent harsh clipping when multiple demos play
    for (let i = 0; i < left.length; i++) {
      left[i] = Math.tanh(left[i]);
      right[i] = Math.tanh(right[i]);
    }

    return true;
  }
}

registerProcessor("synth-gallery-processor", SynthGalleryProcessor);
