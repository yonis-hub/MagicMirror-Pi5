#!/bin/bash
cd "$(dirname "$0")"
source venv/bin/activate
python voice_listener_ollama.py
