#!/bin/bash
# Validate required dependencies
command -v python3 >/dev/null 2>&1 || { echo >&2 "Python3 required but not installed. Aborting."; exit 1; }
command -v ollama >/dev/null 2>&1 || { echo >&2 "Ollama required but not installed. Aborting."; exit 1; }

cd "$(dirname "$0")"
source venv/bin/activate
python voice_listener_ollama.py "$@"
