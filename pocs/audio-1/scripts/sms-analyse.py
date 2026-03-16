#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "soundfile", "librosa", "scipy"]
# ///
"""
SMS (Sinusoidal Modeling + Residual) analysis pipeline.

Decomposes audio samples into:
  1. Partial trajectories — frequency, amplitude, and phase tracked over time
  2. Noise residual envelope — stochastic component after subtracting sinusoids

Output: compact JSON files suitable for in-browser IFFT additive synthesis.

Usage:
  uv run scripts/sms-analyse.py              # analyse all split samples
  uv run scripts/sms-analyse.py path/to.wav  # analyse a single file
"""

import json
import os
import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
from scipy.signal import find_peaks

# ── Analysis constants ──────────────────────────────────────────────────────

WINDOW_SIZE = 2048
HOP_SIZE = 256
WINDOW_TYPE = "hann"

MAX_PARTIALS_PER_FRAME = 64
PEAK_AMPLITUDE_THRESHOLD_DB = -60  # ignore peaks below this (dB relative to max)
FREQUENCY_TRACKING_TOLERANCE_HZ = 50  # max jump between frames to continue a track
MIN_TRACK_LENGTH_FRAMES = 3  # discard partials shorter than this

# Noise residual — mel-scale band decomposition
NOISE_NUM_BANDS = 24
NOISE_FMIN_HZ = 20
NOISE_FMAX_HZ = 20000

# JSON output precision
FLOAT_DECIMALS = 3

# ── Directory layout ────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
SAMPLES_DIR = SCRIPT_DIR / ".." / "data" / "samples"
SMS_DIR = SCRIPT_DIR / ".." / "data" / "sms"


# ── Helpers ─────────────────────────────────────────────────────────────────


def round_list(arr, decimals=FLOAT_DECIMALS):
    """Round a 1-D numpy array to a plain Python list of floats."""
    return [round(float(v), decimals) for v in arr]


def round_nested(arr_2d, decimals=FLOAT_DECIMALS):
    """Round a 2-D numpy array to nested plain Python lists."""
    return [round_list(row, decimals) for row in arr_2d]


def is_up_to_date(source: Path, target: Path) -> bool:
    """Check if target exists and is newer than source."""
    if not target.exists():
        return False
    return target.stat().st_mtime >= source.stat().st_mtime


# ── Peak detection ──────────────────────────────────────────────────────────


def detect_peaks(mag_spectrum, sr, fft_size):
    """
    Find spectral peaks in a single magnitude spectrum frame.

    Returns arrays of (frequencies_hz, amplitudes_linear, bin_indices)
    sorted by amplitude descending, capped at MAX_PARTIALS_PER_FRAME.
    """
    # Convert to dB for thresholding
    mag_db = librosa.amplitude_to_db(mag_spectrum, ref=np.max)
    above_threshold = mag_db > PEAK_AMPLITUDE_THRESHOLD_DB

    # Find local maxima (a peak must be higher than both neighbours)
    indices, properties = find_peaks(mag_spectrum, height=0)

    # Filter by threshold
    valid = above_threshold[indices]
    indices = indices[valid]

    if len(indices) == 0:
        return np.array([]), np.array([]), np.array([])

    amplitudes = mag_spectrum[indices]
    frequencies = indices * sr / fft_size

    # Sort by amplitude descending, keep top N
    order = np.argsort(amplitudes)[::-1][:MAX_PARTIALS_PER_FRAME]
    indices = indices[order]
    amplitudes = amplitudes[order]
    frequencies = frequencies[order]

    return frequencies, amplitudes, indices


# ── Partial tracking ───────────────────────────────────────────────────────


