// ---------------------------------------------------------------------------
// Minimal Web Audio system for atom sound effects
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Resume context on first user interaction (browser autoplay policy) */
export function resumeAudio() {
  const c = getCtx();
  if (c.state === 'suspended') c.resume();
}

// ---------------------------------------------------------------------------
// Sound primitives
// ---------------------------------------------------------------------------

/** Impact thud — low frequency sine burst, pitch proportional to mass */
export function playImpact(intensity: number = 0.5, pitch: number = 80) {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(pitch, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(pitch * 0.4, c.currentTime + 0.15);
  gain.gain.setValueAtTime(Math.min(intensity * 0.3, 0.4), c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.2);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 0.2);
}

/** Engine hum — continuous oscillator, returns stop function */
export function playHum(frequency: number = 120, volume: number = 0.1): () => void {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sawtooth';
  osc.frequency.value = frequency;
  gain.gain.value = Math.min(volume, 0.15);
  osc.connect(gain).connect(c.destination);
  osc.start();
  return () => {
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.1);
    osc.stop(c.currentTime + 0.12);
  };
}

/** Burst pop — short noise burst */
export function playPop(intensity: number = 0.5) {
  const c = getCtx();
  const bufferSize = Math.floor(c.sampleRate * 0.05);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const gain = c.createGain();
  gain.gain.setValueAtTime(Math.min(intensity * 0.25, 0.3), c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.05);
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 800;
  src.connect(filter).connect(gain).connect(c.destination);
  src.start();
}

/** Creak — frequency sweep for joints under stress */
export function playCreak(stress: number = 0.5) {
  if (stress < 0.3) return; // Don't creak for low stress
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'triangle';
  const baseFreq = 200 + stress * 400;
  osc.frequency.setValueAtTime(baseFreq, c.currentTime);
  osc.frequency.linearRampToValueAtTime(baseFreq * 0.7, c.currentTime + 0.08);
  gain.gain.setValueAtTime(stress * 0.08, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.1);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 0.1);
}

/** Zap fire — rising sine chirp */
export function playZapFire(intensity: number = 0.5) {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(200, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1200, c.currentTime + 0.08);
  gain.gain.setValueAtTime(Math.min(intensity * 0.1, 0.15), c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.12);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 0.12);
}

/** Sense detection ping */
export function playSensePing() {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(440, c.currentTime + 0.15);
  gain.gain.setValueAtTime(0.06, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.2);
  osc.connect(gain).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + 0.2);
}
