use std::cell::UnsafeCell;
use std::f32::consts::TAU;
use wasm_bindgen::prelude::*;

// ─── Shared constants ───────────────────────────────────────────────────────

const CHANNELS: usize = 2;
const BLOCK_FRAMES: usize = 128;
const BLOCK_SAMPLES: usize = BLOCK_FRAMES * CHANNELS;
const DENORMAL_BIAS: f32 = 1.0e-25;

// SharedArrayBuffer layout: per-demo parameter slots
// Each demo gets 16 float slots for parameters + 4 for telemetry
const PARAMS_PER_DEMO: usize = 20;
const MAX_DEMOS: usize = 8;
const SAB_TOTAL_FLOATS: usize = PARAMS_PER_DEMO * MAX_DEMOS;

// Parameter slot indices (shared across demos)
const P_ACTIVE: usize = 0;    // 1.0 = running, 0.0 = stopped
const P_GAIN: usize = 1;      // master gain 0..1
const P_PARAM_A: usize = 2;   // demo-specific
const P_PARAM_B: usize = 3;
const P_PARAM_C: usize = 4;
const P_PARAM_D: usize = 5;
const P_PARAM_E: usize = 6;
#[allow(dead_code)]
const P_PARAM_F: usize = 7;

// Telemetry output slots
const P_RMS_OUT: usize = 16;
const P_PEAK_OUT: usize = 17;

// ─── PRNG (xorshift32) ─────────────────────────────────────────────────────

struct Rng {
    state: u32,
}

impl Rng {
    fn new(seed: u32) -> Self {
        Self { state: if seed == 0 { 1 } else { seed } }
    }

    fn next_u32(&mut self) -> u32 {
        self.state ^= self.state << 13;
        self.state ^= self.state >> 17;
        self.state ^= self.state << 5;
        self.state
    }

    fn next_unipolar(&mut self) -> f32 {
        self.next_u32() as f32 / u32::MAX as f32
    }

    fn next_bipolar(&mut self) -> f32 {
        self.next_unipolar() * 2.0 - 1.0
    }
}

// ─── Demo 0: IFFT Additive Synthesis ────────────────────────────────────────

const IFFT_SIZE: usize = 512;
const IFFT_HOP: usize = 128;
const MAX_PARTIALS: usize = 64;

struct IfftSynth {
    sample_rate: f32,
    // We do real IFFT via rustfft
    fft_scratch: Vec<rustfft::num_complex::Complex<f32>>,
    spectrum: Vec<rustfft::num_complex::Complex<f32>>,
    output_ring: Vec<f32>,
    ring_write: usize,
    ring_read: usize,
    phase_accumulators: Vec<f32>,
    ifft: std::sync::Arc<dyn rustfft::Fft<f32>>,
    window: Vec<f32>,
    rng: Rng,
}

impl IfftSynth {
    fn new(sample_rate: f32) -> Self {
        let mut planner = rustfft::FftPlanner::new();
        let ifft = planner.plan_fft_inverse(IFFT_SIZE);
        let scratch_len = ifft.get_inplace_scratch_len();

        // Hann window for overlap-add
        let window: Vec<f32> = (0..IFFT_SIZE)
            .map(|i| {
                let t = i as f32 / IFFT_SIZE as f32;
                0.5 * (1.0 - (TAU * t).cos())
            })
            .collect();

        Self {
            sample_rate,
            fft_scratch: vec![rustfft::num_complex::Complex::new(0.0, 0.0); scratch_len],
            spectrum: vec![rustfft::num_complex::Complex::new(0.0, 0.0); IFFT_SIZE],
            output_ring: vec![0.0; IFFT_SIZE * 4],
            ring_write: 0,
            ring_read: 0,
            phase_accumulators: vec![0.0; MAX_PARTIALS],
            ifft,
            window,
            rng: Rng::new(0xDEAD_BEEF),
        }
    }

