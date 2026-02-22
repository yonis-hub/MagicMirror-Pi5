# MagicMirror + Voice Autostart Guide (Pi 5)

This setup keeps the mirror UI visible and keeps voice control running all day with automatic restart.

## Recommended architecture

- `MagicMirror UI`: start from desktop autostart (needs active display session).
- `Quran voice listener`: run as `systemd` service (`Restart=always`).
- `Ollama`: run as `systemd` service with low-memory limits.

## 1) Desktop autostart for MagicMirror UI

```bash
mkdir -p ~/.config/autostart

cat > ~/start_mirror.sh << 'EOF'
#!/bin/bash
cd ~/MagicMirror-Pi5/magicmirror
npm run start
EOF

chmod +x ~/start_mirror.sh

cat > ~/.config/autostart/magicmirror.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=MagicMirror
Exec=/bin/bash -lc "~/start_mirror.sh"
X-GNOME-Autostart-enabled=true
EOF
```

## 2) Install always-on Quran voice service

The repo includes production-ready templates in `deploy/systemd`.

```bash
sudo cp ~/MagicMirror-Pi5/deploy/systemd/quran-voice@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now quran-voice@hyonis.service
```

Replace `hyonis` with your actual Pi username.

## 3) Apply Ollama low-memory override

```bash
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo cp ~/MagicMirror-Pi5/deploy/systemd/ollama.service.d/override.conf /etc/systemd/system/ollama.service.d/
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

## 4) Verify

```bash
systemctl status quran-voice@hyonis --no-pager
systemctl status ollama --no-pager
journalctl -u quran-voice@hyonis -n 100 --no-pager
```

## 5) Disable (if needed)

```bash
sudo systemctl disable --now quran-voice@hyonis
rm -f ~/.config/autostart/magicmirror.desktop
```

## Notes

- Local Quran playback uses `quran_data` first.
- Keep `quran_data/surah_index.json` in place for fast offline surah metadata.
- `start_listener.sh` now applies tuned defaults when no args are passed.
