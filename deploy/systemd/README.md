# Systemd Deployment (Pi 5 Wall Mirror)

Use these templates to keep MagicMirror, Quran voice control, and Ollama stable after reboot with automatic recovery.

## 1) Install/refresh unit files

```bash
sudo cp ~/MagicMirror-Pi5/deploy/systemd/magicmirror@.service /etc/systemd/system/
sudo cp ~/MagicMirror-Pi5/deploy/systemd/quran-voice@.service /etc/systemd/system/
sudo cp ~/MagicMirror-Pi5/deploy/systemd/mm-healthcheck@.service /etc/systemd/system/
sudo cp ~/MagicMirror-Pi5/deploy/systemd/mm-healthcheck@.timer /etc/systemd/system/
sudo cp ~/MagicMirror-Pi5/deploy/systemd/myscoreboard-update@.service /etc/systemd/system/
sudo cp ~/MagicMirror-Pi5/deploy/systemd/myscoreboard-update@.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

## 2) Tune Ollama for low RAM pressure

```bash
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo cp ~/MagicMirror-Pi5/deploy/systemd/ollama.service.d/override.conf /etc/systemd/system/ollama.service.d/
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

## 3) Enable always-on services

```bash
sudo systemctl enable --now magicmirror@hyonis.service
sudo systemctl enable --now quran-voice@hyonis.service
sudo systemctl enable --now mm-healthcheck@hyonis.timer
sudo systemctl enable --now myscoreboard-update@hyonis.timer
```

Replace `hyonis` with your Pi username if different.

Optional (recommended) for Bluetooth speaker auto-reconnect:

```bash
sudo systemctl enable --now bluetooth
bluetoothctl devices
# Example:
# bluetoothctl trust FC:A8:9A:F6:FB:DA
# bluetoothctl connect FC:A8:9A:F6:FB:DA
```

## 4) Verify runtime health

```bash
systemctl status magicmirror@hyonis --no-pager
systemctl status quran-voice@hyonis --no-pager
systemctl status mm-healthcheck@hyonis.timer --no-pager
systemctl status myscoreboard-update@hyonis.timer --no-pager
systemctl status ollama --no-pager
journalctl -u magicmirror@hyonis -n 100 --no-pager
journalctl -u quran-voice@hyonis -n 100 --no-pager
journalctl -u myscoreboard-update@hyonis.service -n 100 --no-pager
```

Manual one-shot scoreboard refresh:

```bash
sudo systemctl start myscoreboard-update@hyonis.service
```

## 5) Disable (if needed)

```bash
sudo systemctl disable --now mm-healthcheck@hyonis.timer
sudo systemctl disable --now myscoreboard-update@hyonis.timer
sudo systemctl disable --now quran-voice@hyonis.service
sudo systemctl disable --now magicmirror@hyonis.service
```

## Notes

- `quran-voice@.service` now writes a heartbeat file used by `mm-healthcheck@.timer`.
- `quran-voice@.service` prefers Pulse/PipeWire with user runtime env, pins default sink/source, and retries on boot until Pulse is ready.
- `mm-healthcheck@.timer` runs every minute and restarts Mirror/voice/Ollama when unhealthy.
- `myscoreboard-update@.timer` runs daily (and shortly after boot), updates `MMM-MyScoreboard`, and restarts MagicMirror only when changes were applied.
- For strict local/offline Quran playback, keep `quran_data` complete.