    fn render(&mut self, output: &mut [f32], params: &[f32]) {
        let gain = params[P_GAIN].clamp(0.0, 1.0);
        let fundamental = 20.0 + params[P_PARAM_A] * 480.0; // 20-500 Hz
        let num_partials = 2 + (params[P_PARAM_B] * (MAX_PARTIALS - 2) as f32) as usize;
        let spectral_tilt = params[P_PARAM_C] * 2.0 - 1.0; // -1..1 dark..bright
        let noise_amount = params[P_PARAM_D]; // 0..1

        let bin_hz = self.sample_rate / IFFT_SIZE as f32;

        // Fill spectrum with partials
        for c in self.spectrum.iter_mut() {
            *c = rustfft::num_complex::Complex::new(0.0, 0.0);
        }

        for p in 0..num_partials {
            let harmonic = (p + 1) as f32;
            let freq = fundamental * harmonic;
            if freq > self.sample_rate * 0.45 {
                break;
            }

            let bin = (freq / bin_hz) as usize;
            if bin >= IFFT_SIZE / 2 {
                break;
            }

            // Amplitude with spectral tilt
            let base_amp = 1.0 / harmonic.powf(1.0 - spectral_tilt * 0.5);

            // Advance phase accumulator for this partial
            let phase_inc = TAU * freq * IFFT_HOP as f32 / self.sample_rate;
            self.phase_accumulators[p] += phase_inc;
            if self.phase_accumulators[p] > TAU {
                self.phase_accumulators[p] -= TAU;
            }

            let phase = self.phase_accumulators[p];
            self.spectrum[bin] = rustfft::num_complex::Complex::new(
                base_amp * phase.cos(),
                base_amp * phase.sin(),
            );
        }

        // Add noise bands
        if noise_amount > 0.01 {
            let nyquist_bin = IFFT_SIZE / 2;
            for bin in 1..nyquist_bin {
                let noise_mag = noise_amount * 0.05 * self.rng.next_unipolar();
                let noise_phase = self.rng.next_unipolar() * TAU;
                self.spectrum[bin].re += noise_mag * noise_phase.cos();
                self.spectrum[bin].im += noise_mag * noise_phase.sin();
            }
        }

        // Mirror for real-valued output (conjugate symmetry)
        for i in 1..IFFT_SIZE / 2 {
            self.spectrum[IFFT_SIZE - i] = self.spectrum[i].conj();
        }

        // IFFT in-place
        self.ifft
            .process_with_scratch(&mut self.spectrum, &mut self.fft_scratch);

        // Overlap-add into ring buffer
        let ring_len = self.output_ring.len();
        let scale = gain / IFFT_SIZE as f32;
        for i in 0..IFFT_SIZE {
            let pos = (self.ring_write + i) % ring_len;
            self.output_ring[pos] += self.spectrum[i].re * self.window[i] * scale;
        }
        self.ring_write = (self.ring_write + IFFT_HOP) % ring_len;

        // Read from ring buffer
        for frame in 0..BLOCK_FRAMES {
            let sample = self.output_ring[self.ring_read];
            self.output_ring[self.ring_read] = 0.0;
            self.ring_read = (self.ring_read + 1) % ring_len;
            output[frame * CHANNELS] = sample;
            output[frame * CHANNELS + 1] = sample;
        }
    }
}

// ─── Demo 1: Modal Synthesis ────────────────────────────────────────────────

const MAX_MODES: usize = 32;

#[derive(Clone)]
struct BiquadMode {
    // State
    y1: f32,
    y2: f32,
    // Coefficients
    a1: f32,
    a2: f32,
    b0: f32,
}

impl BiquadMode {
    fn new() -> Self {
        Self {
            y1: 0.0, y2: 0.0,
            a1: 0.0, a2: 0.0, b0: 0.0,
        }
    }

    fn set_resonance(&mut self, freq_hz: f32, decay_time: f32, sample_rate: f32) {
        let omega = TAU * freq_hz / sample_rate;
        let r = (-1.0 / (decay_time * sample_rate)).exp();
        self.a1 = -2.0 * r * omega.cos();
        self.a2 = r * r;
        // b0 = 1.0: standard modal synthesis — impulse response peak ≈ 1/sin(ω),
        // which gives immediate audible response without waiting for buildup
        self.b0 = 1.0;
    }

    fn process(&mut self, input: f32) -> f32 {
        let out = self.b0 * input - self.a1 * self.y1 - self.a2 * self.y2 + DENORMAL_BIAS;
        self.y2 = self.y1;
        self.y1 = out;
        out
    }
}

struct ModalSynth {
    sample_rate: f32,
    modes: Vec<BiquadMode>,
    trigger_countdown: u32,
    rng: Rng,
}

impl ModalSynth {
    fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            modes: vec![BiquadMode::new(); MAX_MODES],
            trigger_countdown: 0,
            rng: Rng::new(0xCAFE_1234),
        }
    }

    fn render(&mut self, output: &mut [f32], params: &[f32]) {
        let gain = params[P_GAIN].clamp(0.0, 1.0);
        let fundamental = 100.0 + params[P_PARAM_A] * 2000.0;
        let num_modes = 3 + (params[P_PARAM_B] * (MAX_MODES - 3) as f32) as usize;
        let material = params[P_PARAM_C]; // 0=rubber(short decay) 1=metal(long)
        let strike_rate = 0.5 + params[P_PARAM_D] * 4.0; // strikes per second
        let inharmonicity = params[P_PARAM_E]; // 0=harmonic 1=bell-like

        let decay_base = 0.02 + material * 2.0;

        // Set up mode frequencies and decays
        for i in 0..num_modes {
            let harmonic = (i + 1) as f32;
            // Inharmonicity: f_n = f_1 * n * sqrt(1 + B*n^2)
            let b = inharmonicity * 0.01;
            let freq = fundamental * harmonic * (1.0 + b * harmonic * harmonic).sqrt();
            let decay = decay_base / (1.0 + i as f32 * 0.3 * (1.0 - material * 0.5));
            self.modes[i].set_resonance(
                freq.min(self.sample_rate * 0.45),
                decay,
                self.sample_rate,
            );
        }

        let strike_interval = (self.sample_rate / strike_rate) as u32;

        for frame in 0..BLOCK_FRAMES {
            // Excitation: single-sample impulse (standard for modal synthesis)
            let impulse = if self.trigger_countdown == 0 {
                self.trigger_countdown = strike_interval;
                1.0 + self.rng.next_bipolar() * 0.2 // slight variation per strike
            } else {
                self.trigger_countdown -= 1;
                0.0
            };

            let mut sample = 0.0;
            for i in 0..num_modes {
                sample += self.modes[i].process(impulse) / num_modes as f32;
            }

            sample *= gain;
            output[frame * CHANNELS] = sample;
            output[frame * CHANNELS + 1] = sample;
        }
    }
}

