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
import re
from collections import deque
from pathlib import Path
import requests
import numpy as np
import sounddevice as sd
from python_mpv_jsonipc import MPV

try:
    import requests
    import speech_recognition as sr
    from faster_whisper import WhisperModel
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "requests", "SpeechRecognition", "faster-whisper", "--break-system-packages"])
    import requests
    import speech_recognition as sr
    from faster_whisper import WhisperModel

def check_server_ready():
    for _ in range(10):
        try:
            response = requests.get("http://localhost:8080", timeout=2)
            if response.status_code == 200:
                return True
        except requests.ConnectionError:
            time.sleep(1)
    return False

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
    "play it": "play",
    "play item": "play",
    "mode": "mo",
    "more": "mo",
    "moe": "mo",
    "sir": "surah",
    "sarah": "surah",
    "circle": "surah",
    "two": "2",
    "too": "2",
    "to": "2",
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
    "move": "mo",
    "so": "mo",
    "show": "mo",
    "s2p": "stop",
}

PHRASE_REPLACEMENTS = {k: v for k, v in COMMON_REPLACEMENTS.items() if " " in k}
WORD_REPLACEMENTS = {k: v for k, v in COMMON_REPLACEMENTS.items() if " " not in k}
WORD_REPLACEMENT_PATTERN = re.compile(
    r"\b(" + "|".join(map(re.escape, WORD_REPLACEMENTS.keys())) + r")\b"
) if WORD_REPLACEMENTS else None

WAKE_WORDS = {"mo", "moe", "mow", "more", "moh", "mo.", "mohammed", "mohammad", "mohamed", "mohd", "mohamad", "mohd."}

STOP_KEYWORDS = {"stop", "pause", "quiet", "silence", "halt", "end", "cancel"}
PLAY_KEYWORDS = {"play", "recite", "read", "start", "resume", "continue"}
SEARCH_KEYWORDS = {"search", "find", "look"}
COMMAND_KEYWORDS = STOP_KEYWORDS | PLAY_KEYWORDS | SEARCH_KEYWORDS

EMBEDDING_DIR = Path(__file__).parent / "embeddings"
EMBEDDING_VECTOR_PATH = EMBEDDING_DIR / "verse_embeddings.npy"
EMBEDDING_META_PATH = EMBEDDING_DIR / "verse_metadata.json"

MOOD_TO_SURAH = {
    "calm": 55,
    "soothing": 55,
    "focus": 36,
    "motivated": 94,
    "inspiration": 19,
    "sleep": 67
}

TOPIC_SYNONYMS = {
    "mercy": "mercy",
    "forgiveness": "forgiveness",
    "patience": "patience",
    "gratitude": "gratitude",
    "hope": "hope",
    "protection": "protection"
}

TOPIC_TO_VERSE = {
    "mercy": (19, 21),
    "forgiveness": (39, 53),
    "patience": (2, 153),
    "gratitude": (14, 7),
    "hope": (65, 2),
    "protection": (18, 10)
}

SPECIAL_VERSES = {
    "ayatul kursi": (2, 255),
    "last two of baqarah": (2, 285),
    "surah mulk": (67, 1)
}

MAX_HISTORY = 5
FOLLOWUP_WINDOW_SECONDS = 10
DEFAULT_CONFIDENCE = 0.65

def clamp_confidence(value, default=DEFAULT_CONFIDENCE):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, value))

def coerce_int(value):
    try:
        if value is None:
            return None
        return int(value)
    except (TypeError, ValueError):
        return None

def create_intent(action="none", surah=None, topic=None, mood=None, verse_start=None, verse_end=None, confidence=DEFAULT_CONFIDENCE, reason=None, follow_up=False):
    return {
        "action": action,
        "surah": surah,
        "topic": topic,
        "mood": mood,
        "verse_start": verse_start,
        "verse_end": verse_end,
        "confidence": clamp_confidence(confidence),
        "reason": reason,
        "follow_up": bool(follow_up)
    }

RANGE_PATTERN = re.compile(r"(verse|ayah)?\s*(\d+)(?:\s*(to|-)\s*(\d+))?", re.IGNORECASE)

