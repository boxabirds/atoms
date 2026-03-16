import { P_PARAM_A, P_PARAM_B, P_PARAM_C, P_PARAM_D, P_PARAM_E } from "./audio/controller";

export interface ParamDef {
  label: string;
  paramIndex: number;
  min: number;
  max: number;
  defaultValue: number;
  step?: number;
}

export interface DemoConfig {
  index: number;
  title: string;
  subtitle: string;
  description: string;
  color: string;
  params: ParamDef[];
}

export const DEMOS: DemoConfig[] = [
  {
    index: 0,
    title: "IFFT Additive",
    subtitle: "Overlap-Add IFFT",
    description:
      "Replaces oscillator banks with a single inverse FFT per block. " +
      "512 partials cost ~10K ops per 128-sample block versus 65K for individual oscillators. " +
      "Deterministic partials and stochastic noise merge in a single spectral pass.",
    color: "#3b82f6",
    params: [
      { label: "Fundamental Hz", paramIndex: P_PARAM_A, min: 0, max: 1, defaultValue: 0.25 },
      { label: "Num Partials", paramIndex: P_PARAM_B, min: 0, max: 1, defaultValue: 0.5 },
      { label: "Spectral Tilt", paramIndex: P_PARAM_C, min: 0, max: 1, defaultValue: 0.5 },
      { label: "Noise Amount", paramIndex: P_PARAM_D, min: 0, max: 1, defaultValue: 0.1 },
    ],
  },
  {
    index: 1,
    title: "Modal Synthesis",
    subtitle: "Biquad Resonator Bank",
    description:
      "Every rigid body's vibration decomposes into resonant modes — each a biquad filter " +
      "costing 6 ops per sample. 5-10 modes for impacts, 30-100 for metal. " +
      "Embarrassingly parallel and perfect for WASM SIMD.",
    color: "#ef4444",
    params: [
      { label: "Fundamental Hz", paramIndex: P_PARAM_A, min: 0, max: 1, defaultValue: 0.3 },
      { label: "Num Modes", paramIndex: P_PARAM_B, min: 0, max: 1, defaultValue: 0.4 },
      { label: "Material", paramIndex: P_PARAM_C, min: 0, max: 1, defaultValue: 0.3 },
      { label: "Strike Rate", paramIndex: P_PARAM_D, min: 0, max: 1, defaultValue: 0.3 },
      { label: "Inharmonicity", paramIndex: P_PARAM_E, min: 0, max: 1, defaultValue: 0.2 },
    ],
  },
  {
    index: 2,
    title: "Commuted Synthesis",
    subtitle: "Body IR + Waveguide",
    description:
      "Julius Smith's elegant trick: pre-convolve the body impulse response with the excitation, " +
      "feed the result into a simple delay-line string model. The body response collapses into " +
      "a single wavetable. Per-voice cost: 5-10 multiplies per sample.",
    color: "#f59e0b",
    params: [
      { label: "Pitch Hz", paramIndex: P_PARAM_A, min: 0, max: 1, defaultValue: 0.3 },
      { label: "Brightness", paramIndex: P_PARAM_B, min: 0, max: 1, defaultValue: 0.6 },
      { label: "Body Mix", paramIndex: P_PARAM_C, min: 0, max: 1, defaultValue: 0.5 },
      { label: "Pluck Rate", paramIndex: P_PARAM_D, min: 0, max: 1, defaultValue: 0.3 },
    ],
  },
  {
    index: 3,
    title: "Benjolin",
    subtitle: "Chaotic Oscillators + Rungler",
    description:
      "Two cross-modulating triangle oscillators drive an 8-bit shift register with XOR feedback. " +
      "The rungler's 3-bit DAC output modulates both frequencies, creating deterministic chaos — " +
      "patterns that try to settle but never can. ~20 ops per sample.",
    color: "#8b5cf6",
    params: [
      { label: "Osc 1 Freq", paramIndex: P_PARAM_A, min: 0, max: 1, defaultValue: 0.2 },
      { label: "Osc 2 Freq", paramIndex: P_PARAM_B, min: 0, max: 1, defaultValue: 0.25 },
      { label: "Rungler Depth", paramIndex: P_PARAM_C, min: 0, max: 1, defaultValue: 0.5 },
      { label: "Filter Cutoff", paramIndex: P_PARAM_D, min: 0, max: 1, defaultValue: 0.4 },
      { label: "Cross-Mod", paramIndex: P_PARAM_E, min: 0, max: 1, defaultValue: 0.3 },
    ],
  },
  {
    index: 4,
    title: "GENDYN",
    subtitle: "Dynamic Stochastic Synthesis",
    description:
      "Xenakis's breakpoint polygons with parallel random walks per cycle. " +
      "12-20 breakpoints with second-order walks produce uniquely alien and organic timbres — " +
      "mutating, glissando, frozen pitch states. ~30 ops per sample, every moment unique.",
    color: "#10b981",
    params: [
      { label: "Breakpoints", paramIndex: P_PARAM_A, min: 0, max: 1, defaultValue: 0.5 },
      { label: "Amp Walk Size", paramIndex: P_PARAM_B, min: 0, max: 1, defaultValue: 0.3 },
      { label: "Dur Walk Size", paramIndex: P_PARAM_C, min: 0, max: 1, defaultValue: 0.2 },
      { label: "Base Freq", paramIndex: P_PARAM_D, min: 0, max: 1, defaultValue: 0.3 },
    ],
  },
  {
    index: 5,
    title: "Bubble Oscillators",
    subtitle: "Minnaert Equation Stochastic Bubbles",
    description:
      "Each bubble is one damped sinusoid following Minnaert's equation: " +
      "f = 1/(2piR) * sqrt(3*gamma*P0/rho). Poisson-distributed spawning naturally produces " +
      "the complexity of pouring, dripping, or flowing water. 6 ops per bubble.",
    color: "#06b6d4",
    params: [
      { label: "Bubble Rate", paramIndex: P_PARAM_A, min: 0, max: 1, defaultValue: 0.3 },
      { label: "Min Size", paramIndex: P_PARAM_B, min: 0, max: 1, defaultValue: 0.3 },
      { label: "Max Size", paramIndex: P_PARAM_C, min: 0, max: 1, defaultValue: 0.4 },
      { label: "Turbulence", paramIndex: P_PARAM_D, min: 0, max: 1, defaultValue: 0.2 },
    ],
  },
  {
    index: 6,
    title: "Cellular Automata",
    subtitle: "CA Grid Driving Synthesis",
    description:
      "A 32x32 cellular automaton grid steps at control rate, generating evolving parameter " +
      "landscapes. Row density modulates a bank of oscillators. Edge-of-chaos rules (Life, " +
      "HighLife, B368/S245) produce patterns that are neither periodic nor random.",
    color: "#ec4899",
    params: [
      { label: "CA Speed", paramIndex: P_PARAM_A, min: 0, max: 1, defaultValue: 0.3 },
      { label: "Base Freq", paramIndex: P_PARAM_B, min: 0, max: 1, defaultValue: 0.3 },
      { label: "Rule", paramIndex: P_PARAM_C, min: 0, max: 1, defaultValue: 0.0 },
      { label: "Resonance", paramIndex: P_PARAM_D, min: 0, max: 1, defaultValue: 0.4 },
    ],
  },
];