// ─── Demo 2: Commuted Synthesis ─────────────────────────────────────────────

const WAVEGUIDE_MAX_DELAY: usize = 2048;
const BODY_IR_LENGTH: usize = 512;

struct CommutedSynth {
    sample_rate: f32,
    // Delay line (string)
    delay_buf: Vec<f32>,
    delay_write: usize,
    delay_length: usize,
    // One-pole loop filter
    loop_filter_state: f32,
    loop_filter_coeff: f32, // 0=bright, 1=dark
    // Pre-convolved body IR (generated procedurally)
    body_ir: Vec<f32>,
    // Excitation state
    excitation_pos: usize,
    excitation_active: bool,
    trigger_countdown: u32,
    #[allow(dead_code)]
    rng: Rng,
}

impl CommutedSynth {
    fn new(sample_rate: f32) -> Self {
        let mut rng = Rng::new(0xBEEF_CAFE);

        // Generate a procedural body IR (simulating a metallic body)
        let body_ir: Vec<f32> = (0..BODY_IR_LENGTH)
            .map(|i| {
                let t = i as f32 / BODY_IR_LENGTH as f32;
                let env = (-t * 8.0).exp();
                let modes = (t * 1200.0).sin() * 0.5
                    + (t * 2100.0).sin() * 0.3
                    + (t * 3400.0).sin() * 0.15
                    + (t * 5800.0).sin() * 0.05;
                (modes * env + rng.next_bipolar() * 0.02 * env) * 0.5
            })
            .collect();

        Self {
            sample_rate,
            delay_buf: vec![0.0; WAVEGUIDE_MAX_DELAY],
            delay_write: 0,
            delay_length: 200,
            loop_filter_state: 0.0,
            loop_filter_coeff: 0.5,
            body_ir,
            excitation_pos: BODY_IR_LENGTH, // inactive
            excitation_active: false,
            trigger_countdown: 0,
            rng,
        }
    }

    fn render(&mut self, output: &mut [f32], params: &[f32]) {
        let gain = params[P_GAIN].clamp(0.0, 1.0);
        let pitch_hz = 50.0 + params[P_PARAM_A] * 500.0;
        let brightness = params[P_PARAM_B]; // loop filter 0=dark 1=bright
        let body_mix = params[P_PARAM_C]; // how much body resonance
        let pluck_rate = 0.3 + params[P_PARAM_D] * 3.0;

        self.delay_length = ((self.sample_rate / pitch_hz) as usize)
            .clamp(2, WAVEGUIDE_MAX_DELAY - 1);
        self.loop_filter_coeff = 1.0 - brightness * 0.95;

        let pluck_interval = (self.sample_rate / pluck_rate) as u32;

        for frame in 0..BLOCK_FRAMES {
            // Trigger pluck
            if self.trigger_countdown == 0 {
                self.trigger_countdown = pluck_interval;
                self.excitation_pos = 0;
                self.excitation_active = true;
            } else {
                self.trigger_countdown -= 1;
            }

            // Read excitation from pre-convolved body IR
            let excitation = if self.excitation_active && self.excitation_pos < BODY_IR_LENGTH {
                let val = self.body_ir[self.excitation_pos] * body_mix
                    + (if self.excitation_pos < 10 {
                        (1.0 - self.excitation_pos as f32 / 10.0) * (1.0 - body_mix)
                    } else {
                        0.0
                    });
                self.excitation_pos += 1;
                if self.excitation_pos >= BODY_IR_LENGTH {
                    self.excitation_active = false;
                }
                val
            } else {
                0.0
            };

            // Read from delay line
            let read_pos = (self.delay_write + WAVEGUIDE_MAX_DELAY - self.delay_length)
                % WAVEGUIDE_MAX_DELAY;
            let delayed = self.delay_buf[read_pos];

            // One-pole loop filter (simulates string damping)
            self.loop_filter_state = delayed * (1.0 - self.loop_filter_coeff)
                + self.loop_filter_state * self.loop_filter_coeff;

            // Write back: excitation + filtered feedback
            let feedback = 0.996; // decay
            self.delay_buf[self.delay_write] =
                excitation + self.loop_filter_state * feedback + DENORMAL_BIAS;
            self.delay_write = (self.delay_write + 1) % WAVEGUIDE_MAX_DELAY;

            let sample = delayed * gain;
            output[frame * CHANNELS] = sample;
            output[frame * CHANNELS + 1] = sample;
        }
    }
}

// ─── Demo 3: Chaotic Oscillators (Benjolin) ─────────────────────────────────

#[allow(dead_code)]
const RUNGLER_BITS: usize = 8;

struct BenjolinSynth {
    sample_rate: f32,
    // Two triangle oscillators
    osc1_phase: f32,
    osc2_phase: f32,
    osc1_freq: f32,
    osc2_freq: f32,
    // Rungler: shift register + DAC
    rungler_register: u8,
    rungler_dac: f32,
    // Previous oscillator outputs for edge detection
    osc1_prev: f32,
    osc2_prev: f32,
    // Filter state
    filter_state: f32,
}

