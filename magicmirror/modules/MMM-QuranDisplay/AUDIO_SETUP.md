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
pip install sounddevice soundfile SpeechRecognition pyaudio psutil
```

3. Test the microphone and speakers:
```bash
python pi_mic_test.py
```

## Important Note

Before starting the voice listener, ensure the MagicMirror server is running:
```bash
cd ~/MagicMirror-Pi5/magicmirror
npm run server
```

Keep this server process running in a separate terminal.

## Installing Additional Packages

If you need to install additional Python packages (like `numpy` for numerical computations), do so inside the virtual environment:
```bash
cd ~/MagicMirror-Pi5/magicmirror/modules/MMM-QuranDisplay
source venv/bin/activate
pip install numpy
```

## Install MPV

MPV is required for audio playback. Install it system-wide:
```bash
sudo apt install mpv
```

4. To run the voice listener, ensure the virtual environment is active and run:
```bash
python voice_listener_ollama.py
```

Note: Always activate the virtual environment before running the voice listener.
