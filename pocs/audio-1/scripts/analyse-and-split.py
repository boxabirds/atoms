#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "soundfile", "librosa"]
# ///
"""
Analyse downloaded freesound samples, detect individual hits/events,
split into separate files with silence trimmed and short fade ramps.

- Moves originals to <category>/original/
- Writes split hits as <category>/01-<name>.wav, 02-<name>.wav, ...
- Preserves metadata.json in original/
- Each output file has one clear impulse/event
- 100-sample fade in/out to avoid clicks
- Continuous/textural sounds (>MAX_TRANSIENT_HITS onsets) get extracted as
  a few representative segments instead of hundreds of micro-slices
"""

import json
import os
import shutil
import sys

import librosa
import numpy as np
import soundfile as sf

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SAMPLES_DIR = os.path.join(SCRIPT_DIR, "..", "data", "samples")

FADE_SAMPLES = 100
SILENCE_THRESHOLD_DB = -40  # below this is "silence"
MIN_HIT_DURATION_S = 0.02  # ignore hits shorter than 20ms
# Minimum gap between onsets to consider them separate hits
MIN_ONSET_GAP_S = 0.05

# --- Texture / over-segmentation constants ---
# If onset detection finds more hits than this, treat the source as a
# continuous/textural sound and extract representative segments instead.
MAX_TRANSIENT_HITS = 10
# How many representative segments to extract from textural sounds
TEXTURE_SEGMENT_COUNT = 4
# Duration range (seconds) for each representative segment
TEXTURE_SEGMENT_MIN_S = 0.5
TEXTURE_SEGMENT_MAX_S = 2.0

AUDIO_EXTENSIONS = {".wav", ".mp3", ".flac", ".aiff", ".aif", ".ogg"}


def load_audio(path):
    """Load audio file, return (mono float32 array, sample_rate)."""
    y, sr = librosa.load(path, sr=None, mono=False)
    # If stereo, mix to mono for analysis but keep original channels
    if y.ndim > 1:
        y_mono = librosa.to_mono(y)
    else:
        y_mono = y
    # Also load the original channels for output
    y_orig, sr_orig = sf.read(path, always_2d=True)
    return y_mono, y_orig, sr


def detect_hits(y_mono, sr):
    """Detect individual hits/events in the audio. Returns list of (start_sample, end_sample)."""
    # Use onset detection
    onset_frames = librosa.onset.onset_detect(
        y=y_mono, sr=sr,
        hop_length=256,
        backtrack=True,
        units="frames",
    )

    if len(onset_frames) == 0:
        # No onsets detected — treat the whole file as one hit
        return [(0, len(y_mono))]

    onset_samples = librosa.frames_to_samples(onset_frames, hop_length=256)

    # Filter out onsets too close together
    min_gap_samples = int(MIN_ONSET_GAP_S * sr)
    filtered = [onset_samples[0]]
    for s in onset_samples[1:]:
        if s - filtered[-1] >= min_gap_samples:
            filtered.append(s)
    onset_samples = np.array(filtered)

    # Build hit regions: each hit starts at onset and ends where energy drops
    # below threshold or at the next onset
    threshold_linear = 10 ** (SILENCE_THRESHOLD_DB / 20.0)
    hits = []

    for i, start in enumerate(onset_samples):
        # End boundary: next onset or end of file
        if i + 1 < len(onset_samples):
            boundary = onset_samples[i + 1]
        else:
            boundary = len(y_mono)

        # Find where the signal drops below threshold before the boundary
        # Use a short RMS window to smooth
        segment = y_mono[start:boundary]
        if len(segment) == 0:
            continue

        # Compute envelope using RMS in short windows
        hop = 128
        rms_frames = []
        for j in range(0, len(segment), hop):
            chunk = segment[j:j + hop]
            rms_frames.append(np.sqrt(np.mean(chunk ** 2)))
        rms_arr = np.array(rms_frames)

        # Find last frame above threshold
        above = np.where(rms_arr > threshold_linear)[0]
        if len(above) == 0:
            continue

        end_frame = above[-1]
        end_sample = start + min((end_frame + 1) * hop + hop, boundary - start)
        end_sample = min(end_sample, boundary)

        duration_s = (end_sample - start) / sr
        if duration_s < MIN_HIT_DURATION_S:
            continue

        hits.append((int(start), int(end_sample)))

    if len(hits) == 0:
        # Fallback: whole file
        return [(0, len(y_mono))]

    return hits


