# Systemd Deployment (Pi 5 Wall Mirror)

Use these templates to keep Quran voice control stable after reboot and recover automatically if processes crash.

## 1) Install voice listener service

```bash
sudo cp ~/MagicMirror-Pi5/deploy/systemd/quran-voice@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now quran-voice@hyonis.service
```

Replace `hyonis` with your Pi username if different.

## 2) Tune Ollama for low RAM pressure

```bash
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo cp ~/MagicMirror-Pi5/deploy/systemd/ollama.service.d/override.conf /etc/systemd/system/ollama.service.d/
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

## 3) Verify runtime health

```bash
systemctl status quran-voice@hyonis --no-pager
systemctl status ollama --no-pager
journalctl -u quran-voice@hyonis -n 100 --no-pager
```

## Notes

- `quran-voice@.service` runs `start_listener.sh`, which already uses tuned defaults.
- MagicMirror UI can keep using your existing desktop autostart workflow.
- For strict local/offline playback, keep `quran_data` complete and avoid removing `quran_data/surah_index.json`.
