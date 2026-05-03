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
VOICE_SOURCE="${VOICE_SOURCE:-alsa_input.usb-W1_W1_202505231443190-02.mono-fallback}"
VOICE_SINK="${VOICE_SINK:-bluez_output.FC_A8_9A_F6_FB_DA.1}"
VOICE_DEVICE_FALLBACK="${VOICE_DEVICE_FALLBACK:-plughw:CARD=W1,DEV=0}"
VOICE_PULSE_WAIT_SEC="${VOICE_PULSE_WAIT_SEC:-30}"
VOICE_REQUIRE_PULSE="${VOICE_REQUIRE_PULSE:-1}"
VOICE_SOURCE_VOLUME="${VOICE_SOURCE_VOLUME:-50%}"
VOICE_SILENCE_MAX_AMP="${VOICE_SILENCE_MAX_AMP:-180}"
VOICE_SILENCE_RMS_AMP="${VOICE_SILENCE_RMS_AMP:-35}"
VOICE_SINK_VOLUME="${VOICE_SINK_VOLUME:-50%}"
VOICE_APPLY_SINK_VOLUME_ON_START="${VOICE_APPLY_SINK_VOLUME_ON_START:-1}"
VOICE_ENFORCE_SINK_VOLUME="${VOICE_ENFORCE_SINK_VOLUME:-0}"
VOICE_BT_CARD="${VOICE_BT_CARD:-bluez_card.FC_A8_9A_F6_FB_DA}"
VOICE_BT_PROFILE="${VOICE_BT_PROFILE:-a2dp-sink}"
VOICE_AUTO_HEAL_SINK="${VOICE_AUTO_HEAL_SINK:-1}"
VOICE_AUTO_HEAL_INTERVAL_SEC="${VOICE_AUTO_HEAL_INTERVAL_SEC:-5}"
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
export PULSE_SOURCE="${PULSE_SOURCE:-$VOICE_SOURCE}"
export PULSE_SINK="${PULSE_SINK:-$VOICE_SINK}"
export QURAN_PULSE_SINK="${QURAN_PULSE_SINK:-$VOICE_SINK}"
export QURAN_PULSE_SINK_VOLUME="${QURAN_PULSE_SINK_VOLUME:-$VOICE_SINK_VOLUME}"
export VOICE_SILENCE_MAX_AMP
export VOICE_SILENCE_RMS_AMP

AUTO_HEAL_PID=""
start_audio_heal_loop() {
    if [ "$VOICE_DEVICE" != "pulse" ] || [ "$VOICE_AUTO_HEAL_SINK" != "1" ] || ! command -v pactl >/dev/null 2>&1; then
        return
    fi

    (
        last_state=""
        while true; do
            current_state="offline"
            if pactl info >/dev/null 2>&1; then
                if pactl list cards short | awk '{print $2}' | grep -Fxq "$VOICE_BT_CARD"; then
                    pactl set-card-profile "$VOICE_BT_CARD" "$VOICE_BT_PROFILE" || true
                fi
                if pactl list sinks short | awk '{print $2}' | grep -Fxq "$VOICE_SINK"; then
                    pactl set-default-sink "$VOICE_SINK" || true
                    pactl set-sink-mute "$VOICE_SINK" 0 || true
                    if [ "$VOICE_ENFORCE_SINK_VOLUME" = "1" ]; then
                        pactl set-sink-volume "$VOICE_SINK" "$VOICE_SINK_VOLUME" || true
                    fi

                    while read -r input_id _rest; do
                        [ -n "$input_id" ] || continue
                        pactl move-sink-input "$input_id" "$VOICE_SINK" || true
                    done < <(pactl list short sink-inputs)

                    current_state="ready"
                else
                    current_state="missing"
                fi

                if pactl list sources short | awk '{print $2}' | grep -Fxq "$VOICE_SOURCE"; then
                    pactl set-default-source "$VOICE_SOURCE" || true
                    pactl set-source-mute "$VOICE_SOURCE" 0 || true
                    pactl set-source-volume "$VOICE_SOURCE" "$VOICE_SOURCE_VOLUME" || true
                fi
            fi

            if [ "$current_state" != "$last_state" ]; then
                case "$current_state" in
                    ready)
                        log "Audio auto-heal: sink online, routed active streams -> $VOICE_SINK"
                        ;;
                    missing)
                        log "Audio auto-heal: waiting for sink -> $VOICE_SINK"
                        ;;
                    *)
                        log "Audio auto-heal: pulse unavailable, retrying"
                        ;;
                esac
                last_state="$current_state"
            fi
            sleep "$VOICE_AUTO_HEAL_INTERVAL_SEC"
        done
    ) &
    AUTO_HEAL_PID=$!
}

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
        if pactl list cards short | awk '{print $2}' | grep -Fxq "$VOICE_BT_CARD"; then
            pactl set-card-profile "$VOICE_BT_CARD" "$VOICE_BT_PROFILE" || true
            log "Pulse Bluetooth profile set: $VOICE_BT_CARD -> $VOICE_BT_PROFILE"
        fi
        if pactl list sinks short | awk '{print $2}' | grep -Fxq "$VOICE_SINK"; then
            pactl set-default-sink "$VOICE_SINK" || true
            pactl set-sink-mute "$VOICE_SINK" 0 || true
            if [ "$VOICE_APPLY_SINK_VOLUME_ON_START" = "1" ]; then
                pactl set-sink-volume "$VOICE_SINK" "$VOICE_SINK_VOLUME" || true
                log "Pulse sink start volume set: $VOICE_SINK -> $VOICE_SINK_VOLUME"
            fi
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
    # tiny = fastest STT (good enough for short commands)
    # local = no Ollama lag (instant response)
    set -- \
        --device "$VOICE_DEVICE" \
        --parser-mode local \
        --stt-model tiny \
        --stt-language en \
        --wake-window-sec 1.5 \
        --command-window-sec 2.0
fi

log "Voice input device: $VOICE_DEVICE"
start_audio_heal_loop
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
if [ -n "${AUTO_HEAL_PID:-}" ]; then
    kill "$AUTO_HEAL_PID" >/dev/null 2>&1 || true
    wait "$AUTO_HEAL_PID" 2>/dev/null || true
fi

exit "$PYTHON_EXIT"