impl BenjolinSynth {
    fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            osc1_phase: 0.0,
            osc2_phase: 0.0,
            osc1_freq: 120.0,
            osc2_freq: 135.0,
            rungler_register: 0b10110101,
            rungler_dac: 0.0,
            osc1_prev: 0.0,
            osc2_prev: 0.0,
            filter_state: 0.0,
        }
    }

    fn render(&mut self, output: &mut [f32], params: &[f32]) {
        let gain = params[P_GAIN].clamp(0.0, 1.0);
        let base_freq1 = 40.0 + params[P_PARAM_A] * 800.0;
        let base_freq2 = 40.0 + params[P_PARAM_B] * 800.0;
        let rungler_depth = params[P_PARAM_C]; // 0..1 how much rungler modulates
        let filter_cutoff = params[P_PARAM_D]; // 0..1
        let xmod_depth = params[P_PARAM_E]; // cross-modulation depth

        let filter_coeff = (0.01 + filter_cutoff * 0.4).min(0.99);

        for frame in 0..BLOCK_FRAMES {
            // Triangle oscillator 1
            let osc1_out = if self.osc1_phase < 0.5 {
                self.osc1_phase * 4.0 - 1.0
            } else {
                3.0 - self.osc1_phase * 4.0
            };

            // Triangle oscillator 2
            let osc2_out = if self.osc2_phase < 0.5 {
                self.osc2_phase * 4.0 - 1.0
            } else {
                3.0 - self.osc2_phase * 4.0
            };

            // Edge detection on osc1 for rungler clocking
            if osc1_out > 0.0 && self.osc1_prev <= 0.0 {
                // Clock the shift register
                let input_bit = if osc2_out > 0.0 { 1u8 } else { 0u8 };
                let xor_bit = (self.rungler_register >> 5) & 1;
                let new_bit = input_bit ^ xor_bit;
                self.rungler_register = (self.rungler_register << 1) | new_bit;

                // 3-bit DAC from bits 0, 3, 6
                let dac_val = ((self.rungler_register & 1) as f32)
                    + ((self.rungler_register >> 3) & 1) as f32 * 2.0
                    + ((self.rungler_register >> 6) & 1) as f32 * 4.0;
                self.rungler_dac = dac_val / 7.0; // normalize to 0..1
            }

            self.osc1_prev = osc1_out;
            self.osc2_prev = osc2_out;

            // Modulate frequencies with rungler and cross-mod
            let rungler_mod = (self.rungler_dac * 2.0 - 1.0) * rungler_depth;
            self.osc1_freq = base_freq1 * (1.0 + rungler_mod + osc2_out * xmod_depth * 0.5);
            self.osc2_freq = base_freq2 * (1.0 + rungler_mod * 0.7 + osc1_out * xmod_depth * 0.3);

            // Advance phases
            self.osc1_phase += self.osc1_freq.abs() / self.sample_rate;
            self.osc2_phase += self.osc2_freq.abs() / self.sample_rate;
            if self.osc1_phase >= 1.0 { self.osc1_phase -= 1.0; }
            if self.osc2_phase >= 1.0 { self.osc2_phase -= 1.0; }

            // Mix and filter
            let raw = osc1_out * 0.5 + osc2_out * 0.3 + (self.rungler_dac * 2.0 - 1.0) * 0.2;
            self.filter_state += (raw - self.filter_state) * filter_coeff;
            let sample = self.filter_state * gain + DENORMAL_BIAS;

            output[frame * CHANNELS] = sample;
            output[frame * CHANNELS + 1] = sample;
        }
    }
}

// ─── Demo 4: GENDYN (Dynamic Stochastic Synthesis) ──────────────────────────

const GENDYN_MAX_BREAKPOINTS: usize = 16;

struct GendynSynth {
    sample_rate: f32,
    breakpoints: Vec<f32>,     // amplitude values at breakpoints
    durations: Vec<f32>,       // duration (in samples) between breakpoints
    amp_velocities: Vec<f32>,  // second-order random walk state
    dur_velocities: Vec<f32>,
    current_bp: usize,
    next_bp: usize,
    interp_pos: f32,
    interp_inc: f32,
    rng: Rng,
}

impl GendynSynth {
    fn new(sample_rate: f32) -> Self {
        let mut rng = Rng::new(0xABCD_EF01);

        let breakpoints: Vec<f32> = (0..GENDYN_MAX_BREAKPOINTS).map(|_| rng.next_bipolar() * 0.5).collect();
        let base_dur = sample_rate / 200.0; // ~200 Hz base
        let durations: Vec<f32> = (0..GENDYN_MAX_BREAKPOINTS).map(|_| base_dur * (0.5 + rng.next_unipolar())).collect();
        let amp_velocities = vec![0.0; GENDYN_MAX_BREAKPOINTS];
        let dur_velocities = vec![0.0; GENDYN_MAX_BREAKPOINTS];

        let interp_inc = 1.0 / durations[0];

        Self {
            sample_rate,
            breakpoints,
            durations,
            amp_velocities,
            dur_velocities,
            current_bp: 0,
            next_bp: 1,
            interp_pos: 0.0,
            interp_inc,
            rng,
        }
    }

