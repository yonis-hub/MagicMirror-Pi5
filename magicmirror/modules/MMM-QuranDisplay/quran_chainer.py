#!/usr/bin/env python3
"""
Quran Verse Chainer for MagicMirror
Fetches verses from Al Quran Cloud API, plays audio via mpv,
and sends display updates to MMM-QuranDisplay module.

Usage:
    python3 quran_chainer.py --surah 1 --start-verse 1 --mirror-url http://localhost:8080
"""

import argparse
import json
import subprocess
import sys
import time
import requests
import signal

# Surah name mapping for voice command parsing
SURAH_NAMES = {
    "fatiha": 1, "baqara": 2, "imran": 3, "nisa": 4, "maida": 5,
    "anam": 6, "araf": 7, "anfal": 8, "tawba": 9, "yunus": 10,
    "hud": 11, "yusuf": 12, "rad": 13, "ibrahim": 14, "hijr": 15,
    "nahl": 16, "isra": 17, "kahf": 18, "maryam": 19, "taha": 20,
    "anbiya": 21, "hajj": 22, "muminun": 23, "nur": 24, "furqan": 25,
    "shuara": 26, "naml": 27, "qasas": 28, "ankabut": 29, "rum": 30,
    "luqman": 31, "sajda": 32, "ahzab": 33, "saba": 34, "fatir": 35,
    "yasin": 36, "saffat": 37, "sad": 38, "zumar": 39, "ghafir": 40,
    "fussilat": 41, "shura": 42, "zukhruf": 43, "dukhan": 44, "jathiya": 45,
    "ahqaf": 46, "muhammad": 47, "fath": 48, "hujurat": 49, "qaf": 50,
    "dhariyat": 51, "tur": 52, "najm": 53, "qamar": 54, "rahman": 55,
    "waqia": 56, "hadid": 57, "mujadila": 58, "hashr": 59, "mumtahina": 60,
    "saff": 61, "jumua": 62, "munafiqun": 63, "taghabun": 64, "talaq": 65,
    "tahrim": 66, "mulk": 67, "qalam": 68, "haqqa": 69, "maarij": 70,
    "nuh": 71, "jinn": 72, "muzzammil": 73, "muddaththir": 74, "qiyama": 75,
    "insan": 76, "mursalat": 77, "naba": 78, "naziat": 79, "abasa": 80,
    "takwir": 81, "infitar": 82, "mutaffifin": 83, "inshiqaq": 84, "buruj": 85,
    "tariq": 86, "ala": 87, "ghashiya": 88, "fajr": 89, "balad": 90,
    "shams": 91, "layl": 92, "duha": 93, "sharh": 94, "tin": 95,
    "alaq": 96, "qadr": 97, "bayyina": 98, "zalzala": 99, "adiyat": 100,
    "qaria": 101, "takathur": 102, "asr": 103, "humaza": 104, "fil": 105,
    "quraysh": 106, "maun": 107, "kawthar": 108, "kafirun": 109, "nasr": 110,
    "masad": 111, "ikhlas": 112, "falaq": 113, "nas": 114
}

