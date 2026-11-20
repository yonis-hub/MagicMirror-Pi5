#!/usr/bin/env bash
# Bound to Ctrl+Alt+K in labwc (install-kiosk-toggle.sh sets that up) so you
# can pop in/out of the Chromium kiosk from a keyboard plugged into the Pi,
# without an SSH session -- e.g. to reach the desktop's Bluetooth menu.
#
# Logic:
#   * If mm-kiosk is running   -> stop it   (desktop becomes visible)
#   * If mm-kiosk is stopped   -> start it  (kiosk returns)
#
# Stopping the unit is not enough on its own: mm-stack-healthcheck.sh restarts
# any stopped mirror unit every 60 s, so the kiosk used to reappear about a
# minute later. Hiding it therefore also drops a pause flag in the user's
# runtime dir, which the healthcheck honours for KIOSK_PAUSE_MAX_SEC (30 min
# by default) before bringing the kiosk back by itself. The runtime dir is a
# tmpfs, so a reboot clears the flag too.

set -euo pipefail

SERVICE="mm-kiosk.service"
PAUSE_FLAG="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/mm-kiosk-paused"

if systemctl --user is-active --quiet "$SERVICE"; then
    # Flag first, so a healthcheck tick landing between these two lines
    # cannot see a stopped kiosk without the flag and restart it.
    touch "$PAUSE_FLAG"
    systemctl --user stop "$SERVICE"
    notify-send -t 4000 "MagicMirror" \
        "Kiosk hidden. Press Ctrl+Alt+K to bring it back (it returns by itself after 30 min)." \
        2>/dev/null || true
else
    rm -f "$PAUSE_FLAG"
    systemctl --user start "$SERVICE"
    notify-send -t 2500 "MagicMirror" "Kiosk relaunching..." 2>/dev/null || true
fi