    fn render(&mut self, output: &mut [f32], params: &[f32]) {
        let gain = params[P_GAIN].clamp(0.0, 1.0);
        let num_bp = 4 + (params[P_PARAM_A] * (GENDYN_MAX_BREAKPOINTS - 4) as f32) as usize;
        let amp_step_size = 0.001 + params[P_PARAM_B] * 0.1; // random walk step
        let dur_step_size = 0.001 + params[P_PARAM_C] * 0.1;
        let base_freq = 30.0 + params[P_PARAM_D] * 500.0;

        for frame in 0..BLOCK_FRAMES {
            // Linear interpolation between breakpoints
            let a = self.breakpoints[self.current_bp % num_bp];
            let b = self.breakpoints[self.next_bp % num_bp];
            let sample = a + (b - a) * self.interp_pos;

            self.interp_pos += self.interp_inc;

            if self.interp_pos >= 1.0 {
                self.interp_pos -= 1.0;
                self.current_bp = self.next_bp;
                self.next_bp = (self.next_bp + 1) % num_bp;

                // Random walk on next breakpoint's amplitude (second-order)
                let idx = self.next_bp % num_bp;
                self.amp_velocities[idx] += self.rng.next_bipolar() * amp_step_size;
                self.amp_velocities[idx] *= 0.9; // damping
                self.breakpoints[idx] = (self.breakpoints[idx] + self.amp_velocities[idx])
                    .clamp(-1.0, 1.0);

                // Random walk on duration
                let base_dur = self.sample_rate / base_freq / num_bp as f32;
                self.dur_velocities[idx] += self.rng.next_bipolar() * dur_step_size;
                self.dur_velocities[idx] *= 0.9;
                self.durations[idx] = (self.durations[idx] + self.dur_velocities[idx] * base_dur)
                    .clamp(base_dur * 0.2, base_dur * 3.0);

                self.interp_inc = 1.0 / self.durations[self.current_bp % num_bp].max(1.0);
            }

            let out = sample * gain + DENORMAL_BIAS;
            output[frame * CHANNELS] = out;
            output[frame * CHANNELS + 1] = out;
        }
    }
}

// ─── Demo 5: Bubble/Fluid Oscillators ───────────────────────────────────────

const MAX_BUBBLES: usize = 16;
#[allow(dead_code)]
const SPEED_OF_SOUND: f32 = 343.0;
const ATMOSPHERIC_PRESSURE: f32 = 101325.0;
const WATER_DENSITY: f32 = 998.0;
const HEAT_CAPACITY_RATIO: f32 = 1.4; // for air

#[derive(Clone)]
struct Bubble {
    active: bool,
    phase: f32,
    freq: f32,
    amp: f32,
    decay: f32,
    age: f32,
}

impl Bubble {
    fn new() -> Self {
        Self {
            active: false,
            phase: 0.0,
            freq: 0.0,
            amp: 0.0,
            decay: 0.0,
            age: 0.0,
        }
    }
}

struct BubbleSynth {
    sample_rate: f32,
    bubbles: Vec<Bubble>,
    spawn_accumulator: f32,
    rng: Rng,
}

impl BubbleSynth {
    fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            bubbles: vec![Bubble::new(); MAX_BUBBLES],
            spawn_accumulator: 0.0,
            rng: Rng::new(0x1234_5678),
        }
    }

    fn spawn_bubble(&mut self, min_radius: f32, max_radius: f32) {
        let slot = match self.bubbles.iter().position(|b| !b.active) {
            Some(i) => i,
            None => return,
        };

        let radius = min_radius + self.rng.next_unipolar() * (max_radius - min_radius);

        // Minnaert equation: f0 = 1/(2*pi*R) * sqrt(3*gamma*P0/rho)
        let freq = (1.0 / (TAU * radius))
            * (3.0 * HEAT_CAPACITY_RATIO * ATMOSPHERIC_PRESSURE / WATER_DENSITY).sqrt();

        let clamped_freq = freq.clamp(20.0, self.sample_rate * 0.45);

        // Smaller bubbles decay faster
        let decay_time = 0.01 + radius * 200.0;

        self.bubbles[slot] = Bubble {
            active: true,
            phase: 0.0,
            freq: clamped_freq,
            amp: 0.3 + self.rng.next_unipolar() * 0.7,
            decay: (-1.0 / (decay_time * self.sample_rate)).exp(),
            age: 0.0,
        };
    }

    fn render(&mut self, output: &mut [f32], params: &[f32]) {
        let gain = params[P_GAIN].clamp(0.0, 1.0);
        let bubble_rate = 1.0 + params[P_PARAM_A] * 60.0; // bubbles per second
        let min_size = 0.001 + params[P_PARAM_B] * 0.01; // min radius in meters
        let max_size = min_size + 0.001 + params[P_PARAM_C] * 0.02;
        let _turbulence = params[P_PARAM_D]; // pitch wobble

        for frame in 0..BLOCK_FRAMES {
            // Poisson-distributed bubble spawning
            self.spawn_accumulator += bubble_rate / self.sample_rate;
            while self.spawn_accumulator >= 1.0 {
                self.spawn_accumulator -= 1.0;
                self.spawn_bubble(min_size, max_size);
            }

            let mut sample = 0.0;

            for bubble in self.bubbles.iter_mut() {
                if !bubble.active {
                    continue;
                }

                // Damped sinusoid
                let val = (bubble.phase * TAU).sin() * bubble.amp;
                sample += val;

                bubble.phase += bubble.freq / self.sample_rate;
                if bubble.phase >= 1.0 {
                    bubble.phase -= 1.0;
                }
                bubble.amp *= bubble.decay;
                bubble.age += 1.0;

                if bubble.amp < 0.001 {
                    bubble.active = false;
                }
            }

            sample *= gain * 0.15;
            output[frame * CHANNELS] = sample + DENORMAL_BIAS;
            output[frame * CHANNELS + 1] = sample + DENORMAL_BIAS;
        }
    }
}

