#!/usr/bin/env python3
"""
Ollama-Powered Voice Listener for Quran Chainer
Uses Ollama AI to understand natural language commands

Usage: python3 voice_listener_ollama.py

Requirements:
- Ollama installed and running: curl -fsSL https://ollama.com/install.sh | sh
- Model pulled: ollama pull llama3.2:1b (or similar small model)
"""

import subprocess
import sys
import os
import signal
import time
import tempfile
import json
from pathlib import Path

try:
    import requests
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "requests", "--break-system-packages"])
    import requests

# Ollama configuration
OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3.2:1b"  # Small, fast model for Pi

# System prompt for Ollama
SYSTEM_PROMPT = """You are a voice command parser for a Quran player. Parse the user's command and respond ONLY with valid JSON.

Valid commands:
1. Play a surah: {"action": "play", "surah": <number 1-114>}
2. Stop playback: {"action": "stop"}
3. Not a valid command: {"action": "none"}

Surah number reference (common ones):
- Al-Fatiha: 1, Al-Baqarah: 2, Ali Imran: 3, An-Nisa: 4, Al-Maidah: 5
- Yasin: 36, Ar-Rahman: 55, Al-Mulk: 67, Al-Kahf: 18
- Al-Ikhlas: 112, Al-Falaq: 113, An-Nas: 114

If user says "play quran" without specifying, use surah 1.
If user mentions a surah name, convert it to the number.
If the command doesn't include the wake word "mirror", return {"action": "none"}.

IMPORTANT: Respond with ONLY the JSON object, nothing else."""


class OllamaVoiceListener:
    def __init__(self, device="hw:2,0", mirror_url="http://localhost:8080", ollama_url=OLLAMA_URL):
        self.device = device
        self.mirror_url = mirror_url
        self.ollama_url = ollama_url
        self.current_process = None
        self.is_running = True
        self.script_dir = Path(__file__).parent
        self.ollama_available = False

    def check_ollama(self):
        """Check if Ollama is running"""
        try:
            response = requests.get("http://localhost:11434/api/tags", timeout=2)
            if response.status_code == 200:
                models = response.json().get("models", [])
                model_names = [m.get("name", "") for m in models]
                print(f"✓ Ollama running. Models: {model_names}")
                self.ollama_available = True
                return True
        except:
            pass
        print("⚠ Ollama not running. Install with: curl -fsSL https://ollama.com/install.sh | sh")
        print("  Then run: ollama pull llama3.2:1b")
        return False

    def record_audio(self, duration=4):
        """Record audio using arecord"""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_file = f.name

        try:
            cmd = [
                "arecord", "-D", self.device,
                "-f", "S16_LE", "-c", "1", "-r", "48000",
                "-d", str(duration), "-q", temp_file
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
            with open(audio_file, "rb") as f:
                audio_data = f.read()

            url = "http://www.google.com/speech-api/v2/recognize"
            params = {"client": "chromium", "lang": "en-US", "key": "AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw"}
            headers = {"Content-Type": "audio/l16; rate=48000;"}
            pcm_data = audio_data[44:]  # Skip WAV header

            response = requests.post(url, params=params, headers=headers, data=pcm_data, timeout=10)

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

    def parse_with_ollama(self, text):
        """Use Ollama to parse command"""
        if not text or not self.ollama_available:
            return self.parse_fallback(text)

        try:
            prompt = f"User said: \"{text}\"\n\nParse this command:"

            response = requests.post(
                self.ollama_url,
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "system": SYSTEM_PROMPT,
                    "stream": False,
                    "options": {"temperature": 0.1}
                },
                timeout=30
            )

            if response.status_code == 200:
                result = response.json().get("response", "").strip()
                # Extract JSON from response
                try:
                    # Try to find JSON in response
                    if "{" in result and "}" in result:
                        json_str = result[result.find("{"):result.rfind("}")+1]
                        parsed = json.loads(json_str)
                        action = parsed.get("action", "none")
                        surah = parsed.get("surah")

                        if action == "play" and surah:
                            return ("play", int(surah))
                        elif action == "stop":
                            return ("stop", None)
                except json.JSONDecodeError:
                    pass
        except Exception as e:
            print(f"  Ollama error: {e}")

        return self.parse_fallback(text)

    def parse_fallback(self, text):
        """Fallback parser when Ollama unavailable"""
        if not text:
            return (None, None)

        text = text.lower().strip()

        # Require wake word
        if "mirror" not in text:
            return (None, None)

        # Stop
        if any(w in text for w in ["stop", "pause", "quiet"]):
            return ("stop", None)

        # Play
        if "play" in text or "recite" in text:
            # Check for number
            for word in text.split():
                if word.isdigit():
                    num = int(word)
                    if 1 <= num <= 114:
                        return ("play", num)

            # Default to Fatiha
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
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT
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
        print("🤖 OLLAMA VOICE LISTENER")
        print("="*50)
        print(f"Device: {self.device}")
        print(f"Model: {OLLAMA_MODEL}")
        print("Wake word: 'Mirror'")
        print("")
        print("Commands (natural language):")
        print("  • 'Mirror, play Quran'")
        print("  • 'Mirror, play Surah Yasin'")
        print("  • 'Mirror, recite Al-Rahman'")
        print("  • 'Mirror, stop'")
        print("="*50 + "\n")

        self.check_ollama()
        print("\nListening... (say 'Mirror' to start)")

        while self.is_running:
            try:
                audio_file = self.record_audio(4)
                if not audio_file:
                    continue

                text = self.transcribe_google(audio_file)

                if text:
                    print(f"  Heard: '{text}'")

                    if self.ollama_available:
                        action, value = self.parse_with_ollama(text)
                    else:
                        action, value = self.parse_fallback(text)

                    if action == "play" and value:
                        self.play_surah(value)
                    elif action == "stop":
                        self.stop_playback()
                    elif "mirror" in text.lower():
                        print("  (Command not understood)")

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

    device = "hw:2,0"
    mirror_url = "http://localhost:8080"

    for i, arg in enumerate(sys.argv):
        if arg == "--device" and i + 1 < len(sys.argv):
            device = sys.argv[i + 1]
        if arg == "--mirror-url" and i + 1 < len(sys.argv):
            mirror_url = sys.argv[i + 1]

    listener = OllamaVoiceListener(device=device, mirror_url=mirror_url)
    listener.listen_loop()


if __name__ == "__main__":
    main()
