#!/usr/bin/env python3
"""
Voice Listener for Quran Chainer
Listens for voice commands via USB microphone and triggers quran_chainer.py

Commands supported:
- "play surah fatiha" / "play surah 1"
- "play surah baqarah" / "play surah 2"
- "stop" / "stop playing"
- "pause" / "resume"

Requirements:
- sudo apt install python3-pyaudio portaudio19-dev
- pip3 install SpeechRecognition --break-system-packages
"""

import speech_recognition as sr
import subprocess
import sys
import os
import signal
import time
from pathlib import Path

# Surah name mappings (common names to numbers)
SURAH_NAMES = {
    # Common names
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
    "rad": 13, "thunder": 13,
    "ibrahim": 14, "abraham": 14,
    "hijr": 15,
    "nahl": 16, "bee": 16,
    "isra": 17, "night journey": 17,
    "kahf": 18, "cave": 18,
    "maryam": 19, "mary": 19,
    "taha": 20,
    "yasin": 36, "yaseen": 36, "ya sin": 36,
    "rahman": 55, "merciful": 55,
    "waqiah": 56, "waqia": 56, "event": 56,
    "mulk": 67, "sovereignty": 67, "dominion": 67,
    "jinn": 72,
    "muzzammil": 73,
    "muddathir": 74, "muddaththir": 74,
    "qiyamah": 75, "resurrection": 75,
    "insan": 76, "dahr": 76, "human": 76,
    "naba": 78, "news": 78, "tidings": 78,
    "naziat": 79,
    "abasa": 80,
    "takwir": 81,
    "infitar": 82,
    "mutaffifin": 83,
    "inshiqaq": 84,
    "buruj": 85,
    "tariq": 86,
    "ala": 87, "most high": 87,
    "ghashiyah": 88, "ghashiya": 88,
    "fajr": 89, "dawn": 89,
    "balad": 90, "city": 90,
    "shams": 91, "sun": 91,
    "layl": 92, "night": 92, "lail": 92,
    "duha": 93, "morning": 93,
    "sharh": 94, "inshirah": 94,
    "tin": 95, "fig": 95,
    "alaq": 96, "clot": 96,
    "qadr": 97, "power": 97, "decree": 97,
    "bayyinah": 98, "bayyina": 98,
    "zalzalah": 99, "zalzala": 99, "earthquake": 99,
    "adiyat": 100,
    "qariah": 101, "qaria": 101,
    "takathur": 102,
    "asr": 103, "time": 103, "afternoon": 103,
    "humazah": 104, "humaza": 104,
    "fil": 105, "elephant": 105,
    "quraysh": 106, "quraish": 106,
    "maun": 107, "assistance": 107,
    "kawthar": 108, "kausar": 108, "abundance": 108,
    "kafirun": 109, "kafiroon": 109, "disbelievers": 109,
    "nasr": 110, "victory": 110, "help": 110,
    "masad": 111, "lahab": 111, "flame": 111,
    "ikhlas": 112, "sincerity": 112, "purity": 112,
    "falaq": 113, "daybreak": 113,
    "nas": 114, "mankind": 114, "people": 114,
}

