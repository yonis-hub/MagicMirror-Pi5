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
VOICE_SINK="${VOICE_SINK:-bluez_output.FC_A8_9A_F6_FB_DA.1}"
VOICE_DEVICE_FALLBACK="${VOICE_DEVICE_FALLBACK:-plughw:CARD=ME6S,DEV=0}"
VOICE_PULSE_WAIT_SEC="${VOICE_PULSE_WAIT_SEC:-30}"
VOICE_REQUIRE_PULSE="${VOICE_REQUIRE_PULSE:-1}"
VOICE_SOURCE_VOLUME="${VOICE_SOURCE_VOLUME:-120%}"
VOICE_SINK_VOLUME="${VOICE_SINK_VOLUME:-100%}"
RUNTIME_UID="$(id -u)"
RUNTIME_DIR_DEFAULT="/run/user/${RUNTIME_UID}"

# Ensure user audio runtime env is available under systemd service context.
if [ -z "${XDG_RUNTIME_DIR:-}" ] || [[ "${XDG_RUNTIME_DIR}" == *"%"* ]] || [ ! -d "${XDG_RUNTIME_DIR}" ]; then
    if [ -d "$RUNTIME_DIR_DEFAULT" ]; then
        export XDG_RUNTIME_DIR="$RUNTIME_DIR_DEFAULT"
    fi
fi
if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -S "${XDG_RUNTIME_DIR}/pulse/native" ]; then
    if [ -z "${PULSE_SERVER:-}" ] || [[ "${PULSE_SERVER}" == *"%"* ]]; then
        export PULSE_SERVER="unix:${XDG_RUNTIME_DIR}/pulse/native"
    fi
fi

# Prefer shared Pulse capture and pin default source to the intended USB mic.
if [ "$VOICE_DEVICE" = "pulse" ] && command -v pactl >/dev/null 2>&1; then
    # Give PipeWire/Pulse a moment after boot before falling back.
    PULSE_READY=0
    for _ in $(seq 1 "$VOICE_PULSE_WAIT_SEC"); do
        if pactl info >/dev/null 2>&1; then
            PULSE_READY=1
            break
        fi
        sleep 1
    done

    if [ "$PULSE_READY" -eq 1 ]; then
        if pactl list sinks short | awk '{print $2}' | grep -Fxq "$VOICE_SINK"; then
            pactl set-default-sink "$VOICE_SINK" || true
            pactl set-sink-mute "$VOICE_SINK" 0 || true
            pactl set-sink-volume "$VOICE_SINK" "$VOICE_SINK_VOLUME" || true
            log "Pulse sink pinned: $VOICE_SINK"
        else
            log "WARNING: Pulse sink not found: $VOICE_SINK (using current default sink)"
        fi
        if pactl list sources short | awk '{print $2}' | grep -Fxq "$VOICE_SOURCE"; then
            pactl set-default-source "$VOICE_SOURCE" || true
            pactl set-source-mute "$VOICE_SOURCE" 0 || true
            pactl set-source-volume "$VOICE_SOURCE" "$VOICE_SOURCE_VOLUME" || true
            log "Pulse source pinned: $VOICE_SOURCE"
        else
            log "WARNING: Pulse source not found: $VOICE_SOURCE (using current default source)"
        fi
    else
        if [ "$VOICE_REQUIRE_PULSE" = "1" ]; then
            log "ERROR: Pulse server unavailable after ${VOICE_PULSE_WAIT_SEC}s; exiting for systemd retry."
            exit 1
        fi
        log "WARNING: Pulse server unavailable; falling back to ALSA device: $VOICE_DEVICE_FALLBACK"
        VOICE_DEVICE="$VOICE_DEVICE_FALLBACK"
    fi
elif [ "$VOICE_DEVICE" = "pulse" ]; then
    if [ "$VOICE_REQUIRE_PULSE" = "1" ]; then
        log "ERROR: pactl not found while Pulse is required; exiting for systemd retry."
        exit 1
    fi
    log "WARNING: pactl not found; falling back to ALSA device: $VOICE_DEVICE_FALLBACK"
    VOICE_DEVICE="$VOICE_DEVICE_FALLBACK"
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
