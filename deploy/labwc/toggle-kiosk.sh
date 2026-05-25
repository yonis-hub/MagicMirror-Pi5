#!/usr/bin/env bash
# Bound to a labwc keybind so you can pop in/out of the Chromium kiosk
# without an SSH session — useful for plugging in a USB keyboard/mouse
# and needing access to the desktop briefly.
#
# Logic:
#   * If mm-kiosk is running   -> stop it   (desktop becomes visible)
#   * If mm-kiosk is stopped   -> start it  (kiosk returns)

set -euo pipefail

SERVICE="mm-kiosk.service"

if systemctl --user is-active --quiet "$SERVICE"; then
    systemctl --user stop "$SERVICE"
    # Optional desktop notification so you know what happened
    notify-send -t 2500 "MagicMirror" "Kiosk hidden — press Ctrl+Alt+K to bring it back" 2>/dev/null || true
else
    systemctl --user start "$SERVICE"
    notify-send -t 2500 "MagicMirror" "Kiosk relaunching..." 2>/dev/null || true
fi
