#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <username>"
  exit 1
fi

TARGET_USER="$1"
REPO_DIR="/home/${TARGET_USER}/MagicMirror-Pi5"
HEARTBEAT_FILE="${REPO_DIR}/magicmirror/modules/MMM-QuranDisplay/logs/voice_listener.heartbeat"
VOICE_SERVICE="quran-voice@${TARGET_USER}.service"
MIRROR_SERVICE="magicmirror@${TARGET_USER}.service"
HEARTBEAT_MAX_AGE_SEC="${HEARTBEAT_MAX_AGE_SEC:-120}"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  echo "[$(timestamp)] $*"
}

ensure_running() {
  local service_name="$1"
  if systemctl is-active --quiet "$service_name"; then
    return 0
  fi

  log "Service not active, restarting: ${service_name}"
  systemctl restart "$service_name"
}

if systemctl list-unit-files --type=service | grep -q '^ollama\.service'; then
  ensure_running "ollama.service"
fi

ensure_running "$MIRROR_SERVICE"
ensure_running "$VOICE_SERVICE"

if [[ -f "$HEARTBEAT_FILE" ]]; then
  now_epoch=$(date +%s)
  hb_epoch=$(stat -c %Y "$HEARTBEAT_FILE")
  hb_age=$((now_epoch - hb_epoch))
  if (( hb_age > HEARTBEAT_MAX_AGE_SEC )); then
    log "Voice heartbeat is stale (${hb_age}s), restarting ${VOICE_SERVICE}"
    systemctl restart "$VOICE_SERVICE"
  fi
else
  log "Voice heartbeat missing, restarting ${VOICE_SERVICE}"
  systemctl restart "$VOICE_SERVICE"
fi
