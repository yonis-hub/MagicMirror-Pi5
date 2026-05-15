#!/usr/bin/env bash
# wifi-watchdog.sh — recover Pi 5 Wi-Fi without a physical power cycle.
#
# Strategy (escalating, only on consecutive failures):
#   1. ip link down/up wlan0
#   2. NetworkManager: nmcli device disconnect/connect wlan0  (or restart NM)
#   3. rfkill block/unblock wifi  (software power-cycle of the radio)
#
# Each step is followed by a settle wait + re-test before escalating.
# Runs one pass per invocation; schedule via wifi-watchdog.timer.

set -u

IFACE="${WIFI_IFACE:-wlan0}"
PING_COUNT="${PING_COUNT:-3}"
PING_TIMEOUT="${PING_TIMEOUT:-3}"
SETTLE_SEC="${SETTLE_SEC:-15}"
STATE_DIR="/run/wifi-watchdog"
FAIL_FILE="${STATE_DIR}/fail_count"
LAST_ESC_FILE="${STATE_DIR}/last_escalation"

mkdir -p "$STATE_DIR"

log() { echo "[wifi-watchdog] $*"; }

get_gateway() {
  ip -4 route show default 0.0.0.0/0 dev "$IFACE" 2>/dev/null \
    | awk '/default/ {print $3; exit}'
}

probe() {
  local gw
  gw="$(get_gateway || true)"
  if [[ -n "${gw:-}" ]]; then
    ping -I "$IFACE" -c "$PING_COUNT" -W "$PING_TIMEOUT" -q "$gw" >/dev/null 2>&1 && return 0
  fi
  # Fallback: well-known anycast DNS
  ping -I "$IFACE" -c "$PING_COUNT" -W "$PING_TIMEOUT" -q 1.1.1.1 >/dev/null 2>&1 && return 0
  ping -I "$IFACE" -c "$PING_COUNT" -W "$PING_TIMEOUT" -q 8.8.8.8 >/dev/null 2>&1 && return 0
  return 1
}

read_count() {
  [[ -f "$FAIL_FILE" ]] && cat "$FAIL_FILE" || echo 0
}

write_count() { echo "$1" > "$FAIL_FILE"; }

escalate_iplink() {
  log "Cycling link on $IFACE (ip link down/up)"
  ip link set "$IFACE" down || true
  sleep 2
  ip link set "$IFACE" up || true
}

escalate_nm() {
  if command -v nmcli >/dev/null 2>&1; then
    log "NetworkManager reconnect on $IFACE"
    nmcli device disconnect "$IFACE" >/dev/null 2>&1 || true
    sleep 2
    nmcli device connect "$IFACE" >/dev/null 2>&1 || true
    sleep 3
    if ! probe; then
      log "Restarting NetworkManager"
      systemctl restart NetworkManager || true
    fi
  elif systemctl list-unit-files | grep -q "wpa_supplicant"; then
    log "Restarting wpa_supplicant + dhclient on $IFACE"
    systemctl restart "wpa_supplicant@${IFACE}.service" 2>/dev/null \
      || systemctl restart wpa_supplicant.service || true
    dhclient -r "$IFACE" >/dev/null 2>&1 || true
    dhclient "$IFACE" >/dev/null 2>&1 || true
  fi
}

escalate_rfkill() {
  if command -v rfkill >/dev/null 2>&1; then
    log "rfkill block/unblock wifi (software radio power-cycle)"
    rfkill block wifi || true
    sleep 3
    rfkill unblock wifi || true
    sleep 5
    # Some setups need NM nudged after rfkill
    if command -v nmcli >/dev/null 2>&1; then
      nmcli radio wifi on >/dev/null 2>&1 || true
      nmcli device connect "$IFACE" >/dev/null 2>&1 || true
    fi
  else
    log "rfkill not installed; skipping radio cycle"
  fi
}

# Always make sure power-save is off — it's the #1 cause of brcmfmac stalls.
if command -v iw >/dev/null 2>&1; then
  iw dev "$IFACE" set power_save off >/dev/null 2>&1 || true
fi

if probe; then
  if (( $(read_count) > 0 )); then
    log "Connectivity restored on $IFACE"
  fi
  write_count 0
  exit 0
fi

count=$(( $(read_count) + 1 ))
write_count "$count"
log "$IFACE probe failed (consecutive=$count)"

case "$count" in
  1)
    # First failure — don't act yet, could be transient.
    exit 0
    ;;
  2)
    echo "iplink" > "$LAST_ESC_FILE"
    escalate_iplink
    ;;
  3)
    echo "nm" > "$LAST_ESC_FILE"
    escalate_nm
    ;;
  *)
    echo "rfkill" > "$LAST_ESC_FILE"
    escalate_rfkill
    ;;
esac

sleep "$SETTLE_SEC"
if probe; then
  log "Recovery succeeded after step $(cat "$LAST_ESC_FILE" 2>/dev/null)"
  write_count 0
fi
