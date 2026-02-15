#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/voice_listener.log"

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
log "Starting $LISTENER_SCRIPT..."
cd "$SCRIPT_DIR"
python3 "$LISTENER_SCRIPT" "$@" 2>&1 | tee -a "$LOG_FILE"