class VoiceListener:
    def __init__(self, mirror_url="http://localhost:8080"):
        self.recognizer = sr.Recognizer()
        self.microphone = None
        self.mirror_url = mirror_url
        self.current_process = None
        self.is_running = True
        self.script_dir = Path(__file__).parent

        # Adjust for ambient noise
        self.recognizer.energy_threshold = 300
        self.recognizer.dynamic_energy_threshold = True
        self.recognizer.pause_threshold = 0.8

    def find_microphone(self):
        """Find and select USB microphone"""
        print("🎤 Searching for microphones...")

        mic_names = sr.Microphone.list_microphone_names()
        for i, name in enumerate(mic_names):
            print(f"  [{i}] {name}")

        # Try to find USB mic by common names
        usb_keywords = ["usb", "mic", "me6", "pnp", "audio"]
        for i, name in enumerate(mic_names):
            name_lower = name.lower()
            if any(kw in name_lower for kw in usb_keywords) and "hdmi" not in name_lower:
                print(f"✓ Selected: {name} (index {i})")
                # Use mono (1 channel) and 16kHz sample rate for compatibility
                return i

        # Fall back to last device (usually USB)
        if len(mic_names) > 0:
            print(f"✓ Using device index {len(mic_names)-1}")
            return len(mic_names) - 1

        return None

    def parse_command(self, text):
        """Parse voice command and return action"""
        text = text.lower().strip()
        print(f"  Heard: '{text}'")

        # Stop commands
        if any(word in text for word in ["stop", "pause", "quiet", "silence"]):
            return ("stop", None)

        # Resume command
        if "resume" in text or "continue" in text:
            return ("resume", None)

        # Play commands
        if "play" in text or "recite" in text or "read" in text:
            # Try to find surah name
            for name, number in SURAH_NAMES.items():
                if name in text:
                    return ("play", number)

            # Try to find number
            words = text.split()
            for i, word in enumerate(words):
                if word.isdigit():
                    surah_num = int(word)
                    if 1 <= surah_num <= 114:
                        return ("play", surah_num)

            # Check for "surah X" pattern
            if "surah" in text:
                idx = words.index("surah") if "surah" in words else -1
                if idx >= 0 and idx + 1 < len(words):
                    next_word = words[idx + 1]
                    if next_word.isdigit():
                        return ("play", int(next_word))
                    elif next_word in SURAH_NAMES:
                        return ("play", SURAH_NAMES[next_word])

        return (None, None)

    def play_surah(self, surah_number):
        """Start playing a surah"""
        print(f"▶ Playing Surah {surah_number}...")

        # Stop any currently playing surah
        self.stop_playback()

        # Start quran_chainer.py
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

            # Also kill any mpv processes
            subprocess.run(["pkill", "-f", "mpv"], capture_output=True)

    def listen_loop(self):
        """Main listening loop"""
        device_index = self.find_microphone()

        if device_index is None:
            print("❌ No microphone found!")
            return

        print("\n" + "="*50)
        print("🎙️  VOICE LISTENER ACTIVE")
        print("="*50)
        print("Say commands like:")
        print("  • 'Play Surah Fatiha'")
        print("  • 'Play Surah 36'")
        print("  • 'Play Yasin'")
        print("  • 'Stop'")
        print("="*50 + "\n")

        # Calibrate for ambient noise with specific device
        try:
            with sr.Microphone(device_index=device_index, sample_rate=16000) as source:
                print("🔇 Calibrating for ambient noise (2 seconds)...")
                self.recognizer.adjust_for_ambient_noise(source, duration=2)
                print("✓ Ready! Listening...\n")
        except Exception as e:
            print(f"⚠ Calibration error (continuing anyway): {e}")

        while self.is_running:
            try:
                with sr.Microphone(device_index=device_index, sample_rate=16000) as source:
                    # Listen for audio
                    audio = self.recognizer.listen(source, timeout=None, phrase_time_limit=5)

                # Try to recognize speech
                try:
                    text = self.recognizer.recognize_google(audio)
                    action, value = self.parse_command(text)

                    if action == "play" and value:
                        self.play_surah(value)
                    elif action == "stop":
                        self.stop_playback()
                    elif action == "resume":
                        print("Resume not yet implemented")
                    elif action is None:
                        print(f"  (Command not recognized)")

                except sr.UnknownValueError:
                    # Speech not understood - just continue listening
                    pass
                except sr.RequestError as e:
                    print(f"⚠ Google Speech API error: {e}")
                    print("  Retrying in 5 seconds...")
                    time.sleep(5)

            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"⚠ Error: {e}")
                time.sleep(1)

        print("\n👋 Voice listener stopped")
        self.stop_playback()

def signal_handler(sig, frame):
    """Handle Ctrl+C"""
    print("\n\nShutting down...")
    sys.exit(0)

def main():
    signal.signal(signal.SIGINT, signal_handler)

    mirror_url = "http://localhost:8080"

    # Parse command line args
    if "--mirror-url" in sys.argv:
        idx = sys.argv.index("--mirror-url")
        if idx + 1 < len(sys.argv):
            mirror_url = sys.argv[idx + 1]

    listener = VoiceListener(mirror_url=mirror_url)
    listener.listen_loop()

if __name__ == "__main__":
    main()
