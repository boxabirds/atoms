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
  whyInteresting: string;
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
    whyInteresting:
      "This is the single highest-impact architectural change for additive synthesis. " +
      "Image-Line's Harmor runs 516 partials per voice this way with CPU load comparable to a basic subtractive synth. " +
      "The key insight: you can merge pitched partials and shaped noise in the same IFFT pass, " +
      "getting filtered noise essentially for free — the foundation of the SMS (Sinusoidal Modeling + Residual) framework " +
      "that enables infinite timbral variation from a small analyzed source library.",
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
    whyInteresting:
      "The ideal engine for interactive object sounds. A 50-mode metallic object costs ~300 ops/sample — " +
      "meaning 50+ simultaneously sounding objects are feasible. The 2023–2025 breakthrough in explicit nonlinear modal " +
      "synthesis (Ducceschi, Bilbao) enables real-time gong pitch glides and cymbal energy cascades " +
      "via straightforward time-stepping, where previously implicit Newton-Raphson solvers made this impossible in constrained environments.",
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
    whyInteresting:
      "Perhaps the most elegant trick in audio DSP. By exploiting the commutativity of convolution, " +
      "the body response — normally the most expensive part requiring hundreds of resonant modes — collapses " +
      "into a single pre-computed wavetable. This creates a perfect hybrid strategy: capture real body impulse responses " +
      "(metal casings, wooden housings, glass resonators), and users mix-and-match excitations with bodies — " +
      "a non-expert-friendly 'what hits what' abstraction that produces physically grounded sound.",
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
    whyInteresting:
      "At ~20 ops/sample, this is absurdly cheap for the organic complexity it produces. " +
      "Rob Hordijk's design creates deterministic chaos — sputtering, bifurcating, morphing patterns " +
      "that sound 'bent by design.' One Benjolin per environmental zone provides continuous, ever-evolving " +
      "ambient texture at negligible CPU cost. The sonic result is far more alive than any amount of " +
      "deterministic synthesis because it hovers at the edge between order and randomness.",
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
    whyInteresting:
      "Iannis Xenakis invented this as a compositional tool, but it's secretly one of the most " +
      "CPU-efficient texture generators available. Every single moment is genuinely unique without any " +
      "scheduled variation logic — the random walks on breakpoint positions produce sounds that are " +
      "simultaneously alien and organic. No sample library or preset bank can replicate what this does " +
      "because the waveform itself is constantly mutating at the per-cycle level.",
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
    whyInteresting:
      "Each bubble is essentially one biquad — just 6 operations — yet Poisson-distributed events " +
      "naturally produce the full complexity of water sounds. This is a case where the physics " +
      "is so simple that the real model is cheaper than a fake approximation. Minnaert's 1933 equation " +
      "directly relates bubble radius to pitch, so size parameters map intuitively to audible results. " +
      "Stacking hundreds of these trivially cheap oscillators creates convincing fluid soundscapes.",
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
    whyInteresting:
      "CAs are ideal as control-rate modulators rather than direct audio sources. " +
      "A 32x32 grid stepping at 20 Hz costs negligible CPU (bitwise operations, embarrassingly SIMD-parallel) " +
      "while generating evolving parameter landscapes that drive synthesis across all voices. " +
      "Edge-of-chaos rules produce patterns with exactly the quality that makes machine sounds feel alive — " +
      "structure without repetition. This is the 'variation layer' that prevents any two moments from sounding identical.",
    color: "#ec4899",
    params: [
      { label: "CA Speed", paramIndex: P_PARAM_A, min: 0, max: 1, defaultValue: 0.3 },
      { label: "Base Freq", paramIndex: P_PARAM_B, min: 0, max: 1, defaultValue: 0.3 },
      { label: "Rule", paramIndex: P_PARAM_C, min: 0, max: 1, defaultValue: 0.0 },
      { label: "Resonance", paramIndex: P_PARAM_D, min: 0, max: 1, defaultValue: 0.4 },
    ],
  },
];
