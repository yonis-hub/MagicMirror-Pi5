# MagicMirror Voice Listener Autostart Guide

## System Setup
1. Install PulseAudio:
```bash
sudo apt install pulseaudio
```

2. Add user to audio group:
```bash
sudo usermod -aG audio $USER
```

3. Reboot system:
```bash
sudo reboot
```

## Enable Autostart
```bash
# Create autostart directory
mkdir -p ~/.config/autostart

# Create startup script
cat > ~/start_mirror.sh << 'EOF'
#!/bin/bash

# Start MagicMirror
cd ~/MagicMirror-Pi5/magicmirror
npm run start &

# Start voice listener
cd ~/MagicMirror-Pi5/magicmirror/modules/MMM-QuranDisplay
python3 voice_listener_ollama.py
EOF

# Make script executable
chmod +x ~/start_mirror.sh

# Create desktop entry
cat > ~/.config/autostart/magicmirror.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=MagicMirror with Voice Listener
Exec=/bin/bash -c "~/start_mirror.sh"
X-GNOME-Autostart-enabled=true
EOF
```

## Disable Autostart
```bash
# Remove autostart entry
rm ~/.config/autostart/magicmirror.desktop

# (Optional) Remove startup script
rm ~/start_mirror.sh
```

## Manual Start Commands
```bash
# Start MagicMirror
cd ~/MagicMirror-Pi5/magicmirror
npm run start

# Start voice listener
cd ~/MagicMirror-Pi5/magicmirror/modules/MMM-QuranDisplay
python3 voice_listener_ollama.py
```

## Service Configuration
1. Create systemd service file:
```bash
sudo nano /etc/systemd/system/mo-voice-listener.service
```

2. Add configuration:
```
[Unit]
Description=Mo Voice Listener for MagicMirror
After=network.target magicmirror.service

[Service]
User=pi
WorkingDirectory=/home/pi/MagicMirror-Pi5/magicmirror/modules/MMM-QuranDisplay
ExecStart=/home/pi/MagicMirror-Pi5/magicmirror/modules/MMM-QuranDisplay/start_listener.sh
Restart=always
RestartSec=10
Environment="DISPLAY=:0"
Environment="PULSE_SERVER=unix:/run/user/1000/pulse/native"

[Install]
WantedBy=multi-user.target
```

3. Enable service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable mo-voice-listener.service
sudo systemctl start mo-voice-listener.service
```

## Process Management
```bash
# Find running processes
pgrep -f "electron"          # MagicMirror
pgrep -f "voice_listener"    # Voice Listener

# Stop processes
pkill -f "electron"
pkill -f "voice_listener_ollama.py"
```

## Verification
```bash
# Check autostart file existence
ls ~/.config/autostart

# Check script contents
cat ~/start_mirror.sh

# Check service status
systemctl status mo-voice-listener.service

# Check logs
journalctl -u mo-voice-listener.service -f
```

## Troubleshooting

### Port 8080 Already in Use
If you get `Error: listen EADDRINUSE: address already in use 127.0.0.1:8080`:

```bash
# Find and kill the process
sudo lsof -i :8080
sudo kill -9 <PID>

# Or use fuser
sudo fuser -k 8080/tcp
```

### arecord Timeouts
If you see "Command timed out" errors:
1. Increase audio buffer size:
   ```bash
   sudo sh -c "echo 'options snd-usb-audio nrpacks=10' >> /etc/modprobe.d/alsa-base.conf"
   ```
2. Reload audio modules:
   ```bash
   sudo alsa force-reload
   ```
3. Try different audio devices:
   ```bash
   ./start_listener.sh --device plughw:2,0
   ./start_listener.sh --device default
   ```

### Microphone Volume Too Low
If your recordings are silent:
1. Boost the microphone volume:
   ```bash
   pactl set-source-volume @DEFAULT_SOURCE@ 150%
   ```
2. If that doesn't work, try setting the volume for your specific device:
   ```bash
   pactl list sources short
   pactl set-source-volume <source_index> 150%
   ```
3. Check the volume levels with:
   ```bash
   alsamixer
   ```

### Change MagicMirror Port
Edit `~/MagicMirror-Pi5/magicmirror/config/config.js` and change the `port` value:
```js
port: 8081, // or any free port

```
