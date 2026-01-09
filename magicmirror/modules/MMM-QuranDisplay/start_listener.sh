#!/bin/bash

# Start MagicMirror server
cd ~/MagicMirror-Pi5/magicmirror
npm run server &

# Start voice listener in venv
cd ~/MagicMirror-Pi5/magicmirror/modules/MMM-QuranDisplay
source venv/bin/activate
python3 voice_listener_ollama.py