def track_partials(all_freqs, all_amps, all_phases):
    """
    Track sinusoidal partials across STFT frames using greedy nearest-frequency matching.

    Each partial is a dict with:
      - start_frame: int
      - frequencies: list[float]  (Hz)
      - amplitudes: list[float]   (linear)
      - phases: list[float]       (radians) — omitted from output for compactness

    Returns list of partial dicts (filtered by MIN_TRACK_LENGTH_FRAMES).
    """
    active_tracks = []  # list of (last_freq, partial_dict)
    finished_tracks = []
    num_frames = len(all_freqs)

    for frame_idx in range(num_frames):
        freqs = all_freqs[frame_idx]
        amps = all_amps[frame_idx]
        phases = all_phases[frame_idx]

        used_peak = set()
        continued_track = set()

        # Try to continue each active track with the nearest unmatched peak
        for track_idx, (last_freq, track) in enumerate(active_tracks):
            if len(freqs) == 0:
                break
            distances = np.abs(freqs - last_freq)
            best = np.argmin(distances)
            if distances[best] <= FREQUENCY_TRACKING_TOLERANCE_HZ and best not in used_peak:
                track["frequencies"].append(freqs[best])
                track["amplitudes"].append(amps[best])
                used_peak.add(best)
                continued_track.add(track_idx)
                active_tracks[track_idx] = (freqs[best], track)

        # Retire tracks that were not continued
        new_active = []
        for track_idx, (last_freq, track) in enumerate(active_tracks):
            if track_idx in continued_track:
                new_active.append((last_freq, track))
            else:
                finished_tracks.append(track)
        active_tracks = new_active

        # Start new tracks for unmatched peaks
        for peak_idx in range(len(freqs)):
            if peak_idx not in used_peak:
                track = {
                    "start_frame": frame_idx,
                    "frequencies": [freqs[peak_idx]],
                    "amplitudes": [amps[peak_idx]],
                }
                active_tracks.append((freqs[peak_idx], track))

    # Flush remaining active tracks
    finished_tracks.extend(track for _, track in active_tracks)

    # Filter short tracks and sort by max amplitude
    filtered = [
        t for t in finished_tracks if len(t["frequencies"]) >= MIN_TRACK_LENGTH_FRAMES
    ]
    filtered.sort(key=lambda t: max(t["amplitudes"]), reverse=True)

    return filtered


# ── Noise residual ──────────────────────────────────────────────────────────