class QuranChainer:
    def __init__(self, mirror_url="http://localhost:8080"):
        self.mirror_url = mirror_url
        self.is_paused = False
        self.is_stopped = False
        self.current_process = None

        # Handle signals for graceful shutdown
        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)

    def _signal_handler(self, signum, frame):
        print("\nReceived stop signal, cleaning up...")
        self.is_stopped = True
        if self.current_process:
            self.current_process.terminate()
        self._clear_display()
        sys.exit(0)

    def _send_to_mirror(self, endpoint, data):
        """Send data to MagicMirror API endpoint"""
        try:
            url = f"{self.mirror_url}/api/quran/{endpoint}"
            response = requests.post(url, json=data, timeout=5)
            if response.status_code == 200:
                print(f"  ✓ Sent to {endpoint}")
                return True
            else:
                print(f"  ✗ Mirror returned {response.status_code}: {response.text}")
                return False
        except requests.exceptions.RequestException as e:
            print(f"  ✗ Error sending to mirror: {e}")
            return False

    def _update_verse_display(self, arabic, translation, surah, verse, surah_info, is_playing=True):
        """Update the verse display on MagicMirror"""
        data = {
            "arabic": arabic,
            "translation": translation,
            "surah": surah,
            "verse": verse,
            "surahInfo": surah_info,
            "isPlaying": is_playing
        }
        return self._send_to_mirror("verse", data)

    def _update_playback_status(self, is_playing):
        """Update playback status indicator"""
        return self._send_to_mirror("status", {"isPlaying": is_playing})

    def _clear_display(self):
        """Clear the verse display"""
        return self._send_to_mirror("clear", {})

    def fetch_surah(self, surah_number):
        """Fetch surah data from Al Quran Cloud API"""
        print(f"Fetching Surah {surah_number}...")

        # Fetch Arabic text with Al-Afasy recitation
        arabic_url = f"http://api.alquran.cloud/v1/surah/{surah_number}/ar.alafasy"
        english_url = f"http://api.alquran.cloud/v1/surah/{surah_number}/en.asad"

        try:
            arabic_response = requests.get(arabic_url, timeout=30)
            english_response = requests.get(english_url, timeout=30)

            if arabic_response.status_code != 200 or english_response.status_code != 200:
                print(f"API Error: Arabic={arabic_response.status_code}, English={english_response.status_code}")
                return None

            arabic_data = arabic_response.json()["data"]
            english_data = english_response.json()["data"]

            # Combine data
            verses = []
            for i, (ar_ayah, en_ayah) in enumerate(zip(arabic_data["ayahs"], english_data["ayahs"])):
                verses.append({
                    "number": ar_ayah["numberInSurah"],
                    "arabic": ar_ayah["text"],
                    "translation": en_ayah["text"],
                    "audio": ar_ayah.get("audio", ar_ayah.get("audioSecondary", [None])[0] if ar_ayah.get("audioSecondary") else None)
                })

            surah_info = {
                "number": arabic_data["number"],
                "arabicName": arabic_data["name"],
                "englishName": arabic_data["englishName"],
                "englishNameTranslation": arabic_data["englishNameTranslation"],
                "totalVerses": arabic_data["numberOfAyahs"],
                "revelationType": arabic_data["revelationType"]
            }

            return {
                "surah_info": surah_info,
                "verses": verses
            }

        except requests.exceptions.RequestException as e:
            print(f"Error fetching surah: {e}")
            return None

    def play_audio(self, audio_url):
        """Play audio using mpv and wait for completion"""
        if not audio_url:
            print("No audio URL provided")
            time.sleep(3)  # Fallback delay for display viewing
            return False

        try:
            # Use mpv to play audio (quieter output)
            self.current_process = subprocess.Popen(
                ["mpv", "--no-video", "--really-quiet", audio_url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )

            # Wait for playback to complete
            while self.current_process.poll() is None:
                if self.is_stopped:
                    self.current_process.terminate()
                    return False

                # Check for pause (from stdin)
                while self.is_paused and not self.is_stopped:
                    time.sleep(0.1)

                time.sleep(0.1)

            self.current_process = None
            return True

        except FileNotFoundError:
            print("mpv not installed - using 3s delay for testing")
            time.sleep(3)  # Fallback delay when mpv not available
            return False
        except Exception as e:
            print(f"Error playing audio: {e}")
            time.sleep(3)  # Fallback delay
            return False

    def play_surah(self, surah_number, start_verse=1):
        """Play an entire surah verse by verse"""
        data = self.fetch_surah(surah_number)

        if not data:
            print("Failed to fetch surah data")
            return False

        surah_info = data["surah_info"]
        verses = data["verses"]

        print(f"\n▶ Playing: {surah_info['arabicName']} - {surah_info['englishName']}")
        print(f"  {surah_info['englishNameTranslation']}")
        print(f"  Total verses: {surah_info['totalVerses']}")
        print(f"  Starting from verse: {start_verse}\n")

        # Filter verses based on start_verse
        verses_to_play = [v for v in verses if v["number"] >= start_verse]

        for verse in verses_to_play:
            if self.is_stopped:
                break

            verse_num = verse["number"]
            print(f"  [{verse_num}/{surah_info['totalVerses']}] Playing verse...")

            # Update display
            self._update_verse_display(
                arabic=verse["arabic"],
                translation=verse["translation"],
                surah=surah_number,
                verse=verse_num,
                surah_info={
                    "arabicName": surah_info["arabicName"],
                    "englishName": surah_info["englishName"],
                    "totalVerses": surah_info["totalVerses"]
                },
                is_playing=True
            )

            # Play audio
            if verse.get("audio"):
                self.play_audio(verse["audio"])
            else:
                # Fallback: construct audio URL
                audio_url = f"https://cdn.islamic.network/quran/audio/128/ar.alafasy/{verse['number']}.mp3"
                self.play_audio(audio_url)

            # Brief pause between verses
            if not self.is_stopped:
                time.sleep(0.5)

        # Finished
        self._update_playback_status(False)
        print("\n✓ Playback complete")
        return True


def parse_surah_input(surah_input):
    """Parse surah input - can be number or name"""
    if isinstance(surah_input, int):
        return surah_input

    # Try as number
    try:
        return int(surah_input)
    except ValueError:
        pass

    # Try as name
    name = surah_input.lower().strip()
    for surah_name, num in SURAH_NAMES.items():
        if name in surah_name or surah_name in name:
            return num

    return None


def main():
    parser = argparse.ArgumentParser(description="Quran Verse Chainer for MagicMirror")
    parser.add_argument("--surah", "-s", required=True, help="Surah number or name (e.g., 1 or fatiha)")
    parser.add_argument("--start-verse", "-v", type=int, default=1, help="Starting verse number")
    parser.add_argument("--mirror-url", "-m", default="http://localhost:8080", help="MagicMirror URL")

    args = parser.parse_args()

    surah_number = parse_surah_input(args.surah)
    if not surah_number or surah_number < 1 or surah_number > 114:
        print(f"Invalid surah: {args.surah}")
        print("Valid range: 1-114 or surah name (e.g., fatiha, baqara, yasin)")
        sys.exit(1)

    chainer = QuranChainer(mirror_url=args.mirror_url)
    chainer.play_surah(surah_number, args.start_verse)


if __name__ == "__main__":
    main()