// ─── Demo 6: Cellular Automata Modulator ────────────────────────────────────

const CA_WIDTH: usize = 32;
const CA_HEIGHT: usize = 32;
const CA_CELLS: usize = CA_WIDTH * CA_HEIGHT;

struct CaSynth {
    sample_rate: f32,
    grid: Vec<u8>,
    grid_back: Vec<u8>,
    step_counter: u32,
    step_interval: u32,
    // Oscillators modulated by CA
    osc_phases: Vec<f32>,
    osc_freqs: Vec<f32>,
    filter_state: f32,
    rng: Rng,
}

impl CaSynth {
    fn new(sample_rate: f32) -> Self {
        let mut rng = Rng::new(0x9876_5432);
        let grid: Vec<u8> = (0..CA_CELLS).map(|_| if rng.next_unipolar() > 0.5 { 1 } else { 0 }).collect();

        // Use 8 oscillators modulated by CA rows
        let num_oscs = 8;
        let osc_freqs: Vec<f32> = (0..num_oscs)
            .map(|i| 110.0 * (2.0_f32).powf(i as f32 / 4.0))
            .collect();
        let osc_phases = vec![0.0; num_oscs];

        Self {
            sample_rate,
            grid,
            grid_back: vec![0; CA_CELLS],
            step_counter: 0,
            step_interval: (sample_rate * 0.05) as u32, // 20 Hz
            osc_phases,
            osc_freqs,
            filter_state: 0.0,
            rng,
        }
    }

    fn step_ca(&mut self, rule_variant: u32) {
        // 2D cellular automaton (Game of Life variant or custom rule)
        for y in 0..CA_HEIGHT {
            for x in 0..CA_WIDTH {
                let mut neighbors = 0u8;
                for dy in [-1i32, 0, 1] {
                    for dx in [-1i32, 0, 1] {
                        if dx == 0 && dy == 0 { continue; }
                        let nx = ((x as i32 + dx + CA_WIDTH as i32) % CA_WIDTH as i32) as usize;
                        let ny = ((y as i32 + dy + CA_HEIGHT as i32) % CA_HEIGHT as i32) as usize;
                        neighbors += self.grid[ny * CA_WIDTH + nx];
                    }
                }

                let alive = self.grid[y * CA_WIDTH + x] == 1;
                let cell = match rule_variant {
                    0 => {
                        // Conway's Game of Life
                        if alive { neighbors == 2 || neighbors == 3 }
                        else { neighbors == 3 }
                    }
                    1 => {
                        // B368/S245 (chaotic)
                        if alive { neighbors == 2 || neighbors == 4 || neighbors == 5 }
                        else { neighbors == 3 || neighbors == 6 || neighbors == 8 }
                    }
                    _ => {
                        // B36/S23 (HighLife)
                        if alive { neighbors == 2 || neighbors == 3 }
                        else { neighbors == 3 || neighbors == 6 }
                    }
                };

                self.grid_back[y * CA_WIDTH + x] = if cell { 1 } else { 0 };
            }
        }

        std::mem::swap(&mut self.grid, &mut self.grid_back);

        // Check if grid is dead and reinject randomness
        let alive_count: u32 = self.grid.iter().map(|&c| c as u32).sum();
        if alive_count < 5 || alive_count > (CA_CELLS as u32 - 5) {
            for cell in self.grid.iter_mut() {
                *cell = if self.rng.next_unipolar() > 0.5 { 1 } else { 0 };
            }
        }
    }