def extract_texture_segments(y_mono, sr):
    """Extract evenly-spaced representative segments from a continuous/textural sound.

    Returns list of (start_sample, end_sample) for TEXTURE_SEGMENT_COUNT segments.
    """
    total_samples = len(y_mono)
    total_duration = total_samples / sr

    # Clamp segment duration to what the file can actually provide
    seg_duration_s = min(TEXTURE_SEGMENT_MAX_S, total_duration / TEXTURE_SEGMENT_COUNT)
    seg_duration_s = max(TEXTURE_SEGMENT_MIN_S, seg_duration_s)
    seg_samples = int(seg_duration_s * sr)

    # If the file is too short for even one segment at minimum duration, take the whole thing
    if total_samples < int(TEXTURE_SEGMENT_MIN_S * sr):
        return [(0, total_samples)]

    # Space segment start points evenly across the file, leaving room for
    # each segment's full length
    usable = total_samples - seg_samples
    if usable <= 0:
        return [(0, total_samples)]

    count = min(TEXTURE_SEGMENT_COUNT, max(1, int(total_duration / seg_duration_s)))
    if count == 1:
        # Centre a single segment
        mid = total_samples // 2
        start = max(0, mid - seg_samples // 2)
        return [(start, start + seg_samples)]

    step = usable / (count - 1)
    segments = []
    for i in range(count):
        start = int(i * step)
        end = min(start + seg_samples, total_samples)
        segments.append((start, end))

    return segments


def trim_silence(audio, sr, threshold_db=-40):
    """Trim silence from start and end. Returns (trimmed_audio, start_offset)."""
    threshold = 10 ** (threshold_db / 20.0)

    # Find first sample above threshold
    abs_audio = np.abs(audio) if audio.ndim == 1 else np.max(np.abs(audio), axis=1)
    above = np.where(abs_audio > threshold)[0]

    if len(above) == 0:
        return audio, 0

    start = max(0, above[0] - FADE_SAMPLES)  # keep a tiny margin for the fade
    end = min(len(audio), above[-1] + 1 + FADE_SAMPLES)

    return audio[start:end], start


def apply_fade(audio, fade_samples=FADE_SAMPLES):
    """Apply linear fade in/out to avoid clicks."""
    if len(audio) < fade_samples * 2:
        fade_samples = len(audio) // 2

    if fade_samples == 0:
        return audio

    audio = audio.copy()
    fade_in = np.linspace(0.0, 1.0, fade_samples, dtype=np.float32)
    fade_out = np.linspace(1.0, 0.0, fade_samples, dtype=np.float32)

    if audio.ndim == 1:
        audio[:fade_samples] *= fade_in
        audio[-fade_samples:] *= fade_out
    else:
        # Multi-channel
        for ch in range(audio.shape[1]):
            audio[:fade_samples, ch] *= fade_in
            audio[-fade_samples:, ch] *= fade_out

    return audio


def clean_split_files(cat_dir):
    """Remove previously-split audio files from the category root.

    Only removes files that look like split outputs (audio files not in original/).
    """
    removed = 0
    for f in os.listdir(cat_dir):
        if f == "original":
            continue
        full = os.path.join(cat_dir, f)
        if not os.path.isfile(full) or f.startswith("."):
            continue
        ext = os.path.splitext(f)[1].lower()
        if ext in AUDIO_EXTENSIONS:
            os.remove(full)
            removed += 1
    return removed


def process_category(cat_dir):
    """Process all audio files in a category directory."""
    cat_name = os.path.basename(cat_dir)
    orig_dir = os.path.join(cat_dir, "original")

    # --- Determine source files ---
    # If original/ exists and has audio, use those as sources (re-run case).
    # Otherwise look in the category root for un-split originals.
    source_files = []  # list of (filename, full_path)

    if os.path.isdir(orig_dir):
        for f in sorted(os.listdir(orig_dir)):
            if f == "metadata.json" or f.startswith("."):
                continue
            full = os.path.join(orig_dir, f)
            ext = os.path.splitext(f)[1].lower()
            if os.path.isfile(full) and ext in AUDIO_EXTENSIONS:
                source_files.append((f, full))

    if not source_files:
        # First-run: originals are still in the category root
        for f in sorted(os.listdir(cat_dir)):
            if f == "metadata.json" or f == "original":
                continue
            full = os.path.join(cat_dir, f)
            ext = os.path.splitext(f)[1].lower()
            if os.path.isfile(full) and not f.startswith(".") and ext in AUDIO_EXTENSIONS:
                source_files.append((f, full))

    if not source_files:
        return

    print(f"\n{'=' * 60}")
    print(f"Category: {cat_name} ({len(source_files)} source files)")
    print(f"{'=' * 60}")

    # Clean up any existing split files before re-processing
    removed = clean_split_files(cat_dir)
    if removed:
        print(f"  Cleaned {removed} previous split file(s)")

    # Ensure original/ dir exists
    os.makedirs(orig_dir, exist_ok=True)

    # Move metadata.json to original/ if still in root
    meta_src = os.path.join(cat_dir, "metadata.json")
    if os.path.exists(meta_src):
        shutil.move(meta_src, os.path.join(orig_dir, "metadata.json"))

    total_hits = 0

    for filename, src_path in source_files:
        name_base = os.path.splitext(filename)[0]

        print(f"\n  {filename}")

        try:
            y_mono, y_orig, sr = load_audio(src_path)
            duration_s = len(y_mono) / sr
            print(f"    Duration: {duration_s:.2f}s | SR: {sr} | Channels: {y_orig.shape[1] if y_orig.ndim > 1 else 1}")

            # Detect hits
            raw_hits = detect_hits(y_mono, sr)
            print(f"    Detected {len(raw_hits)} onset(s)")

            # Decide strategy: transient extraction vs. texture sampling
            if len(raw_hits) > MAX_TRANSIENT_HITS:
                hits = extract_texture_segments(y_mono, sr)
                print(f"    -> Textural sound: extracting {len(hits)} representative segment(s) instead")
            else:
                hits = raw_hits

            # Move original to original/ (only if source was in the root)
            dest_orig = os.path.join(orig_dir, filename)
            if src_path != dest_orig:
                if not os.path.exists(dest_orig):
                    shutil.move(src_path, dest_orig)
                else:
                    os.remove(src_path)

            # Extract and save each hit
            for hit_idx, (start, end) in enumerate(hits):
                # Extract from original channels
                if y_orig.ndim > 1:
                    hit_audio = y_orig[start:end, :]
                else:
                    hit_audio = y_orig[start:end]

                # Trim silence
                hit_audio, _ = trim_silence(hit_audio, sr)

                # Apply fade
                hit_audio = apply_fade(hit_audio)

                # Output filename
                if len(hits) == 1:
                    out_name = f"{name_base}.wav"
                else:
                    out_name = f"{name_base}-{hit_idx + 1:02d}.wav"

                out_path = os.path.join(cat_dir, out_name)
                sf.write(out_path, hit_audio, sr, subtype="PCM_16")

                hit_dur = len(hit_audio) / sr
                size_kb = os.path.getsize(out_path) / 1024
                print(f"    -> {out_name} ({hit_dur:.3f}s, {size_kb:.0f} KB)")
                total_hits += 1

        except Exception as e:
            print(f"    ERROR: {e}")
            import traceback
            traceback.print_exc()
            # Don't lose the original if processing fails
            if not os.path.exists(os.path.join(orig_dir, filename)):
                if os.path.exists(src_path):
                    shutil.move(src_path, os.path.join(orig_dir, filename))

    print(f"\n  Total: {total_hits} hits extracted from {len(source_files)} files")


def main():
    if not os.path.exists(SAMPLES_DIR):
        print(f"Samples directory not found: {SAMPLES_DIR}")
        sys.exit(1)

    categories = sorted([
        d for d in os.listdir(SAMPLES_DIR)
        if os.path.isdir(os.path.join(SAMPLES_DIR, d))
    ])

    print(f"Analysing {len(categories)} categories in {SAMPLES_DIR}")

    for cat in categories:
        cat_dir = os.path.join(SAMPLES_DIR, cat)
        process_category(cat_dir)

    print(f"\n{'=' * 60}")
    print("Done. Originals preserved in <category>/original/")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
