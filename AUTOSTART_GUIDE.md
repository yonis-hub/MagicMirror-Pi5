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
python3 voice_listener_ollama.py --parser-mode local --stt-model tiny --stt-language auto --wake-window-sec 2.5 --command-window-sec 3.5
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
python3 voice_listener_ollama.py --parser-mode local --stt-model tiny --stt-language auto --wake-window-sec 2.5 --command-window-sec 3.5
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
Environment="LISTENER_SCRIPT=voice_listener_ollama.py"
ExecStart=/home/pi/MagicMirror-Pi5/magicmirror/modules/MMM-QuranDisplay/start_listener.sh --parser-mode local --stt-model tiny --stt-language auto --wake-window-sec 2.5 --command-window-sec 3.5
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
