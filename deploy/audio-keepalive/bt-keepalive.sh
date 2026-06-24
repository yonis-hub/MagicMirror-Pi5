#!/usr/bin/env bash
# bt-keepalive.sh — play a 1-second inaudible tone to the Bluetooth speaker
# so it doesn't drop into standby. When the speaker is asleep, the first
# 2-3s of the adhan get clipped while the BT link wakes back up — that's
# why prayer-time audio was getting missed.
#
# Strategy:
#   * Pre-generate a 1s 100Hz sine at -54dB (inaudible across the room)
#     once into /tmp.
#   * On each tick, skip if mpv is already playing (chainer/TTS in
#     progress — don't interrupt real audio).
#   * Otherwise, play the tone targeted at the BT sink.

set -u

# "auto" (default) discovers the connected Bluetooth sink at runtime instead of
# hardcoding a MAC. Keepalive only matters for Bluetooth, so if no bluez_output
# sink is present we simply exit — nothing to keep awake. Override BT_SINK with
# a concrete sink name to force a specific device.
BT_SINK="${BT_SINK:-auto}"
case "$(printf '%s' "$BT_SINK" | tr '[:upper:]' '[:lower:]')" in
  ""|auto|default)
    if command -v pactl >/dev/null 2>&1; then
      BT_SINK="$(pactl list short sinks 2>/dev/null | awk '{print $2}' | grep -m1 '^bluez_output\.' || true)"
    else
      BT_SINK=""
    fi
    if [[ -z "$BT_SINK" ]]; then
      logger -t bt-keepalive -- "No Bluetooth sink present; nothing to keep alive"
      exit 0
    fi
    ;;
esac
KEEPALIVE_SECONDS="${KEEPALIVE_SECONDS:-1.0}"
KEEPALIVE_FREQ_HZ="${KEEPALIVE_FREQ_HZ:-100}"
KEEPALIVE_VOLUME="${KEEPALIVE_VOLUME:-0.002}"   # ~-54dB
WAV="${KEEPALIVE_WAV_PATH:-/tmp/bt-keepalive.wav}"

log() { logger -t bt-keepalive -- "$*"; echo "[$(date '+%F %T')] $*"; }

# Skip if mpv is already playing (chainer / Quran / TTS active).
if pgrep -x mpv >/dev/null 2>&1; then
  log "Skipping — mpv is already active"
  exit 0
fi

# Generate the silence WAV the first time (or after /tmp clears at reboot).
if [[ ! -s "$WAV" ]]; then
  if ! command -v ffmpeg >/dev/null 2>&1; then
    log "ffmpeg not installed; cannot generate keepalive tone"
    exit 1
  fi
  ffmpeg -hide_banner -loglevel error -nostdin \
    -f lavfi -i "sine=frequency=${KEEPALIVE_FREQ_HZ}:duration=${KEEPALIVE_SECONDS}" \
    -af "volume=${KEEPALIVE_VOLUME}" \
    "$WAV" 2>/dev/null || {
      log "Failed to generate $WAV"
      exit 1
    }
fi

# Play the tone, scoped to the configured BT sink. mpv exits when done.
if ! command -v mpv >/dev/null 2>&1; then
  log "mpv not installed; cannot play keepalive"
  exit 1
fi

mpv --no-video --really-quiet --no-cache \
  --ao=pulse \
  --audio-device="pulse/${BT_SINK}" \
  --volume=100 "$WAV" >/dev/null 2>&1
rc=$?
if [[ $rc -ne 0 ]]; then
  log "mpv exit=$rc (BT speaker may be off or sink missing)"
else
  log "Played ${KEEPALIVE_SECONDS}s keepalive to ${BT_SINK}"
fi
