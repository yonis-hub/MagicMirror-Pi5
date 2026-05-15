#!/usr/bin/env bash
# disable-powersave.sh — turn off Wi-Fi power save on boot/network-online.
# Power save on the Pi 5 brcmfmac chip is the most common cause of Wi-Fi drops.

set -u
IFACE="${WIFI_IFACE:-wlan0}"

# Wait briefly for the interface to exist
for _ in $(seq 1 20); do
  [[ -d "/sys/class/net/${IFACE}" ]] && break
  sleep 1
done

if command -v iw >/dev/null 2>&1; then
  iw dev "$IFACE" set power_save off >/dev/null 2>&1 || true
fi

# NetworkManager-managed setting (persists across reconnects)
if command -v nmcli >/dev/null 2>&1; then
  while IFS= read -r conn; do
    [[ -z "$conn" ]] && continue
    nmcli connection modify "$conn" 802-11-wireless.powersave 2 >/dev/null 2>&1 || true
  done < <(nmcli -t -f NAME,TYPE connection show | awk -F: '$2=="802-11-wireless"{print $1}')
fi

echo "[wifi-powersave-off] power_save disabled on ${IFACE}"
