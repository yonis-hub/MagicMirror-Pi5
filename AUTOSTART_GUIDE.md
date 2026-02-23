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
```

Replace `hyonis` with your actual Pi username.

## 5) Verify status

```bash
systemctl status magicmirror@hyonis --no-pager
systemctl status quran-voice@hyonis --no-pager
systemctl status mm-healthcheck@hyonis.timer --no-pager
systemctl status ollama --no-pager
```

## 6) Optional cleanup pass

```bash
bash ~/MagicMirror-Pi5/deploy/pi_cleanup.sh
bash ~/MagicMirror-Pi5/deploy/pi_cleanup.sh --apply
```

## Notes

- Voice heartbeat file is maintained automatically by `start_listener.sh`.
- Healthcheck timer restarts services if the heartbeat goes stale.
- Adhkar tracks are local-first from `magicmirror/modules/MMM-MyPrayerTimes/adhkar/`.