def extract_slots(text):
    slots = {"numbers": [], "ranges": []}
    if not text:
        return slots
    for match in RANGE_PATTERN.finditer(text):
        start = int(match.group(2))
        end = int(match.group(4)) if match.group(4) else None
        if end and end < start:
            start, end = end, start
        slots["ranges"].append((start, end))
    for token in tokenize_words(text):
        if token.isdigit():
            slots["numbers"].append(int(token))
    return slots

def tokenize_words(text):
    """Split text into lowercase words without punctuation."""
    if not text:
        return []
    tokens = []
    for word in text.split():
        cleaned = word.strip(".,!?\"':;()[]{}")
        if cleaned:
            tokens.append(cleaned.lower())
    return tokens

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

def extract_surah_number(text):
    """Extract a surah number from free-form text."""
    if not text:
        return None

    lower_text = text.lower()

    for name, number in SURAH_NAMES.items():
        if name in lower_text:
            return number

    tokens = tokenize_words(lower_text)
    for token in tokens:
        if token.isdigit():
            num = int(token)
            if 1 <= num <= 114:
                return num
        if token in NUMBER_WORDS:
            return NUMBER_WORDS[token]

    return None

def check_server_ready():
    for _ in range(10):
        try:
            response = requests.get("http://localhost:8080", timeout=2)
            if response.status_code == 200:
                return True
        except requests.ConnectionError:
            time.sleep(1)
    return False

# Ollama configuration
OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3.2:1b-Q4_K_M"  # Quantized model for efficiency

# System prompt for Ollama
SYSTEM_PROMPT = """You are a conversational intent parser for Mo, a Quran reciter.
Use the conversation context provided and respond ONLY with valid JSON.

JSON schema (all keys required):
{
  "action": "play" | "play_verse" | "stop" | "search" | "none",
  "surah": <number 1-114 or null>,
  "topic": "<short topic>" | null,
  "mood": "<optional mood adjective>" | null,
  "verse_start": <verse number or null>,
  "verse_end": <verse number or null>,
  "confidence": <float 0-1>,
  "reason": "<short explanation>" | null,
  "follow_up_needed": true | false
}

Guidelines:
- Respect the latest context summary when resolving references like "same one" or "resume".
- Use "play_verse" when the user asks for a specific verse or Ayah.
- Use "search" only when you need Mo to find a verse by topic; include a descriptive topic string.
- Never invent Surah numbers; use integers from 1-114.
- Respond with JSON ONLY. No prose, no markdown.

Examples:
Input: "Mo, play Surah Yasin from verse 5"
Output: {"action":"play","surah":36,"topic":null,"mood":null,"verse_start":5,"verse_end":null,"confidence":0.91,"reason":"explicit request","follow_up_needed":false}

Input: "Give me something calming"
Output: {"action":"play","surah":55,"topic":null,"mood":"calm","verse_start":null,"verse_end":null,"confidence":0.63,"reason":"calming implies Surah Ar-Rahman","follow_up_needed":false}

Input: "Stop"
Output: {"action":"stop","surah":null,"topic":null,"mood":null,"verse_start":null,"verse_end":null,"confidence":0.99,"reason":"user asked to stop","follow_up_needed":false}
"""


