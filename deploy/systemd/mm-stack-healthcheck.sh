#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <username>"
  exit 1
fi

TARGET_USER="$1"
TARGET_UID="$(id -u "$TARGET_USER")"
REPO_DIR="/home/${TARGET_USER}/MagicMirror-Pi5"
HEARTBEAT_FILE="${REPO_DIR}/magicmirror/modules/MMM-QuranDisplay/logs/voice_listener.heartbeat"
VOICE_SERVICE="quran-voice@${TARGET_USER}.service"
# mm-server (node serveronly) + mm-kiosk (Chromium) are USER units. They
# replaced the old magicmirror@<user>.service, which this script used to watch
# by name -- and, because ensure_running() had no "is it installed" guard,
# actively *started* on every tick. The unit sets Restart=always, so one tick
# after boot was enough to pin a second, invisible MagicMirror for the rest of
# the uptime. Never reference that unit here again.
MIRROR_USER_SERVICES=("mm-server.service" "mm-kiosk.service")
HEARTBEAT_MAX_AGE_SEC="${HEARTBEAT_MAX_AGE_SEC:-120}"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

log() {
  echo "[$(timestamp)] $*"
}

# This script runs as root from a system unit (mm-healthcheck@.service), but
# mm-server/mm-kiosk live in the user manager, where a plain `systemctl
# is-active mm-server.service` would never find them. Reach them as the user.
uctl() {
  runuser -u "$TARGET_USER" -- \
    env "XDG_RUNTIME_DIR=/run/user/${TARGET_UID}" \
        "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${TARGET_UID}/bus" \
    systemctl --user "$@"
}

# `systemctl cat`, not a grep over list-unit-files: templated units such as
# quran-voice@hyonis.service are listed only as the template
# (quran-voice@.service) unless that exact instance is enabled, so grepping for
# the instance name reports a perfectly healthy unit as missing -- which would
# make this script skip the very restart it exists to perform. `cat` resolves
# the template and succeeds for both plain and instantiated units.
system_unit_installed() {
  systemctl cat "$1" >/dev/null 2>&1
}

# Every restart below is non-fatal on purpose. The script runs under
# `set -euo pipefail`, so an un-guarded `systemctl restart` of a missing or
# masked unit would abort the whole run -- taking the voice heartbeat check at
# the bottom with it, silently, for as long as that unit stayed broken.
ensure_system_running() {
  local svc="$1"
  if ! system_unit_installed "$svc"; then
    log "Not installed, skipping: ${svc}"
    return 0
  fi
  if systemctl is-active --quiet "$svc"; then
    return 0
  fi
  log "Service not active, restarting: ${svc}"
  systemctl restart "$svc" || log "WARN: restart failed: ${svc}"
}

ensure_user_running() {
  local svc="$1"
  if uctl is-active --quiet "$svc"; then
    return 0
  fi
  log "User service not active, restarting: ${svc}"
  uctl restart "$svc" || log "WARN: restart failed (user): ${svc}"
}

restart_voice() {
  local reason="$1"
  log "${reason}; restarting ${VOICE_SERVICE}"
  systemctl restart "$VOICE_SERVICE" || log "WARN: restart failed: ${VOICE_SERVICE}"
}

ensure_system_running "ollama.service"

for svc in "${MIRROR_USER_SERVICES[@]}"; do
  ensure_user_running "$svc"
done

ensure_system_running "$VOICE_SERVICE"

if [[ -f "$HEARTBEAT_FILE" ]]; then
  now_epoch=$(date +%s)
  hb_epoch=$(stat -c %Y "$HEARTBEAT_FILE")
  hb_age=$((now_epoch - hb_epoch))
  if (( hb_age > HEARTBEAT_MAX_AGE_SEC )); then
    restart_voice "Voice heartbeat is stale (${hb_age}s)"
  fi
else
  restart_voice "Voice heartbeat missing"
fi
