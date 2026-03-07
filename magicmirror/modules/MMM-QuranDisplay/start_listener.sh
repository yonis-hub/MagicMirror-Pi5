#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/voice_listener.log"
HEARTBEAT_FILE="${HEARTBEAT_FILE:-$LOG_DIR/voice_listener.heartbeat}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# Check Python
command -v python3 >/dev/null 2>&1 || { log "ERROR: python3 not found"; exit 1; }

# Activate venv if present
if [ -f "$SCRIPT_DIR/venv/bin/activate" ]; then
    source "$SCRIPT_DIR/venv/bin/activate"
else
    log "WARNING: No venv found at $SCRIPT_DIR/venv"
fi

# Ollama is optional
if command -v ollama >/dev/null 2>&1; then
    log "Ollama available"
else
    log "WARNING: Ollama not found -- running in fallback mode"
fi

LISTENER_SCRIPT="${LISTENER_SCRIPT:-voice_listener_ollama.py}"
if [ ! -f "$SCRIPT_DIR/$LISTENER_SCRIPT" ]; then
    log "ERROR: Listener script not found: $SCRIPT_DIR/$LISTENER_SCRIPT"
    exit 1
fi

# Constrain thread fanout for stable Pi thermals and predictable latency.
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-2}"
export OPENBLAS_NUM_THREADS="${OPENBLAS_NUM_THREADS:-2}"
export NUMEXPR_NUM_THREADS="${NUMEXPR_NUM_THREADS:-2}"
export PYTHONUNBUFFERED="${PYTHONUNBUFFERED:-1}"
VOICE_DEVICE="${VOICE_DEVICE:-pulse}"
VOICE_SOURCE="${VOICE_SOURCE:-alsa_input.usb-ME6S_MS_N-B_R-UN_ME6S-00.mono-fallback}"

# Prefer shared Pulse capture and pin default source to the intended USB mic.
if [ "$VOICE_DEVICE" = "pulse" ] && command -v pactl >/dev/null 2>&1; then
    if pactl list sources short | awk '{print $2}' | grep -Fxq "$VOICE_SOURCE"; then
        pactl set-default-source "$VOICE_SOURCE" || true
        log "Pulse source pinned: $VOICE_SOURCE"
    else
        log "WARNING: Pulse source not found: $VOICE_SOURCE"
    fi
fi

if [ "$#" -eq 0 ]; then
    # Tuned defaults for always-on wall mirror mode.
    set -- \
        --device "$VOICE_DEVICE" \
        --parser-mode hybrid \
        --stt-model tiny \
        --stt-language auto \
        --wake-window-sec 2.0 \
        --command-window-sec 3.0
fi

log "Voice input device: $VOICE_DEVICE"
log "Starting $LISTENER_SCRIPT..."
cd "$SCRIPT_DIR"
touch "$HEARTBEAT_FILE"

(
    while true; do
        touch "$HEARTBEAT_FILE"
        sleep 15
    done
) &
HEARTBEAT_PID=$!

set +e
python3 -u "$LISTENER_SCRIPT" "$@" 2>&1 | tee -a "$LOG_FILE"
PYTHON_EXIT=${PIPESTATUS[0]}
set -e

kill "$HEARTBEAT_PID" >/dev/null 2>&1 || true
wait "$HEARTBEAT_PID" 2>/dev/null || true

exit "$PYTHON_EXIT"
