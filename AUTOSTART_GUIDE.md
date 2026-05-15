# MagicMirror + Voice Autostart Guide (Pi 5)

This setup keeps the mirror UI and voice control running all day with auto-restart and health checks.

## Recommended architecture

- `magicmirror@<user>.service`: always-on MagicMirror UI process
- `quran-voice@<user>.service`: always-on wake-word + Quran voice listener
- `mm-healthcheck@<user>.timer`: every-minute watchdog that restarts unhealthy services
- `ollama.service`: low-memory tuned override for Pi stability

## 1) Pull latest repo on Pi

```bash
cd ~/MagicMirror-Pi5
git pull
```

## 2) Install systemd unit templates

```bash
sudo cp ~/MagicMirror-Pi5/deploy/systemd/magicmirror@.service /etc/systemd/system/
sudo cp ~/MagicMirror-Pi5/deploy/systemd/quran-voice@.service /etc/systemd/system/
sudo cp ~/MagicMirror-Pi5/deploy/systemd/mm-healthcheck@.service /etc/systemd/system/
sudo cp ~/MagicMirror-Pi5/deploy/systemd/mm-healthcheck@.timer /etc/systemd/system/
sudo cp ~/MagicMirror-Pi5/deploy/systemd/myscoreboard-update@.service /etc/systemd/system/
sudo cp ~/MagicMirror-Pi5/deploy/systemd/myscoreboard-update@.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

## 3) Apply Ollama low-memory override

```bash
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo cp ~/MagicMirror-Pi5/deploy/systemd/ollama.service.d/override.conf /etc/systemd/system/ollama.service.d/
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

## 4) Enable always-on services

```bash
sudo systemctl enable --now magicmirror@hyonis.service
sudo systemctl enable --now quran-voice@hyonis.service
sudo systemctl enable --now mm-healthcheck@hyonis.timer
sudo systemctl enable --now myscoreboard-update@hyonis.timer
```

Replace `hyonis` with your actual Pi username.

## 5) Verify status

```bash
systemctl status magicmirror@hyonis --no-pager
systemctl status quran-voice@hyonis --no-pager
systemctl status mm-healthcheck@hyonis.timer --no-pager
systemctl status myscoreboard-update@hyonis.timer --no-pager
systemctl status ollama --no-pager
```

Manual one-shot scoreboard update:

```bash
sudo systemctl start myscoreboard-update@hyonis.service
journalctl -u myscoreboard-update@hyonis.service -n 100 --no-pager
```

## 6) Wi-Fi stability (Pi 5 brcmfmac)

The on-board Wi-Fi can wedge so hard that only a power cycle recovers. Install the
power-save-off oneshot and the watchdog timer to recover automatically.

```bash
sudo cp ~/MagicMirror-Pi5/deploy/systemd/wifi-powersave-off.service /etc/systemd/system/
sudo cp ~/MagicMirror-Pi5/deploy/systemd/wifi-watchdog.service /etc/systemd/system/
sudo cp ~/MagicMirror-Pi5/deploy/systemd/wifi-watchdog.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wifi-powersave-off.service
sudo systemctl enable --now wifi-watchdog.timer
```

What it does:
- `wifi-powersave-off`: disables `power_save` on `wlan0` at boot (the #1 cause of drops).
- `wifi-watchdog`: every 60s pings the gateway via `wlan0`; on consecutive failures it escalates:
  1. `ip link` down/up
  2. NetworkManager disconnect/connect, then `systemctl restart NetworkManager`
  3. `rfkill block/unblock wifi` — software power-cycle of the radio (closest thing to unplugging the Pi)

Tail the watchdog log:

```bash
journalctl -u wifi-watchdog.service -f
```

## 7) Optional cleanup pass

```bash
bash ~/MagicMirror-Pi5/deploy/pi_cleanup.sh
bash ~/MagicMirror-Pi5/deploy/pi_cleanup.sh --apply
```

## Notes

- Voice heartbeat file is maintained automatically by `start_listener.sh`.
- Healthcheck timer restarts services if the heartbeat goes stale.
- Scoreboard updater timer refreshes `MMM-MyScoreboard` from upstream daily (plus boot-time run).
- Adhkar tracks are local-first from `magicmirror/modules/MMM-MyPrayerTimes/adhkar/`.
