#!/usr/bin/env bash
# bt-reconnect.sh -- put the Bluetooth speaker back on the Pi when it drops.
#
# BlueZ only retries by itself after a link *loss* (speaker out of range, radio
# glitch). When someone else's phone connects to the speaker, the speaker hangs
# up on the Pi cleanly, BlueZ treats that as deliberate, and the mirror stays
# silent -- adhan included -- until somebody reconnects it by hand. The voice
# listener's auto-heal does not help here: it only fixes the Pulse profile of a
# card that already exists.
#
# bt-reconnect.timer runs this every minute and simply asks again. While the
# other device still holds the speaker the attempt fails harmlessly; once it
# lets go (or the speaker is switched back on), the Pi has it back within a
# minute.

set -u

MAC="${BT_SPEAKER_MAC:-FC:A8:9A:F6:FB:DA}"
PROFILE="${BT_SPEAKER_PROFILE:-a2dp-sink}"
CARD="bluez_card.${MAC//:/_}"
# Log a failure once per outage, not once a minute for as long as a phone
# holds the speaker.
FAIL_MARK="${XDG_RUNTIME_DIR:-/tmp}/bt-reconnect.failing"

log() { logger -t bt-reconnect -- "$*"; echo "[$(date '+%F %T')] $*"; }

is_connected() {
  bluetoothctl info "$MAC" 2>/dev/null | grep -q "Connected: yes"
}

if is_connected; then
  rm -f "$FAIL_MARK"
  exit 0
fi

info="$(bluetoothctl info "$MAC" 2>/dev/null || true)"
if ! grep -q "Paired: yes" <<<"$info"; then
  log "Speaker $MAC is not paired with this Pi; pair it once by hand (bluetoothctl pair $MAC)"
  exit 0
fi

if ! bluetoothctl show 2>/dev/null | grep -q "Powered: yes"; then
  bluetoothctl power on >/dev/null 2>&1 || log "Could not power on the Bluetooth adapter (rfkill?)"
fi

# Trusted devices may reconnect without a prompt; make sure it stays that way.
grep -q "Trusted: yes" <<<"$info" || bluetoothctl trust "$MAC" >/dev/null 2>&1

timeout 30 bluetoothctl connect "$MAC" >/dev/null 2>&1

if ! is_connected; then
  if [[ ! -e "$FAIL_MARK" ]]; then
    log "Speaker $MAC unreachable (off, out of range, or held by another device); retrying every minute"
    touch "$FAIL_MARK"
  fi
  exit 0
fi

rm -f "$FAIL_MARK"
log "Reconnected speaker $MAC"

# A fresh connection can come up in the headset (HFP) profile, which sounds
# terrible and drops the A2DP sink everything else is pinned to. Wait for
# PipeWire to publish the card, then force the music profile.
for _ in $(seq 1 10); do
  if pactl list cards short 2>/dev/null | awk '{print $2}' | grep -Fxq "$CARD"; then
    pactl set-card-profile "$CARD" "$PROFILE" 2>/dev/null \
      && log "Set $CARD profile to $PROFILE" \
      || log "Could not set $CARD profile to $PROFILE"
    break
  fi
  sleep 1
done
