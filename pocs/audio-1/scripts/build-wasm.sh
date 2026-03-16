#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CRATE_DIR="$PROJECT_DIR/dsp-engine"
PKG_DIR="$CRATE_DIR/pkg"
PUBLIC_WASM_DIR="$PROJECT_DIR/public/wasm"

echo "=== Building synth gallery DSP engine ==="

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "Installing wasm-pack..."
  cargo install wasm-pack
fi

cd "$CRATE_DIR"
wasm-pack build --release --target web --out-dir pkg

# Copy WASM artifacts to public/ so they're served as static files
# (AudioWorklet processors can't go through Vite's module transform)
mkdir -p "$PUBLIC_WASM_DIR"
cp "$PKG_DIR/synth_gallery_dsp.js" "$PUBLIC_WASM_DIR/"
cp "$PKG_DIR/synth_gallery_dsp_bg.wasm" "$PUBLIC_WASM_DIR/"

echo "=== DSP engine build complete ==="
ls -lh "$PUBLIC_WASM_DIR"/ 2>/dev/null || true