def compute_noise_envelope(audio, sr, stft_complex, all_peak_freqs, all_peak_amps, all_peak_phases):
    """
    Compute noise residual by subtracting tracked sinusoids from the original,
    then extracting mel-band energies per frame.

    Returns (band_edges_hz, frames) where frames is (num_frames, num_bands).
    """
    num_samples = len(audio)
    sinusoidal = np.zeros(num_samples, dtype=np.float64)

    num_frames = len(all_peak_freqs)
    t_centers = np.arange(num_frames) * HOP_SIZE

    # Resynthesize sinusoidal component via overlap-add of windowed sinusoids
    window = librosa.filters.get_window(WINDOW_TYPE, WINDOW_SIZE, fftbins=True)

    for frame_idx in range(num_frames):
        center = t_centers[frame_idx]
        start = center - WINDOW_SIZE // 2
        end = start + WINDOW_SIZE

        # Clamp to signal bounds
        win_start = max(0, -start)
        sig_start = max(0, start)
        sig_end = min(num_samples, end)
        win_end = win_start + (sig_end - sig_start)

        t = np.arange(sig_start, sig_end) / sr

        freqs = all_peak_freqs[frame_idx]
        amps = all_peak_amps[frame_idx]
        phases = all_peak_phases[frame_idx]

        for k in range(len(freqs)):
            component = amps[k] * np.cos(2 * np.pi * freqs[k] * t + phases[k])
            sinusoidal[sig_start:sig_end] += component * window[win_start:win_end]

    # Normalize for overlap-add gain (approximate)
    # The Hann window with this hop/window ratio has a known overlap-add gain
    overlap_factor = WINDOW_SIZE / HOP_SIZE
    sinusoidal /= overlap_factor / 2  # approximate correction

    # Compute residual
    residual = audio[:num_samples] - sinusoidal[:num_samples]

    # Compute mel-band energies of the residual
    mel_basis = librosa.filters.mel(
        sr=sr,
        n_fft=WINDOW_SIZE,
        n_mels=NOISE_NUM_BANDS,
        fmin=NOISE_FMIN_HZ,
        fmax=min(NOISE_FMAX_HZ, sr // 2),
    )

    residual_stft = librosa.stft(
        residual, n_fft=WINDOW_SIZE, hop_length=HOP_SIZE, window=WINDOW_TYPE
    )
    residual_mag = np.abs(residual_stft)
    mel_energies = mel_basis @ residual_mag  # (num_bands, num_frames)

    # Get band edge frequencies
    mel_freqs = librosa.mel_frequencies(
        n_mels=NOISE_NUM_BANDS + 2,
        fmin=NOISE_FMIN_HZ,
        fmax=min(NOISE_FMAX_HZ, sr // 2),
    )
    band_edges = mel_freqs.tolist()

    return band_edges, mel_energies.T  # transpose to (num_frames, num_bands)


# ── Main analysis ──────────────────────────────────────────────────────────


def analyse_file(wav_path: Path, out_path: Path):
    """Run full SMS analysis on a single WAV file, write JSON output."""
    audio, sr = sf.read(str(wav_path), dtype="float64")

    # Mix to mono if stereo
    if audio.ndim > 1:
        audio = np.mean(audio, axis=1)

    duration_s = len(audio) / sr

    # STFT
    stft_complex = librosa.stft(
        audio, n_fft=WINDOW_SIZE, hop_length=HOP_SIZE, window=WINDOW_TYPE
    )
    mag = np.abs(stft_complex)
    phase = np.angle(stft_complex)
    num_frames = mag.shape[1]

    # Peak detection per frame
    all_peak_freqs = []
    all_peak_amps = []
    all_peak_phases = []

    for frame_idx in range(num_frames):
        freqs, amps, bins = detect_peaks(mag[:, frame_idx], sr, WINDOW_SIZE)
        if len(bins) > 0:
            frame_phases = phase[bins.astype(int), frame_idx]
        else:
            frame_phases = np.array([])
        all_peak_freqs.append(freqs)
        all_peak_amps.append(amps)
        all_peak_phases.append(frame_phases)

    # Track partials across frames
    partials = track_partials(all_peak_freqs, all_peak_amps, all_peak_phases)

    # Noise residual envelope
    band_edges, noise_frames = compute_noise_envelope(
        audio, sr, stft_complex, all_peak_freqs, all_peak_amps, all_peak_phases
    )

    # Build output
    result = {
        "sample_rate": sr,
        "hop_size": HOP_SIZE,
        "num_frames": num_frames,
        "duration_s": round(duration_s, FLOAT_DECIMALS),
        "source_file": wav_path.name,
        "partials": [
            {
                "start_frame": p["start_frame"],
                "frequencies": round_list(p["frequencies"]),
                "amplitudes": round_list(p["amplitudes"]),
            }
            for p in partials
        ],
        "noise_envelope": {
            "num_bands": NOISE_NUM_BANDS,
            "band_edges_hz": round_list(band_edges),
            "frames": round_nested(noise_frames),
        },
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(result, f, separators=(",", ":"))

    return result


def collect_sample_files():
    """Find all split WAV files (excluding originals)."""
    samples_dir = SAMPLES_DIR.resolve()
    wav_files = []
    for wav in sorted(samples_dir.rglob("*.wav")):
        # Skip originals subdirectory
        if "original" in wav.parts:
            continue
        wav_files.append(wav)
    return wav_files


def wav_to_json_path(wav_path: Path) -> Path:
    """Map a sample WAV path to its corresponding SMS JSON output path."""
    samples_dir = SAMPLES_DIR.resolve()
    sms_dir = SMS_DIR.resolve()
    relative = wav_path.resolve().relative_to(samples_dir)
    return sms_dir / relative.with_suffix(".json")


def main():
    if len(sys.argv) > 1:
        # Single file mode
        wav_path = Path(sys.argv[1]).resolve()
        if not wav_path.exists():
            print(f"File not found: {wav_path}", file=sys.stderr)
            sys.exit(1)
        out_path = wav_to_json_path(wav_path)
        print(f"Analysing {wav_path.name} ...")
        result = analyse_file(wav_path, out_path)
        print(
            f"  -> {out_path.relative_to(Path.cwd())} "
            f"({len(result['partials'])} partials, {result['num_frames']} frames)"
        )
        return

    # Batch mode — all split samples
    wav_files = collect_sample_files()
    total = len(wav_files)
    skipped = 0
    analysed = 0

    print(f"SMS analysis: {total} samples found")

    for i, wav_path in enumerate(wav_files, 1):
        out_path = wav_to_json_path(wav_path)

        if is_up_to_date(wav_path, out_path):
            skipped += 1
            continue

        rel = wav_path.resolve().relative_to(SAMPLES_DIR.resolve())
        print(f"  [{i}/{total}] {rel}")
        result = analyse_file(wav_path, out_path)
        print(
            f"           {len(result['partials'])} partials, "
            f"{result['num_frames']} frames"
        )
        analysed += 1

    print(f"\nDone: {analysed} analysed, {skipped} skipped (up to date)")


if __name__ == "__main__":
    main()
