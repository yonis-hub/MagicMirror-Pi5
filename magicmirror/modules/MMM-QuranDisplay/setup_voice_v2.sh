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
PIPER_VOICE="${PIPER_VOICE:-en_US-amy-low}"
# Derive the download path from the voice name rather than hardcoding a quality
# level. This URL used to end in ".../amy/medium", so setting
# PIPER_VOICE=en_US-amy-low on its own fetched
# ".../amy/medium/en_US-amy-low.onnx" -- a 404, which aborts the whole setup
# under `curl --fail`.  en_US-amy-low  ->  en / en_US / amy / low
_piper_locale="${PIPER_VOICE%%-*}"
_piper_rest="${PIPER_VOICE#*-}"
_piper_name="${_piper_rest%%-*}"
_piper_quality="${_piper_rest##*-}"
_piper_lang="${_piper_locale%%_*}"
PIPER_VOICE_BASE_URL="${PIPER_VOICE_BASE_URL:-https://huggingface.co/rhasspy/piper-voices/resolve/main/${_piper_lang}/${_piper_locale}/${_piper_name}/${_piper_quality}}"

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

# silero-vad needs a working torch + torchaudio. On Pi 5 / Python 3.13
# the default piwheels build of torchaudio sometimes ships a binary that
# fails to load against the Pi's libc. Force the CPU build from PyTorch's
# official index first so torchaudio matches torch.
#
# PINNED, and pinned to the same version on purpose. The previous
# `--upgrade torch torchaudio` (no versions) took torch to 2.14.0 while leaving
# torchaudio at 2.11.0, because there is no cp313/aarch64 torchaudio wheel for
# 2.14 -- pip upgraded what it could and silently left the pair mismatched,
# which is the exact failure the comment above says this block exists to
# prevent. The two ship in lockstep and torchaudio links against a specific
# torch ABI, so bump them together or not at all. Override with
# TORCH_VERSION=... to test a newer pair.
TORCH_VERSION="${TORCH_VERSION:-2.11.0}"
log "Installing CPU torch + torchaudio ${TORCH_VERSION} (aarch64-compatible)..."
pip install --index-url https://download.pytorch.org/whl/cpu \
    --extra-index-url https://pypi.org/simple \
    "torch==${TORCH_VERSION}" "torchaudio==${TORCH_VERSION}" || \
    pip install "torch==${TORCH_VERSION}" "torchaudio==${TORCH_VERSION}"

pip install -r requirements_v2.txt

# openwakeword has tflite-runtime as a hard dep, which has no wheel for
# Python 3.13 / aarch64. We use ONNX inference anyway, so install --no-deps.
log "Installing openwakeword (--no-deps, ONNX-only inference)..."
pip install --no-deps "openwakeword>=0.6.0"

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