    fn render(&mut self, output: &mut [f32], params: &[f32]) {
        let gain = params[P_GAIN].clamp(0.0, 1.0);
        let ca_speed = 0.5 + params[P_PARAM_A] * 40.0; // steps per second
        let base_freq = 55.0 + params[P_PARAM_B] * 440.0;
        let rule_variant = (params[P_PARAM_C] * 2.9) as u32;
        let resonance = 0.1 + params[P_PARAM_D] * 0.8;

        self.step_interval = (self.sample_rate / ca_speed).max(1.0) as u32;

        // Update oscillator base frequencies
        let num_oscs = self.osc_freqs.len();
        for i in 0..num_oscs {
            self.osc_freqs[i] = base_freq * (2.0_f32).powf(i as f32 / 4.0);
        }

        for frame in 0..BLOCK_FRAMES {
            // Step CA at control rate
            self.step_counter += 1;
            if self.step_counter >= self.step_interval {
                self.step_counter = 0;
                self.step_ca(rule_variant);
            }

            // Use CA row sums to modulate oscillator amplitudes
            let mut sample = 0.0;
            for (i, phase) in self.osc_phases.iter_mut().enumerate() {
                let row = (i * CA_HEIGHT / num_oscs) % CA_HEIGHT;
                let row_sum: f32 = (0..CA_WIDTH)
                    .map(|x| self.grid[row * CA_WIDTH + x] as f32)
                    .sum::<f32>() / CA_WIDTH as f32;

                let freq = self.osc_freqs[i];
                let amp = row_sum;

                sample += (*phase * TAU).sin() * amp / num_oscs as f32;
                *phase += freq / self.sample_rate;
                if *phase >= 1.0 {
                    *phase -= 1.0;
                }
            }

            // Simple resonant filter
            self.filter_state += (sample - self.filter_state) * resonance;
            let out = self.filter_state * gain * 0.5 + DENORMAL_BIAS;

            output[frame * CHANNELS] = out;
            output[frame * CHANNELS + 1] = out;
        }
    }
}

// ─── Demo 7: Commuted Matrix (proper waveguide synthesis) ───────────────────

const MATRIX_MAX_WAVETABLE: usize = 16384;
const MATRIX_WAVEGUIDE_DELAY: usize = 2048;
const MATRIX_MIN_PITCH_HZ: f32 = 50.0;
const MATRIX_PITCH_RANGE_HZ: f32 = 500.0;
const MATRIX_MIN_FEEDBACK: f32 = 0.9;
const MATRIX_FEEDBACK_RANGE: f32 = 0.099;

struct CommutedMatrixSynth {
    sample_rate: f32,
    wavetable: Vec<f32>,
    wavetable_len: usize,
    wavetable_pos: usize,
    wavetable_playing: bool,
    delay_buf: Vec<f32>,
    delay_write: usize,
    delay_length: usize,
    loop_filter_state: f32,
}

impl CommutedMatrixSynth {
    fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            wavetable: vec![0.0; MATRIX_MAX_WAVETABLE],
            wavetable_len: 0,
            wavetable_pos: 0,
            wavetable_playing: false,
            delay_buf: vec![0.0; MATRIX_WAVEGUIDE_DELAY],
            delay_write: 0,
            delay_length: 200,
            loop_filter_state: 0.0,
        }
    }

    fn trigger(&mut self) {
        self.wavetable_pos = 0;
        self.wavetable_playing = self.wavetable_len > 0;
        for s in self.delay_buf.iter_mut() {
            *s = 0.0;
        }
        self.loop_filter_state = 0.0;
    }

    fn render(&mut self, output: &mut [f32], params: &[f32]) {
        let gain = params[P_GAIN].clamp(0.0, 1.0);
        let pitch_hz = MATRIX_MIN_PITCH_HZ + params[P_PARAM_A] * MATRIX_PITCH_RANGE_HZ;
        let brightness = params[P_PARAM_B];
        let feedback = MATRIX_MIN_FEEDBACK + params[P_PARAM_C] * MATRIX_FEEDBACK_RANGE;

        self.delay_length = ((self.sample_rate / pitch_hz) as usize)
            .clamp(2, MATRIX_WAVEGUIDE_DELAY - 1);
        let filter_coeff = 1.0 - brightness * 0.95;

        for frame in 0..BLOCK_FRAMES {
            let excitation = if self.wavetable_playing && self.wavetable_pos < self.wavetable_len {
                let val = self.wavetable[self.wavetable_pos];
                self.wavetable_pos += 1;
                if self.wavetable_pos >= self.wavetable_len {
                    self.wavetable_playing = false;
                }
                val
            } else {
                0.0
            };

            let read_pos = (self.delay_write + MATRIX_WAVEGUIDE_DELAY - self.delay_length)
                % MATRIX_WAVEGUIDE_DELAY;
            let delayed = self.delay_buf[read_pos];

            self.loop_filter_state = delayed * (1.0 - filter_coeff)
                + self.loop_filter_state * filter_coeff;

            self.delay_buf[self.delay_write] =
                excitation + self.loop_filter_state * feedback + DENORMAL_BIAS;
            self.delay_write = (self.delay_write + 1) % MATRIX_WAVEGUIDE_DELAY;

            let sample = delayed * gain;
            output[frame * CHANNELS] = sample;
            output[frame * CHANNELS + 1] = sample;
        }
    }
}

// ─── Master Engine ──────────────────────────────────────────────────────────

struct Engine {
    #[allow(dead_code)]
    sample_rate: f32,
    ifft: IfftSynth,
    modal: ModalSynth,
    commuted: CommutedSynth,
    benjolin: BenjolinSynth,
    gendyn: GendynSynth,
    bubble: BubbleSynth,
    ca: CaSynth,
    matrix: CommutedMatrixSynth,
    output: Vec<f32>,
    #[allow(dead_code)]
    temp: Vec<f32>,
    param_buf: Vec<f32>,
}

