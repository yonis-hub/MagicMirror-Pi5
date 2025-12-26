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

class SimpleVoiceListener:
    def __init__(self, device="hw:2,0", mirror_url="http://localhost:8080"):
        self.device = device
        self.mirror_url = mirror_url
        self.current_process = None
        self.is_running = True
        self.script_dir = Path(__file__).parent

    def record_audio(self, duration=3):
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

        # Fix common mishearings
        text = text.replace("place", "play")
        text = text.replace("plays", "play")
        text = text.replace("player", "play")
        text = text.replace("played", "play")
        text = text.replace("suits of", "surah")
        text = text.replace("surah of", "surah")
        text = text.replace("surat", "surah")
        text = text.replace("sutra", "surah")
        text = text.replace("sora", "surah")
        text = text.replace("fatah", "fatiha")
        text = text.replace("fatihat", "fatiha")
        text = text.replace("for to her", "fatiha")
        text = text.replace("fat to her", "fatiha")
        text = text.replace("yes seen", "yasin")
        text = text.replace("yassin", "yasin")
        text = text.replace("yacine", "yasin")
        text = text.replace("rock man", "rahman")
        text = text.replace("rockman", "rahman")
        text = text.replace("malik", "mulk")
        text = text.replace("coffee", "kahf")
        text = text.replace("calf", "kahf")

        # Check for wake word "mirror" or "mere" or "mira"
        has_wake_word = any(w in text for w in ["mirror", "mere", "mira", "mira", "mirar"])
        if not has_wake_word:
            return (None, None)

        # Stop commands: "Mirror Stop"
        if any(word in text for word in ["stop", "pause", "quiet", "silence", "halt", "end"]):
            return ("stop", None)

        # Play commands: "Mirror Play Quran" or "Mirror Play Surah Fatiha"
        if "play" in text or "recite" in text or "read" in text or "start" in text:
            # Check for specific surah name
            for name, number in SURAH_NAMES.items():
                if name in text:
                    return ("play", number)

            # Try to find number (including written numbers)
            words = text.split()
            number_words = {
                "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
                "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
                "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
                "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
                "thirty": 30, "thirty-six": 36, "thirtysix": 36,
                "fifty": 50, "fifty-five": 55, "fiftyfive": 55,
                "sixty": 60, "sixty-seven": 67, "sixtyseven": 67,
                "hundred": 100,
            }
            for word in words:
                if word.isdigit():
                    num = int(word)
                    if 1 <= num <= 114:
                        return ("play", num)
                if word in number_words:
                    return ("play", number_words[word])

            # "Mirror Play Quran" without surah = play Surah 1 (Al-Fatiha)
            if "quran" in text or "koran" in text or "quron" in text:
                return ("play", 1)

            # Just "mirror play" = play Surah 1
            if "play" in text:
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
                # Record 3 seconds of audio for better accuracy
                audio_file = self.record_audio(3)
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
