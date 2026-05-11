#!/usr/bin/env bash
# One-shot setup for the Phase 1-3 voice stack.
#
# Installs the v2 Python deps, downloads the Piper voice, and ensures
# the openWakeWord built-in models are cached. After this completes, run
# enroll_voice.py once to register your voice for speaker ID, then enable
# the v2 stack via env vars or start_listener.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR="${VENV_DIR:-$SCRIPT_DIR/venv}"
VOICES_DIR="${VOICES_DIR:-$SCRIPT_DIR/voices}"
WAKE_MODELS_DIR="${WAKE_MODELS_DIR:-$SCRIPT_DIR/wake_models}"
PIPER_VOICE="${PIPER_VOICE:-en_US-amy-medium}"
PIPER_VOICE_BASE_URL="${PIPER_VOICE_BASE_URL:-https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium}"

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

# --- Sanity checks ---
command -v python3 >/dev/null 2>&1 || fail "python3 not found"
command -v curl >/dev/null 2>&1 || fail "curl not found"

if [ ! -d "$VENV_DIR" ]; then
    log "Creating venv at $VENV_DIR..."
    python3 -m venv "$VENV_DIR"
fi
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

# --- Install Python deps ---
log "Installing v2 Python deps (may take several minutes on first run)..."
pip install --upgrade pip wheel
pip install -r requirements_v2.txt

# --- Download Piper voice (Phase 2) ---
mkdir -p "$VOICES_DIR"
ONNX_PATH="$VOICES_DIR/${PIPER_VOICE}.onnx"
JSON_PATH="$VOICES_DIR/${PIPER_VOICE}.onnx.json"

if [ ! -f "$ONNX_PATH" ]; then
    log "Downloading Piper voice $PIPER_VOICE..."
    curl -L --fail -o "$ONNX_PATH" "$PIPER_VOICE_BASE_URL/${PIPER_VOICE}.onnx"
fi
if [ ! -f "$JSON_PATH" ]; then
    log "Downloading Piper voice config..."
    curl -L --fail -o "$JSON_PATH" "$PIPER_VOICE_BASE_URL/${PIPER_VOICE}.onnx.json"
fi
log "Piper voice ready: $ONNX_PATH"

# --- openWakeWord built-in models (Phase 1) ---
log "Ensuring openWakeWord models are cached..."
python3 - <<'PY'
try:
    import openwakeword
    openwakeword.utils.download_models()
    print("  openWakeWord built-in models cached.")
except Exception as e:
    print(f"  openWakeWord model download skipped: {e}")
PY

mkdir -p "$WAKE_MODELS_DIR"

# --- silero-VAD warm-up (downloads weights on first use) ---
log "Warming up silero-VAD model..."
python3 - <<'PY'
try:
    from silero_vad import load_silero_vad
    load_silero_vad()
    print("  silero-VAD model cached.")
except Exception as e:
    print(f"  silero-VAD warm-up skipped: {e}")
PY

# --- Resemblyzer warm-up ---
log "Warming up Resemblyzer model..."
python3 - <<'PY'
try:
    from resemblyzer import VoiceEncoder
    VoiceEncoder()
    print("  Resemblyzer encoder cached.")
except Exception as e:
    print(f"  Resemblyzer warm-up skipped: {e}")
PY

echo
log "✅ v2 setup complete."
echo
echo "Next steps:"
echo "  1. Enrol your voice for speaker ID:"
echo "       python3 enroll_voice.py"
echo "  2. Restart the voice service:"
echo "       sudo systemctl restart quran-voice@hyonis.service"
echo
echo "All flags are on by default in start_listener.sh once you pull this commit."
