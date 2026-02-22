# Raspberry Pi Audio Setup

Follow these steps to set up the audio environment for the voice listener:

1. Create and activate a virtual environment:
```bash
cd ~/MagicMirror-Pi5/magicmirror/modules/MMM-QuranDisplay
python3 -m venv venv
source venv/bin/activate
```

2. Install required Python packages:
```bash
pip install requests faster-whisper numpy sounddevice psutil
```

3. Verify the microphone device is visible:
```bash
arecord -l
```

## Important Note

Before starting the voice listener, ensure the MagicMirror server is running:
```bash
cd ~/MagicMirror-Pi5/magicmirror
npm run server
```

Keep this server process running in a separate terminal.

## Install MPV

`mpv` is required for audio playback. Install it system-wide:
```bash
sudo apt install mpv
```

4. To run the voice listener manually, ensure the virtual environment is active and run:
```bash
./start_listener.sh
```

Note: `start_listener.sh` applies tuned defaults if no arguments are provided.

For always-on boot setup, use the systemd templates in `deploy/systemd` at repo root.
