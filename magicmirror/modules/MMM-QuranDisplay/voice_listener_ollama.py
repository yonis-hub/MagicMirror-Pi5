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
    import speech_recognition as sr
    from faster_whisper import WhisperModel
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "requests", "SpeechRecognition", "faster-whisper", "--break-system-packages"])
    import requests
    import speech_recognition as sr
    from faster_whisper import WhisperModel

# Complete Surah name mappings (all 114 surahs)
SURAH_NAMES = {
    # 1. Al-Fatiha
    "fatiha": 1, "fatihah": 1, "opening": 1, "al fatiha": 1,
    # 2. Al-Baqarah
    "baqarah": 2, "baqara": 2, "cow": 2, "al baqarah": 2,
    # 3. Ali 'Imran
    "imran": 3, "ali imran": 3, "al imran": 3, "family of imran": 3,
    # 4. An-Nisa
    "nisa": 4, "women": 4, "al nisa": 4, "an nisa": 4,
    # 5. Al-Ma'idah
    "maidah": 5, "maida": 5, "table": 5, "table spread": 5,
    # 6. Al-An'am
    "anam": 6, "cattle": 6, "an'am": 6, "livestock": 6,
    # 7. Al-A'raf
    "araf": 7, "heights": 7, "a'raf": 7,
    # 8. Al-Anfal
    "anfal": 8, "spoils of war": 8,
    # 9. At-Tawbah
    "tawbah": 9, "tawba": 9, "repentance": 9, "at tawbah": 9,
    # 10. Yunus
    "yunus": 10, "jonah": 10,
    # 11. Hud
    "hud": 11, "hood": 11,
    # 12. Yusuf
    "yusuf": 12, "joseph": 12,
    # 13. Ar-Ra'd
    "rad": 13, "ra'd": 13, "thunder": 13, "ar rad": 13,
    # 14. Ibrahim
    "ibrahim": 14, "abraham": 14,
    # 15. Al-Hijr
    "hijr": 15, "al hijr": 15, "rocky tract": 15,
    # 16. An-Nahl
    "nahl": 16, "bee": 16, "an nahl": 16,
    # 17. Al-Isra
    "isra": 17, "night journey": 17, "al isra": 17, "bani israil": 17,
    # 18. Al-Kahf
    "kahf": 18, "cave": 18, "al kahf": 18,
    # 19. Maryam
    "maryam": 19, "mary": 19,
    # 20. Ta-Ha
    "taha": 20, "ta ha": 20,
    # 21. Al-Anbiya
    "anbiya": 21, "prophets": 21, "al anbiya": 21,
    # 22. Al-Hajj
    "hajj": 22, "pilgrimage": 22, "al hajj": 22,
    # 23. Al-Mu'minun
    "muminun": 23, "mu'minun": 23, "believers": 23,
    # 24. An-Nur
    "nur": 24, "light": 24, "an nur": 24,
    # 25. Al-Furqan
    "furqan": 25, "criterion": 25, "al furqan": 25,
    # 26. Ash-Shu'ara
    "shuara": 26, "poets": 26, "ash shuara": 26,
    # 27. An-Naml
    "naml": 27, "ant": 27, "ants": 27, "an naml": 27,
    # 28. Al-Qasas
    "qasas": 28, "stories": 28, "al qasas": 28,
    # 29. Al-Ankabut
    "ankabut": 29, "spider": 29, "al ankabut": 29,
    # 30. Ar-Rum
    "rum": 30, "romans": 30, "ar rum": 30, "rome": 30,
    # 31. Luqman
    "luqman": 31, "lukman": 31,
    # 32. As-Sajdah
    "sajdah": 32, "sajda": 32, "prostration": 32,
    # 33. Al-Ahzab
    "ahzab": 33, "confederates": 33, "al ahzab": 33, "clans": 33,
    # 34. Saba
    "saba": 34, "sheba": 34,
    # 35. Fatir
    "fatir": 35, "originator": 35, "creator": 35,
    # 36. Ya-Sin
    "yasin": 36, "yaseen": 36, "ya sin": 36,
    # 37. As-Saffat
    "saffat": 37, "rangers": 37, "as saffat": 37,
    # 38. Sad
    "sad": 38, "saad": 38,
    # 39. Az-Zumar
    "zumar": 39, "troops": 39, "crowds": 39, "az zumar": 39,
    # 40. Ghafir
    "ghafir": 40, "forgiver": 40, "mumin": 40, "believer": 40,
    # 41. Fussilat
    "fussilat": 41, "explained in detail": 41, "ha mim": 41,
    # 42. Ash-Shura
    "shura": 42, "consultation": 42, "ash shura": 42,
    # 43. Az-Zukhruf
    "zukhruf": 43, "ornaments": 43, "gold": 43,
    # 44. Ad-Dukhan
    "dukhan": 44, "smoke": 44, "ad dukhan": 44,
    # 45. Al-Jathiyah
    "jathiyah": 45, "jathiya": 45, "kneeling": 45, "crouching": 45,
    # 46. Al-Ahqaf
    "ahqaf": 46, "sand dunes": 46, "al ahqaf": 46,
    # 47. Muhammad
    "muhammad": 47,
    # 48. Al-Fath
    "fath": 48, "victory": 48, "al fath": 48,
    # 49. Al-Hujurat
    "hujurat": 49, "rooms": 49, "chambers": 49, "al hujurat": 49,
    # 50. Qaf
    "qaf": 50,
    # 51. Adh-Dhariyat
    "dhariyat": 51, "winnowing winds": 51, "adh dhariyat": 51,
    # 52. At-Tur
    "tur": 52, "mount": 52, "at tur": 52,
    # 53. An-Najm
    "najm": 53, "star": 53, "an najm": 53,
    # 54. Al-Qamar
    "qamar": 54, "moon": 54, "al qamar": 54,
    # 55. Ar-Rahman
    "rahman": 55, "merciful": 55, "ar rahman": 55,
    # 56. Al-Waqi'ah
    "waqiah": 56, "waqia": 56, "event": 56, "inevitable": 56,
    # 57. Al-Hadid
    "hadid": 57, "iron": 57, "al hadid": 57,
    # 58. Al-Mujadila
    "mujadila": 58, "mujadilah": 58, "pleading woman": 58,
    # 59. Al-Hashr
    "hashr": 59, "exile": 59, "gathering": 59, "al hashr": 59,
    # 60. Al-Mumtahanah
    "mumtahanah": 60, "mumtahina": 60, "examined one": 60,
    # 61. As-Saff
    "saff": 61, "ranks": 61, "as saff": 61,
    # 62. Al-Jumu'ah
    "jumuah": 62, "juma": 62, "friday": 62, "congregation": 62,
    # 63. Al-Munafiqun
    "munafiqun": 63, "munafiqoon": 63, "hypocrites": 63,
    # 64. At-Taghabun
    "taghabun": 64, "mutual disillusion": 64,
    # 65. At-Talaq
    "talaq": 65, "divorce": 65, "at talaq": 65,
    # 66. At-Tahrim
    "tahrim": 66, "prohibition": 66, "at tahrim": 66,
    # 67. Al-Mulk
    "mulk": 67, "sovereignty": 67, "dominion": 67, "kingdom": 67,
    # 68. Al-Qalam
    "qalam": 68, "pen": 68, "al qalam": 68, "noon": 68,
    # 69. Al-Haqqah
    "haqqah": 69, "haqqa": 69, "reality": 69, "inevitable": 69,
    # 70. Al-Ma'arij
    "maarij": 70, "ma'arij": 70, "ascending stairways": 70,
    # 71. Nuh
    "nuh": 71, "noah": 71, "nooh": 71,
    # 72. Al-Jinn
    "jinn": 72, "al jinn": 72,
    # 73. Al-Muzzammil
    "muzzammil": 73, "enshrouded one": 73, "al muzzammil": 73,
    # 74. Al-Muddaththir
    "muddathir": 74, "muddaththir": 74, "cloaked one": 74,
    # 75. Al-Qiyamah
    "qiyamah": 75, "qiyama": 75, "resurrection": 75,
    # 76. Al-Insan
    "insan": 76, "dahr": 76, "human": 76, "man": 76, "time": 76,
    # 77. Al-Mursalat
    "mursalat": 77, "emissaries": 77, "al mursalat": 77,
    # 78. An-Naba
    "naba": 78, "news": 78, "tidings": 78, "an naba": 78, "announcement": 78,
    # 79. An-Nazi'at
    "naziat": 79, "nazi'at": 79, "extractors": 79, "an naziat": 79,
    # 80. Abasa
    "abasa": 80, "he frowned": 80,
    # 81. At-Takwir
    "takwir": 81, "at takwir": 81, "folding up": 81,
    # 82. Al-Infitar
    "infitar": 82, "cleaving": 82, "al infitar": 82,
    # 83. Al-Mutaffifin
    "mutaffifin": 83, "defrauding": 83, "al mutaffifin": 83,
    # 84. Al-Inshiqaq
    "inshiqaq": 84, "splitting open": 84, "al inshiqaq": 84,
    # 85. Al-Buruj
    "buruj": 85, "constellations": 85, "al buruj": 85, "zodiac": 85,
    # 86. At-Tariq
    "tariq": 86, "night comer": 86, "at tariq": 86, "morning star": 86,
    # 87. Al-A'la
    "ala": 87, "a'la": 87, "most high": 87, "al ala": 87,
    # 88. Al-Ghashiyah
    "ghashiyah": 88, "ghashiya": 88, "overwhelming": 88,
    # 89. Al-Fajr
    "fajr": 89, "dawn": 89, "al fajr": 89,
    # 90. Al-Balad
    "balad": 90, "city": 90, "al balad": 90,
    # 91. Ash-Shams
    "shams": 91, "sun": 91, "ash shams": 91,
    # 92. Al-Layl
    "layl": 92, "night": 92, "lail": 92, "al layl": 92,
    # 93. Ad-Duha
    "duha": 93, "morning hours": 93, "ad duha": 93, "forenoon": 93,
    # 94. Ash-Sharh
    "sharh": 94, "inshirah": 94, "relief": 94, "expansion": 94,
    # 95. At-Tin
    "tin": 95, "fig": 95, "at tin": 95,
    # 96. Al-Alaq
    "alaq": 96, "clot": 96, "al alaq": 96, "read": 96, "iqra": 96,
    # 97. Al-Qadr
    "qadr": 97, "power": 97, "decree": 97, "al qadr": 97, "destiny": 97,
    # 98. Al-Bayyinah
    "bayyinah": 98, "bayyina": 98, "clear evidence": 98,
    # 99. Az-Zalzalah
    "zalzalah": 99, "zalzala": 99, "earthquake": 99,
    # 100. Al-Adiyat
    "adiyat": 100, "chargers": 100, "al adiyat": 100,
    # 101. Al-Qari'ah
    "qariah": 101, "qaria": 101, "calamity": 101, "striking hour": 101,
    # 102. At-Takathur
    "takathur": 102, "rivalry": 102, "at takathur": 102, "competition": 102,
    # 103. Al-Asr
    "asr": 103, "time": 103, "afternoon": 103, "al asr": 103, "declining day": 103,
    # 104. Al-Humazah
    "humazah": 104, "humaza": 104, "slanderer": 104, "traducer": 104,
    # 105. Al-Fil
    "fil": 105, "elephant": 105, "al fil": 105,
    # 106. Quraysh
    "quraysh": 106, "quraish": 106, "qureysh": 106,
    # 107. Al-Ma'un
    "maun": 107, "ma'un": 107, "assistance": 107, "small kindnesses": 107,
    # 108. Al-Kawthar
    "kawthar": 108, "kausar": 108, "abundance": 108, "al kawthar": 108,
    # 109. Al-Kafirun
    "kafirun": 109, "kafiroon": 109, "disbelievers": 109, "al kafirun": 109,
    # 110. An-Nasr
    "nasr": 110, "victory": 110, "help": 110, "an nasr": 110, "divine support": 110,
    # 111. Al-Masad
    "masad": 111, "lahab": 111, "flame": 111, "al masad": 111, "palm fiber": 111,
    # 112. Al-Ikhlas
    "ikhlas": 112, "sincerity": 112, "purity": 112, "al ikhlas": 112,
    # 113. Al-Falaq
    "falaq": 113, "daybreak": 113, "al falaq": 113, "dawn": 113,
    # 114. An-Nas
    "nas": 114, "mankind": 114, "people": 114, "an nas": 114,
}

NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "twenty-one": 21, "twentyone": 21,
    "twenty-two": 22, "twentytwo": 22, "twenty-three": 23, "twentythree": 23,
    "thirty": 30, "thirty-six": 36, "thirtysix": 36,
    "forty": 40, "forty-six": 46, "fortysix": 46,
    "fifty": 50, "fifty-five": 55, "fiftyfive": 55,
    "sixty": 60, "sixty-seven": 67, "sixtyseven": 67,
    "seventy": 70, "seventy-two": 72, "seventytwo": 72,
    "eighty": 80, "ninety": 90, "hundred": 100,
}

COMMON_REPLACEMENTS = {
    # --- VOICE TRAINING / PRONUNCIATION FIXES ---
    # Add your specific misheard words here.
    # Format: "what google hears": "what you actually said"
    "place": "play",
    "plays": "play",
    "player": "play",
    "played": "play",
    "suits of": "surah",
    "surah of": "surah",
    "surat": "surah",
    "sutra": "surah",
    "sora": "surah",
    "fatah": "fatiha",
    "fatihat": "fatiha",
    "for to her": "fatiha",
    "fat to her": "fatiha",
    "yes seen": "yasin",
    "yassin": "yasin",
    "yacine": "yasin",
    "rock man": "rahman",
    "rockman": "rahman",
    "malik": "mulk",
    "coffee": "kahf",
    "calf": "kahf",
    "mirror": "mo",
    "mira": "mo",
    "mirae": "mo",
}