class OllamaVoiceListener:
    def __init__(self, device="pulse", mirror_url="http://localhost:8080", ollama_url=OLLAMA_URL, enable_beeps=False, enable_voice=False):
        self.device = device
        self.mirror_url = mirror_url
        self.ollama_url = ollama_url
        self.current_process = None
        self.player = None
        self.is_running = True
        self.script_dir = Path(__file__).parent
        self.ollama_available = False
        self.enable_beeps = enable_beeps
        self.enable_voice = enable_voice
        self.tts_engine = None
        self.command_history = deque(maxlen=MAX_HISTORY)
        self.last_intent = create_intent()
        self.last_surah = None
        self.last_topic = None
        self.followup_deadline = 0
        self.embedder = None
        self.embedding_index = []
        self.embedding_vectors = None
        self.embeddings_loaded = False

        # Print audio device information
        print(f"🔊 Using audio device: {device}")
        print("Available PulseAudio sources:")
        try:
            sources = subprocess.check_output(["pactl", "list", "sources", "short"], text=True, errors='ignore')
            print(sources)
        except Exception as e:
            print(f"  Error listing sources: {e}")

        # Initialize Whisper (loads model into RAM once)
        print("⏳ Loading Whisper model (tiny.en)...")
        try:
            self.whisper = WhisperModel("tiny.en", device="opencl", compute_type="int8")
        except:
            self.whisper = WhisperModel("tiny.en", device="cpu", compute_type="int8")

    def within_followup_window(self):
        return time.time() < self.followup_deadline

    def extend_followup_window(self):
        self.followup_deadline = time.time() + FOLLOWUP_WINDOW_SECONDS

    def get_context_summary(self):
        if not self.command_history:
            return "No previous commands."
        lines = []
        for entry in list(self.command_history)[-MAX_HISTORY:]:
            intent = entry["intent"]
            action = intent.get("action")
            detail = intent.get("surah") or intent.get("topic") or ""
            lines.append(f'- "{entry["raw"]}" -> {action} {detail}'.strip())
        return "\n".join(lines[:MAX_HISTORY])

    def remember_intent(self, raw_text, intent):
        self.last_intent = intent
        if intent.get("surah"):
            self.last_surah = intent["surah"]
        if intent.get("topic"):
            self.last_topic = intent["topic"]
        self.command_history.append({
            "raw": raw_text,
            "intent": intent.copy()
        })
    def normalize_topic(self, topic):
        if not topic:
            return None
        topic = topic.lower().strip()
        return TOPIC_SYNONYMS.get(topic, topic)

    def apply_semantic_overrides(self, intent, slots, raw_text):
        if intent is None:
            intent = create_intent()
        text = (raw_text or "").lower()

        normalized_topic = self.normalize_topic(intent.get("topic"))
        if normalized_topic:
            intent["topic"] = normalized_topic

        if not intent.get("surah") and intent.get("mood"):
            mood = intent["mood"].lower()
            for key, surah in MOOD_TO_SURAH.items():
                if key in mood:
                    intent["surah"] = surah
                    break

        for key, surah in MOOD_TO_SURAH.items():
            if key in text and not intent.get("surah"):
                intent["surah"] = surah
                intent["mood"] = key
                break

        for phrase, ref in SPECIAL_VERSES.items():
            if phrase in text:
                intent["action"] = "play_verse"
                intent["surah"], verse = ref
                intent["verse_start"] = verse
                intent["verse_end"] = verse
                break

        if not intent.get("surah") and intent.get("topic"):
            verse_ref = TOPIC_TO_VERSE.get(intent["topic"])
            if verse_ref:
                intent["surah"], verse = verse_ref
                intent["action"] = "play_verse"
                intent["verse_start"] = verse

        if not intent.get("surah") and any(word in text for word in ["same", "again", "continue", "resume"]) and self.last_surah:
            intent["surah"] = self.last_surah

        if slots.get("ranges"):
            start, end = slots["ranges"][0]
            intent["verse_start"] = start
            if end:
                intent["verse_end"] = end
            if intent["surah"]:
                intent["action"] = "play_verse"
        elif slots.get("numbers") and intent["action"] == "play_verse" and not intent.get("verse_start"):
            intent["verse_start"] = slots["numbers"][0]

        return intent

    def resolve_action_value(self, intent):
        if not intent:
            return ("none", None)

        action = intent.get("action", "none")
        if action == "play":
            return ("play", intent.get("surah"))
        if action == "play_verse":
            surah = intent.get("surah") or self.last_surah
            if surah:
                verse_start = intent.get("verse_start") or 1
                return ("play_verse", (surah, verse_start))
        if action == "search":
            verse_ref = self.get_verse_from_topic(intent.get("topic"))
            if verse_ref:
                return ("play_verse", verse_ref)
        if action == "stop":
            return ("stop", None)
        return ("none", None)

    def load_embeddings(self):
        if self.embeddings_loaded:
            return True
        try:
            if EMBEDDING_VECTOR_PATH.exists() and EMBEDDING_META_PATH.exists():
                self.embedding_index = json.loads(EMBEDDING_META_PATH.read_text(encoding="utf-8"))
                self.embedding_vectors = np.load(EMBEDDING_VECTOR_PATH, allow_pickle=False)
                self.embeddings_loaded = True
                print(f"✓ Loaded {len(self.embedding_index)} embedding vectors.")
                return True
        except Exception as e:
            print(f"Embedding load error: {e}")
        return False

    def semantic_search(self, topic):
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError:
            return None

        if not self.load_embeddings():
            return None

        if self.embedder is None:
            try:
                self.embedder = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
            except Exception as e:
                print(f"Embedder init error: {e}")
                return None

        try:
            query_vec = self.embedder.encode([topic], normalize_embeddings=True)
            vectors = self.embedding_vectors
            if vectors.ndim == 1:
                return None

            similarities = np.dot(vectors, query_vec.T).flatten()
            best_idx = int(np.argmax(similarities))
            best_score = similarities[best_idx]
            if best_score < 0.45:
                return None

            meta = self.embedding_index[best_idx]
            return (meta.get("surah", 1), meta.get("verse", 1))
        except Exception as e:
            print(f"Semantic search error: {e}")
            return None

    def get_verse_from_topic(self, topic):
        normalized = self.normalize_topic(topic)
        if normalized and normalized in TOPIC_TO_VERSE:
            return TOPIC_TO_VERSE[normalized]
        if normalized and normalized in SPECIAL_VERSES:
            return SPECIAL_VERSES[normalized]

        semantic_result = self.semantic_search(normalized or topic)
        if semantic_result:
            return semantic_result

        if self.last_surah:
            return (self.last_surah, 1)
        return (1, 1)

    def acknowledge_intent(self, intent):
        if not intent:
            return
        action = intent.get("action")
        if action == "play":
            message = f"Playing Surah {intent.get('surah')}"
        elif action == "play_verse":
            surah = intent.get("surah")
            verse = intent.get("verse_start")
            message = f"Playing Surah {surah}, verse {verse}"
        elif action == "stop":
            message = "Stopping playback"
        else:
            message = "Didn't understand that command"

        print(f"🎧 {message}")
        if self.enable_voice:
            self.speak(message)

    def speak(self, text):
        if not self.enable_voice or not text:
            return
        try:
            if self.tts_engine is None:
                import pyttsx3
                self.tts_engine = pyttsx3.init()
                self.tts_engine.setProperty("rate", 175)
            self.tts_engine.say(text)
            self.tts_engine.runAndWait()
        except Exception as e:
            print(f"TTS error: {e}")
            self.enable_voice = False

    def process_command(self, command_text):
        slots = extract_slots(command_text)
        if self.ollama_available:
            result = self.parse_with_ollama(command_text, require_wake=False)
        else:
            result = self.parse_fallback(command_text, require_wake=False)

        if not result or len(result) != 3:
            action, value, intent = ("none", None, create_intent())
        else:
            action, value, intent = result

        intent = self.apply_semantic_overrides(intent, slots, command_text)
        resolved_action, resolved_value = self.resolve_action_value(intent)
        if resolved_action != "none":
            action, value = resolved_action, resolved_value

        confidence = intent.get("confidence", DEFAULT_CONFIDENCE)
        if action == "none" or (confidence < 0.4 and action != "stop"):
            self.play_error()
            print("  (Command not understood)")
            return

        self.acknowledge_intent(intent)
        self.remember_intent(command_text, intent)
        self.extend_followup_window()

        if action == "play" and value:
            self.play_confirmation()
            subprocess.Popen(
                ["python3", "quran_chainer.py", "--surah", str(value)],
                cwd=self.script_dir
            )
        elif action == "play_verse" and value:
            surah, verse = value
            self.play_confirmation()
            subprocess.Popen(
                ["python3", "quran_chainer.py", "--surah", str(surah), "--start-verse", str(verse)],
                cwd=self.script_dir
            )
        elif action == "stop":
            self.play_confirmation()
            self.stop_playback()
        else:
            self.play_error()
            print("  (Command not executed)")

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

        # Apply phrase replacements first (multi-word expressions)
        for src, dst in PHRASE_REPLACEMENTS.items():
            text = text.replace(src, dst)

        # Apply word-level replacements with word boundaries to avoid partial hits
        if WORD_REPLACEMENT_PATTERN:
            def replace_word(match):
                word = match.group(0)
                return WORD_REPLACEMENTS.get(word, word)

            text = WORD_REPLACEMENT_PATTERN.sub(replace_word, text)

        return text

    def record_audio(self, duration=5):  # Default duration changed to 5 seconds
        """Record audio using arecord"""
        timeout = duration + 7  # Additional buffer for device initialization
        print(f"  Recording audio for {duration} seconds using device '{self.device}'...")
        temp_file = None
        self.send_recording_status(True)

        try:
            # Verify device exists
            try:
                check_cmd = ["arecord", "-D", self.device, "-l"]
                result = subprocess.run(check_cmd, capture_output=True, text=True, timeout=2)
                if "no such card" in result.stderr.lower():
                    print(f"❌ Device {self.device} not found!")
                    return None
            except Exception as e:
                print(f"Device check error: {e}")
                return None

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                temp_file = f.name

            # Try recording with retries
            for attempt in range(3):
                try:
                    cmd = [
                        "arecord", "-D", self.device,
                        "-f", "S16_LE", "-c", "1", "-r", "16000",
                        "-d", str(duration), "-q", temp_file
                    ]
                    print(f"  Attempt {attempt+1}: Running command: {' '.join(cmd)}")
                    result = subprocess.run(cmd, capture_output=True, timeout=timeout)
                    if result.returncode != 0:
                        stderr_text = result.stderr.decode('utf-8', errors='replace')
                        print(f"⚠ Recording failed (code {result.returncode}). Check device: {self.device}")
                        print(f"  stderr: {stderr_text}")
                        return None
                    print("  Recording completed successfully")
                    return temp_file
                except subprocess.TimeoutExpired:
                    print(f"⚠ Timeout on attempt {attempt+1}, retrying...")
                except Exception as e:
                    print(f"Recording error: {e}")
                    break

            return None
        finally:
            if temp_file and not os.path.exists(temp_file):
                temp_file = None
            self.send_recording_status(False)

    def is_silent(self, audio_file, threshold=100):  # Reduced threshold
        """Check if the audio file is silent by checking maximum amplitude"""
        try:
            import wave
            import struct
            with wave.open(audio_file, 'rb') as wf:
                nframes = wf.getnframes()
                data = wf.readframes(nframes)
                # Convert to integers
                if wf.getsampwidth() == 2:
                    fmt = f"{nframes * wf.getnchannels()}h"
                    samples = struct.unpack(fmt, data)
                    max_amp = max(abs(s) for s in samples)
                    return max_amp < threshold
                else:
                    # Unsupported format
                    return False
        except:
            return False

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
            segments = list(segments)  # Convert to list to be able to print
            text = " ".join(segment.text for segment in segments)
            print(f"  Whisper segments: {segments}")
            return text.strip()
        except Exception as e:
            print(f"Whisper error: {e}")
            return ""
        finally:
            if os.path.exists(audio_file):
                os.unlink(audio_file)

    def parse_with_ollama(self, text, require_wake=True):
        """Use Ollama to parse command"""
        if not text or not self.ollama_available:
            return self.parse_fallback(text, require_wake=require_wake)

        try:
            context = self.get_context_summary()
            prompt = (
                "Conversation context:\n"
                f"{context}\n\n"
                f"User said: \"{text}\"\n\n"
                "Provide intent JSON:"
            )

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
                response_text = response.json().get("response", "").strip()
                if response_text:
                    print(f"  Ollama raw response: {response_text}")
                result = self._parse_intent_response(response_text)
                if result:
                    return result
        except requests.exceptions.Timeout:
            print("  Ollama timed out, falling back to local parser...")
        except Exception as e:
            print(f"  Ollama error: {e}")

        action, value, intent = self.parse_fallback(text, require_wake=require_wake)
        if action:
            print("  Using fallback parser result (Ollama returned none).")
        return action, value, intent

    def _parse_intent_response(self, response_text):
        if not response_text:
            return None
        try:
            if "{" in response_text and "}" in response_text:
                json_str = response_text[response_text.find("{"):response_text.rfind("}")+1]
                parsed = json.loads(json_str)
            else:
                return None
        except json.JSONDecodeError:
            return None

        intent = create_intent(
            action=parsed.get("action", "none"),
            surah=normalize_surah(parsed.get("surah")),
            topic=parsed.get("topic"),
            mood=parsed.get("mood"),
            verse_start=coerce_int(parsed.get("verse_start")),
            verse_end=coerce_int(parsed.get("verse_end")),
            confidence=parsed.get("confidence"),
            reason=parsed.get("reason"),
            follow_up=parsed.get("follow_up_needed", False)
        )

        if intent["action"] == "play":
            if intent["surah"]:
                return ("play", intent["surah"], intent)
            if intent["topic"]:
                verse_ref = self.get_verse_from_topic(intent["topic"])
                return ("play_verse", verse_ref, intent)
        elif intent["action"] == "play_verse":
            if intent["surah"]:
                verse_start = intent["verse_start"] or 1
                return ("play_verse", (intent["surah"], verse_start), intent)
        elif intent["action"] == "search" and intent["topic"]:
            verse_ref = self.get_verse_from_topic(intent["topic"])
            return ("play_verse", verse_ref, intent)
        elif intent["action"] == "stop":
            return ("stop", None, intent)

        return ("none", None, intent)

    def parse_fallback(self, text, require_wake=True):
        """Fallback parser when Ollama unavailable"""
        if not text:
            return (None, None, create_intent())

        words = tokenize_words(text)

        wake_present = any(word in WAKE_WORDS for word in words)

        if require_wake and not wake_present:
            return (None, None, create_intent())

        if wake_present and any(keyword in text for keyword in STOP_KEYWORDS):
            return ("stop", None, create_intent(action="stop", confidence=0.7))

        if any(keyword in text for keyword in STOP_KEYWORDS):
            return ("stop", None, create_intent(action="stop", confidence=0.6))

        if any(keyword in text for keyword in PLAY_KEYWORDS):
            for name, number in SURAH_NAMES.items():
                if name in text:
                    return ("play", number, create_intent(action="play", surah=number, confidence=0.55))

            for word in words:
                if word.isdigit():
                    num = int(word)
                    if 1 <= num <= 114:
                        return ("play", num, create_intent(action="play", surah=num, confidence=0.5))
                if word in NUMBER_WORDS:
                    mapped = NUMBER_WORDS[word]
                    return ("play", mapped, create_intent(action="play", surah=mapped, confidence=0.5))

            if any(k in text for k in ["quran", "koran", "quron"]):
                return ("play", 1, create_intent(action="play", surah=1, confidence=0.4))

            return ("play", 1, create_intent(action="play", surah=1, confidence=0.4))

        return (None, None, create_intent())

    def confirm_command(self, text):
        """Confirm command with user"""
        # Implement command confirmation logic here
        # For now, just return True
        return True

    def play_surah(self, surah_name_or_number):
        """Play a specific Surah by name or number"""
        # Convert to surah number
        if isinstance(surah_name_or_number, int):
            surah_number = surah_name_or_number
        else:
            # Normalize the input
            normalized = surah_name_or_number.lower().strip()
            surah_number = SURAH_NAMES.get(normalized)
            if surah_number is None:
                print(f"Unknown Surah: {surah_name_or_number}")
                return

        # Stop any currently playing audio
        self.stop_playback()

        print(f"▶ Playing Surah {surah_number}...")
        self.player = MPV(
            audio_device='pulse',
            input_default_bindings=True,
            input_vo_keyboard=True,
            osc=True
        )
        # ... rest of the method ...

    def pause_playback(self):
        """Pause the currently playing audio"""
        if self.player:
            self.player.pause = True
            print("⏸ Playback paused")

    def stop_playback(self):
        """Stop playback and release resources"""
        if self.player:
            self.player.terminate()
            self.player = None
            print("⏹ Playback stopped")
        self.send_playback_status(False)

    def send_listening_status(self, listening):
        """Send listening status to MagicMirror"""
        try:
            url = f"{self.mirror_url}/api/quran/listening"
            requests.post(url, json={"isListening": listening}, timeout=1)
        except Exception as e:
            print(f" Could not send listening status: {e}")

    def send_recording_status(self, recording):
        """Send recording status to MagicMirror"""
        try:
            url = f"{self.mirror_url}/api/quran/recording"
            requests.post(url, json={"isRecording": recording}, timeout=1)
        except Exception as e:
            print(f" Could not send recording status: {e}")

    def send_playback_status(self, playing):
        """Send playback status to MagicMirror"""
        try:
            url = f"{self.mirror_url}/api/quran/playing"
            requests.post(url, json={"isPlaying": playing}, timeout=3)
        except Exception as e:
            print(f" Could not send playback status: {e}")

    def beep(self, freq=440, duration=0.2):
        """Generate a beep sound"""
        if not self.enable_beeps:
            return
        try:
            import numpy as np
            fs = 44100
            t = np.linspace(0, duration, int(fs * duration), endpoint=False)
            beep_sound = np.sin(2 * np.pi * freq * t)
            sd.play(beep_sound, fs)
            sd.wait()
        except Exception as e:
            print(f"Beep error: {e}")

    def play_confirmation(self):
        """Play a confirmation sound"""
        self.beep(880, 0.3)  # Higher pitch for confirmation

    def play_error(self):
        """Play an error sound"""
        self.beep(220, 0.5)  # Lower pitch for error

    def check_memory(self):
        """Check memory usage and clear cache if high"""
        try:
            import psutil
            mem = psutil.virtual_memory()
            if mem.percent > 80:  # If memory usage is over 80%
                print("⚠ High memory usage! Clearing cache...")
                self.whisper = None
                import gc
                gc.collect()
                # Reinitialize Whisper
                try:
                    self.whisper = WhisperModel("tiny.en", device="opencl", compute_type="int8")
                except:
                    self.whisper = WhisperModel("tiny.en", device="cpu", compute_type="int8")
        except Exception as e:
            print(f"Memory check error: {e}")

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

        if not check_server_ready():
            print("❌ MagicMirror server not running! Please start server first")
            print("Run in separate terminal: cd ~/MagicMirror-Pi5/magicmirror && npm run server")
            sys.exit(1)

        self.check_ollama()
        print("\nListening... (say 'Mo' to start)")

        while self.is_running:
            try:
                self.send_listening_status(True)
                audio_file = self.record_audio(10)  # Extended recording time
                if not audio_file:
                    continue

                # Check if the audio is silent
                if self.is_silent(audio_file):
                    print("  Recording is silent, skipping...")
                    if os.path.exists(audio_file):
                        os.unlink(audio_file)
                    continue

                text = self.transcribe_whisper(audio_file)

                if text:
                    print(f"  Raw Input: '{text}'")
                    text_fixed = self.normalize_speech(text)
                    print(f"  Processing: '{text_fixed}'")
                    wake_detected = any(word in text_fixed for word in WAKE_WORDS)
                    followup_active = self.within_followup_window()
                    print(f"  Wake words detected: {wake_detected} (follow-up active: {followup_active})")

                    should_handle = False
                    immediate_text = None

                    if wake_detected:
                        should_handle = True
                        print("  Wake word detected! Pausing playback...")
                        self.pause_playback()
                    elif followup_active and any(keyword in text_fixed for keyword in COMMAND_KEYWORDS):
                        should_handle = True
                        immediate_text = text_fixed
                        print("  Follow-up window active; accepting command without wake word.")
                        self.pause_playback()

                    if should_handle:
                        command_text = immediate_text or ""

                        if not immediate_text:
                            if any(keyword in text_fixed for keyword in COMMAND_KEYWORDS):
                                print("  Using full command from initial detection")
                                command_text = text_fixed
                            else:
                                print("  Recording command...")
                                time.sleep(1)  # Small pause so we don't trim beginning
                                audio_file = self.record_audio(7)

                                if not audio_file:
                                    continue

                                if self.is_silent(audio_file):
                                    print("  Recording is silent, skipping...")
                                    if os.path.exists(audio_file):
                                        os.unlink(audio_file)
                                    continue

                                text = self.transcribe_whisper(audio_file)
                                if text:
                                    print(f"  Raw Input: '{text}'")
                                    command_text = self.normalize_speech(text)
                                    print(f"  Processing: '{command_text}'")

                        if not command_text:
                            continue

                        if self.confirm_command(command_text):
                            print("  Command confirmed.")
                            self.process_command(command_text)
                        else:
                            print("  Command rejected. Please try again.")
                            self.play_error()
                            continue

                    self.check_memory()  # Check memory usage after each command
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

    device = "pulse"  # Use PulseAudio instead of direct ALSA
    mirror_url = "http://localhost:8080"
    enable_beeps = False

    for i, arg in enumerate(sys.argv):
        if arg == "--device" and i + 1 < len(sys.argv):
            device = sys.argv[i + 1]
        if arg == "--mirror-url" and i + 1 < len(sys.argv):
            mirror_url = sys.argv[i + 1]
        if arg == "--enable-beeps":
            enable_beeps = True

    listener = OllamaVoiceListener(device=device, mirror_url=mirror_url, enable_beeps=enable_beeps)
    listener.listen_loop()


if __name__ == "__main__":
    main()
