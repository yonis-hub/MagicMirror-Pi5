#!/usr/bin/env python3
"""
Simple Voice Listener for Quran Chainer
Uses arecord directly to avoid PyAudio channel issues

Usage: python3 voice_listener_simple.py
"""

import subprocess
import sys
import os
import signal
import time
import tempfile
import json
import base64
from pathlib import Path

try:
    import requests
except ImportError:
    print("Installing requests...")
    subprocess.run([sys.executable, "-m", "pip", "install", "requests", "--break-system-packages"])
    import requests

# Surah name mappings
SURAH_NAMES = {
    "fatiha": 1, "fatihah": 1, "opening": 1, "al fatiha": 1,
    "baqarah": 2, "baqara": 2, "cow": 2, "al baqarah": 2,
    "imran": 3, "ali imran": 3, "al imran": 3,
    "nisa": 4, "women": 4, "al nisa": 4,
    "maidah": 5, "maida": 5, "table": 5,
    "anam": 6, "cattle": 6,
    "araf": 7, "heights": 7,
    "anfal": 8,
    "tawbah": 9, "tawba": 9, "repentance": 9,
    "yunus": 10, "jonah": 10,
    "hud": 11,
    "yusuf": 12, "joseph": 12,
    "yasin": 36, "yaseen": 36, "ya sin": 36,
    "rahman": 55, "merciful": 55,
    "mulk": 67, "sovereignty": 67, "dominion": 67,
    "ikhlas": 112, "sincerity": 112, "purity": 112,
    "falaq": 113, "daybreak": 113,
    "nas": 114, "mankind": 114, "people": 114,
}

class SimpleVoiceListener:
    def __init__(self, device="hw:2,0", mirror_url="http://localhost:8080"):
        self.device = device
        self.mirror_url = mirror_url
        self.current_process = None
        self.is_running = True
        self.script_dir = Path(__file__).parent

    def record_audio(self, duration=4):
        """Record audio using arecord"""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_file = f.name

        try:
            # Record using arecord with ME6S settings (mono, 48kHz, 16-bit)
            cmd = [
                "arecord",
                "-D", self.device,
                "-f", "S16_LE",
                "-c", "1",
                "-r", "48000",
                "-d", str(duration),
                "-q",
                temp_file
            ]
            subprocess.run(cmd, capture_output=True, timeout=duration+2)
            return temp_file
        except Exception as e:
            print(f"Recording error: {e}")
            if os.path.exists(temp_file):
                os.unlink(temp_file)
            return None

    def transcribe_google(self, audio_file):
        """Transcribe audio using Google Web Speech API"""
        try:
            # Read the WAV file
            with open(audio_file, "rb") as f:
                audio_data = f.read()

            # Use Google's free web speech API
            url = "http://www.google.com/speech-api/v2/recognize"
            params = {
                "client": "chromium",
                "lang": "en-US",
                "key": "AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw"
            }
            headers = {"Content-Type": "audio/l16; rate=48000;"}

            # Convert WAV to raw PCM (skip 44-byte header)
            pcm_data = audio_data[44:]

            response = requests.post(url, params=params, headers=headers, data=pcm_data, timeout=10)

            # Parse response (returns multiple JSON objects)
            for line in response.text.strip().split("\n"):
                if line:
                    try:
                        result = json.loads(line)
                        if "result" in result and result["result"]:
                            alternatives = result["result"][0].get("alternative", [])
                            if alternatives:
                                return alternatives[0].get("transcript", "")
                    except json.JSONDecodeError:
                        pass
            return ""
        except Exception as e:
            print(f"Transcription error: {e}")
            return ""
        finally:
            if os.path.exists(audio_file):
                os.unlink(audio_file)

    def parse_command(self, text):
        """Parse voice command - requires wake word 'mirror'"""
        if not text:
            return (None, None)

        text = text.lower().strip()
        print(f"  Heard: '{text}'")

        # Check for wake word "mirror"
        if "mirror" not in text:
            return (None, None)

        # Stop commands: "Mirror Stop"
        if any(word in text for word in ["stop", "pause", "quiet", "silence"]):
            return ("stop", None)

        # Play commands: "Mirror Play Quran" or "Mirror Play Surah Fatiha"
        if "play" in text or "recite" in text or "read" in text:
            # Check for specific surah name
            for name, number in SURAH_NAMES.items():
                if name in text:
                    return ("play", number)

            # Try to find number
            words = text.split()
            for word in words:
                if word.isdigit():
                    num = int(word)
                    if 1 <= num <= 114:
                        return ("play", num)

            # "Mirror Play Quran" without surah = play Surah 1 (Al-Fatiha)
            if "quran" in text:
                return ("play", 1)

        return (None, None)

    def play_surah(self, surah_number):
        """Start playing a surah"""
        print(f"▶ Playing Surah {surah_number}...")
        self.stop_playback()

        script_path = self.script_dir / "quran_chainer.py"
        self.current_process = subprocess.Popen(
            ["python3", str(script_path), "--surah", str(surah_number), "--mirror-url", self.mirror_url],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT
        )

    def stop_playback(self):
        """Stop current playback"""
        if self.current_process:
            print("⏹ Stopping playback...")
            self.current_process.terminate()
            try:
                self.current_process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.current_process.kill()
            self.current_process = None
            subprocess.run(["pkill", "-f", "mpv"], capture_output=True)

    def listen_loop(self):
        """Main listening loop"""
        print("\n" + "="*50)
        print("🎙️  MIRROR VOICE LISTENER")
        print("="*50)
        print(f"Device: {self.device}")
        print("Wake word: 'Mirror'")
        print("")
        print("Commands:")
        print("  • 'Mirror Play Quran'")
        print("  • 'Mirror Play Surah Fatiha'")
        print("  • 'Mirror Play Surah 36'")
        print("  • 'Mirror Stop'")
        print("="*50 + "\n")
        print("Listening... (say 'Mirror' to start)")

        while self.is_running:
            try:
                # Record 4 seconds of audio
                audio_file = self.record_audio(4)
                if not audio_file:
                    continue

                # Transcribe
                text = self.transcribe_google(audio_file)

                if text:
                    action, value = self.parse_command(text)

                    if action == "play" and value:
                        self.play_surah(value)
                    elif action == "stop":
                        self.stop_playback()
                    else:
                        print(f"  (Not a command)")

            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"Error: {e}")
                time.sleep(1)

        print("\n👋 Voice listener stopped")
        self.stop_playback()

def signal_handler(sig, frame):
    print("\n\nShutting down...")
    sys.exit(0)

def main():
    signal.signal(signal.SIGINT, signal_handler)

    # Parse args
    device = "hw:2,0"  # ME6S mic
    mirror_url = "http://localhost:8080"

    for i, arg in enumerate(sys.argv):
        if arg == "--device" and i + 1 < len(sys.argv):
            device = sys.argv[i + 1]
        if arg == "--mirror-url" and i + 1 < len(sys.argv):
            mirror_url = sys.argv[i + 1]

    listener = SimpleVoiceListener(device=device, mirror_url=mirror_url)
    listener.listen_loop()

if __name__ == "__main__":
    main()
