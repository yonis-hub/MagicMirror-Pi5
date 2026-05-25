#!/usr/bin/env bash
# Pings the default gateway. After N consecutive failures, asks NetworkManager
# to reactivate the active Wi-Fi connection. Designed to be safe to call
# every minute from a systemd timer.

set -euo pipefail

INTERFACE="${WIFI_IFACE:-wlan0}"
THRESHOLD="${WIFI_FAIL_THRESHOLD:-3}"
STATE_FILE="${WIFI_STATE_FILE:-/var/lib/wifi-watchdog/fail-count}"
LOG_TAG="wifi-watchdog"

log() {
  logger -t "$LOG_TAG" -- "$*"
  echo "[$(date '+%F %T')] $*"
}

mkdir -p "$(dirname "$STATE_FILE")"
[[ -f "$STATE_FILE" ]] || echo "0" > "$STATE_FILE"
fail_count=$(cat "$STATE_FILE" 2>/dev/null || echo 0)

# Look up gateway via NetworkManager (falls back to default route).
gateway="$(nmcli -g IP4.GATEWAY device show "$INTERFACE" 2>/dev/null | head -1)"
if [[ -z "$gateway" ]]; then
  gateway="$(ip -4 route show default dev "$INTERFACE" 2>/dev/null | awk '{print $3; exit}')"
fi
if [[ -z "$gateway" ]]; then
  log "No default gateway for $INTERFACE; skipping ping. Will count as failure."
  fail_count=$((fail_count + 1))
  echo "$fail_count" > "$STATE_FILE"
else
  if ping -c1 -W2 -I "$INTERFACE" "$gateway" >/dev/null 2>&1; then
    if [[ "$fail_count" -gt 0 ]]; then
      log "Gateway $gateway reachable again on $INTERFACE; clearing fail count."
    fi
    echo "0" > "$STATE_FILE"
    exit 0
  fi
  fail_count=$((fail_count + 1))
  echo "$fail_count" > "$STATE_FILE"
  log "Gateway $gateway unreachable on $INTERFACE (fail $fail_count/$THRESHOLD)"
fi

if (( fail_count < THRESHOLD )); then
  exit 0
fi

# Threshold tripped — attempt graceful recovery escalating in severity.
active_conn="$(nmcli -t -f NAME,DEVICE connection show --active \
  | awk -F: -v iface="$INTERFACE" '$2==iface {print $1; exit}')"

if [[ -n "$active_conn" ]]; then
  log "Reactivating Wi-Fi connection: $active_conn"
  nmcli connection down "$active_conn" || true
  sleep 2
  if nmcli connection up "$active_conn" >/dev/null 2>&1; then
    log "Reactivation succeeded."
    echo "0" > "$STATE_FILE"
    exit 0
  fi
  log "Reactivation failed; falling through to harder reset."
fi

log "Cycling $INTERFACE radio..."
nmcli radio wifi off || true
sleep 3
nmcli radio wifi on || true
sleep 5

# Final escalation: restart NetworkManager itself.
if ! ping -c1 -W3 -I "$INTERFACE" "${gateway:-1.1.1.1}" >/dev/null 2>&1; then
  log "Still no gateway; restarting NetworkManager."
  systemctl restart NetworkManager || true
fi

# Reset the counter either way — next tick will recheck.
echo "0" > "$STATE_FILE"