WAKE_WORDS = {"mo", "moe", "mow", "more", "moh", "mo."}


def normalize_surah(value):
    """Convert Ollama JSON surah field into an integer 1-114."""
    if value is None:
        return None

    if isinstance(value, int):
        return value if 1 <= value <= 114 else None

    text = str(value).lower().strip()

    if text.isdigit():
        num = int(text)
        return num if 1 <= num <= 114 else None

    # Remove common words like "surah" prefix
    text = text.replace("surah", "").strip()

    return SURAH_NAMES.get(text)

# Ollama configuration
OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3.2:1b"  # Better instruction following than tinyllama

# System prompt for Ollama
SYSTEM_PROMPT = """You are a voice command parser for a Quran player named Mo. Parse the user's command and respond ONLY with valid JSON.

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
- If the command doesn't include the wake word "Mo" (case-insensitive), return {"action": "none"}.

IMPORTANT: Respond with ONLY the JSON object, nothing else."""


class OllamaVoiceListener:
    def __init__(self, device="plughw:2,0", mirror_url="http://localhost:8080", ollama_url=OLLAMA_URL):
        self.device = device
        self.mirror_url = mirror_url
        self.ollama_url = ollama_url
        self.current_process = None
        self.is_running = True
        self.script_dir = Path(__file__).parent
        self.ollama_available = False

        # Initialize Whisper (loads model into RAM once)
        print("⏳ Loading Whisper model (tiny.en)...")
        self.whisper = WhisperModel("tiny.en", device="cpu", compute_type="int8")

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

    def normalize_speech(self, text):
        """Apply phonetic corrections to handle specific voice/pronunciation issues"""
        if not text:
            return ""
        text = text.lower().strip()
        for src, dst in COMMON_REPLACEMENTS.items():
            text = text.replace(src, dst)
        return text

    def record_audio(self, duration=5):
        """Record audio using arecord"""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            temp_file = f.name

        try:
            cmd = [
                "arecord", "-D", self.device,
                "-f", "S16_LE", "-c", "1", "-r", "16000",
                "-d", str(duration), "-q", temp_file
            ]
            result = subprocess.run(cmd, capture_output=True, timeout=duration+2)
            if result.returncode != 0:
                print(f"⚠ Recording failed (code {result.returncode}). Check device: {self.device}")
                return None
            return temp_file
        except Exception as e:
            print(f"Recording error: {e}")
            if os.path.exists(temp_file):
                os.unlink(temp_file)
            return None

    def transcribe_google(self, audio_file):
        """Transcribe audio using SpeechRecognition library"""
        recognizer = sr.Recognizer()
        try:
            with sr.AudioFile(audio_file) as source:
                # Adjust for ambient noise if necessary, but usually fine with file
                audio = recognizer.record(source)

            # Use the free Google Speech API
            text = recognizer.recognize_google(audio)
            return text
        except sr.UnknownValueError:
            # Speech was unintelligible
            return ""
        except sr.RequestError as e:
            print(f"Google Speech API error: {e}")
            return ""
        except Exception as e:
            print(f"Transcription error: {e}")
            return ""
        finally:
            if os.path.exists(audio_file):
                os.unlink(audio_file)

    def transcribe_whisper(self, audio_file):
        """Transcribe audio using Faster-Whisper"""
        try:
            segments, info = self.whisper.transcribe(
                audio_file,
                beam_size=5,
                language="en",
                vad_filter=True
            )
            text = " ".join(segment.text for segment in segments)
            return text.strip()
        except Exception as e:
            print(f"Whisper error: {e}")
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
                timeout=45
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
                        surah = normalize_surah(parsed.get("surah"))

                        if action == "play" and surah:
                            return ("play", surah)
                        elif action == "stop":
                            return ("stop", None)
                except json.JSONDecodeError:
                    pass
        except requests.exceptions.Timeout:
            print("  Ollama timed out, falling back to local parser...")
        except Exception as e:
            print(f"  Ollama error: {e}")

        return self.parse_fallback(text)

    def parse_fallback(self, text):
        """Fallback parser when Ollama unavailable"""
        if not text:
            return (None, None)

        words = text.split()

        if not any(word in WAKE_WORDS for word in words):
            return (None, None)

        if any(w in text for w in ["stop", "pause", "quiet", "silence", "halt", "end"]):
            return ("stop", None)

        if any(kw in text for kw in ["play", "recite", "read", "start"]):
            for name, number in SURAH_NAMES.items():
                if name in text:
                    return ("play", number)

            for word in words:
                if word.isdigit():
                    num = int(word)
                    if 1 <= num <= 114:
                        return ("play", num)
                if word in NUMBER_WORDS:
                    return ("play", NUMBER_WORDS[word])

            if any(k in text for k in ["quran", "koran", "quron"]):
                return ("play", 1)

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

    def send_listening_status(self, listening):
        """Send listening status to MagicMirror"""
        try:
            url = f"{self.mirror_url}/api/quran/listening"
            requests.post(url, json={"isListening": listening}, timeout=1)
        except Exception as e:
            print(f"⚠ Could not send listening status: {e}")

    def listen_loop(self):
        """Main listening loop"""
        print("\n" + "="*50)
        print("🤖  MO OLLAMA VOICE LISTENER")
        print("="*50)
        print(f"Device: {self.device}")
        print("  (Run 'arecord -l' to verify device index if not hearing audio)")
        print(f"Model: {OLLAMA_MODEL}")
        print("Wake word: 'Mo'")
        print("")
        print("Commands (natural language):")
        print("  • 'Mo, play Quran'")
        print("  • 'Mo, play Surah Yasin'")
        print("  • 'Mo, recite Al-Rahman'")
        print("  • 'Mo, stop'")
        print("  (Watch 'Raw Input' logs to add pronunciation fixes to COMMON_REPLACEMENTS)")
        print("="*50 + "\n")

        self.check_ollama()
        print("\nListening... (say 'Mo' to start)")

        while self.is_running:
            try:
                self.send_listening_status(True)
                audio_file = self.record_audio(3)
                if not audio_file:
                    continue

                text = self.transcribe_whisper(audio_file)

                if text:
                    print(f"  Raw Input: '{text}'")

                    # Apply voice corrections (The "Training" layer)
                    text_fixed = self.normalize_speech(text)
                    if text_fixed != text.lower():
                        print(f"  Processed: '{text_fixed}'")

                    if self.ollama_available:
                        action, value = self.parse_with_ollama(text_fixed)
                    else:
                        action, value = self.parse_fallback(text_fixed)

                    if action == "play" and value:
                        self.play_surah(value)
                    elif action == "stop":
                        self.stop_playback()
                    elif any(word in WAKE_WORDS for word in text.lower().split()):
                        print("  (Command not understood)")

            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"Error: {e}")
                time.sleep(1)
            finally:
                self.send_listening_status(False)

        print("\n👋 Voice listener stopped")
        self.stop_playback()


def signal_handler(sig, frame):
    print("\n\nShutting down...")
    sys.exit(0)


def main():
    signal.signal(signal.SIGINT, signal_handler)

    device = "plughw:2,0"  # Updated to card 2 based on 'arecord -l' output
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