impl Engine {
    fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            ifft: IfftSynth::new(sample_rate),
            modal: ModalSynth::new(sample_rate),
            commuted: CommutedSynth::new(sample_rate),
            benjolin: BenjolinSynth::new(sample_rate),
            gendyn: GendynSynth::new(sample_rate),
            bubble: BubbleSynth::new(sample_rate),
            ca: CaSynth::new(sample_rate),
            matrix: CommutedMatrixSynth::new(sample_rate),
            output: vec![0.0; BLOCK_SAMPLES],
            temp: vec![0.0; BLOCK_SAMPLES],
            param_buf: vec![0.0; SAB_TOTAL_FLOATS],
        }
    }

    fn render_demo(&mut self, demo_index: usize) {
        let base = demo_index * PARAMS_PER_DEMO;
        let params = &self.param_buf[base..base + PARAMS_PER_DEMO];

        if params[P_ACTIVE] < 0.5 {
            // Not active, zero out
            for s in self.output.iter_mut() {
                *s = 0.0;
            }
            // Write zero telemetry
            self.param_buf[base + P_RMS_OUT] = 0.0;
            self.param_buf[base + P_PEAK_OUT] = 0.0;
            return;
        }

        // Zero temp buffer
        for s in self.output.iter_mut() {
            *s = 0.0;
        }

        match demo_index {
            0 => self.ifft.render(&mut self.output, params),
            1 => self.modal.render(&mut self.output, params),
            2 => self.commuted.render(&mut self.output, params),
            3 => self.benjolin.render(&mut self.output, params),
            4 => self.gendyn.render(&mut self.output, params),
            5 => self.bubble.render(&mut self.output, params),
            6 => self.ca.render(&mut self.output, params),
            7 => self.matrix.render(&mut self.output, params),
            _ => {}
        }

        // Compute telemetry
        let mut rms_acc = 0.0f32;
        let mut peak = 0.0f32;
        for s in self.output.iter() {
            rms_acc += s * s;
            let abs = s.abs();
            if abs > peak { peak = abs; }
        }
        let rms = (rms_acc / BLOCK_SAMPLES as f32).sqrt();
        self.param_buf[base + P_RMS_OUT] = rms;
        self.param_buf[base + P_PEAK_OUT] = peak;
    }
}

// ─── Global state ───────────────────────────────────────────────────────────

struct EngineCell(UnsafeCell<Option<Engine>>);
unsafe impl Sync for EngineCell {}

static ENGINE: EngineCell = EngineCell(UnsafeCell::new(None));

fn with_engine<R>(f: impl FnOnce(&mut Engine) -> R) -> R {
    let cell = unsafe { &mut *ENGINE.0.get() };
    let engine = cell.as_mut().expect("engine not initialized");
    f(engine)
}

// ─── WASM exports ───────────────────────────────────────────────────────────

#[wasm_bindgen]
pub fn init_engine(sample_rate: f32) {
    let cell = unsafe { &mut *ENGINE.0.get() };
    *cell = Some(Engine::new(sample_rate));
}

#[wasm_bindgen]
pub fn set_param(demo_index: u32, param_index: u32, value: f32) {
    with_engine(|e| {
        let idx = demo_index as usize * PARAMS_PER_DEMO + param_index as usize;
        if idx < e.param_buf.len() {
            e.param_buf[idx] = value;
        }
    });
}

#[wasm_bindgen]
pub fn render_demo(demo_index: u32) {
    with_engine(|e| e.render_demo(demo_index as usize));
}

#[wasm_bindgen]
pub fn get_output_ptr() -> u32 {
    with_engine(|e| e.output.as_ptr() as u32)
}

#[wasm_bindgen]
pub fn get_output_len() -> u32 {
    BLOCK_SAMPLES as u32
}

#[wasm_bindgen]
pub fn get_param_ptr() -> u32 {
    with_engine(|e| e.param_buf.as_ptr() as u32)
}

#[wasm_bindgen]
pub fn get_param_len() -> u32 {
    SAB_TOTAL_FLOATS as u32
}

#[wasm_bindgen]
pub fn get_rms(demo_index: u32) -> f32 {
    with_engine(|e| {
        let idx = demo_index as usize * PARAMS_PER_DEMO + P_RMS_OUT;
        if idx < e.param_buf.len() { e.param_buf[idx] } else { 0.0 }
    })
}

#[wasm_bindgen]
pub fn get_peak(demo_index: u32) -> f32 {
    with_engine(|e| {
        let idx = demo_index as usize * PARAMS_PER_DEMO + P_PEAK_OUT;
        if idx < e.param_buf.len() { e.param_buf[idx] } else { 0.0 }
    })
}

// ─── Commuted matrix wavetable management ───────────────────────────────────

#[wasm_bindgen]
pub fn get_matrix_wavetable_ptr() -> u32 {
    with_engine(|e| e.matrix.wavetable.as_ptr() as u32)
}

#[wasm_bindgen]
pub fn set_matrix_wavetable_len(len: u32) {
    with_engine(|e| {
        e.matrix.wavetable_len = (len as usize).min(MATRIX_MAX_WAVETABLE);
        e.matrix.trigger();
    });
}

#[wasm_bindgen]
pub fn trigger_matrix() {
    with_engine(|e| e.matrix.trigger());
}
