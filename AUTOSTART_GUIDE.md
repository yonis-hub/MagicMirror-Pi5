# MagicMirror Autostart Management Guide

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
```
