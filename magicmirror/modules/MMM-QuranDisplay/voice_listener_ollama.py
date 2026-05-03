#!/usr/bin/env python3
"""
Ollama-Powered Voice Listener for Quran Chainer
Uses Ollama AI to understand natural language commands

Usage: python3 voice_listener_ollama.py

Requirements:
- Ollama installed and running: curl -fsSL https://ollama.com/install.sh | sh
- Model pulled: ollama pull llama3.2:1b (or similar small model)
"""

import argparse
import difflib
import math
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

try:
    from faster_whisper import WhisperModel
except ImportError:
    print("ERROR: Missing required Python package 'faster-whisper'.")
    print("Install with: pip install faster-whisper")
    sys.exit(1)

try:
    import psutil
except ImportError:
    psutil = None

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

SURAH_DISPLAY_NAMES = {
    1: "Al-Fatiha", 2: "Al-Baqarah", 3: "Ali Imran", 4: "An-Nisa", 5: "Al-Maidah",
    6: "Al-Anam", 7: "Al-Araf", 8: "Al-Anfal", 9: "At-Tawbah", 10: "Yunus",
    11: "Hud", 12: "Yusuf", 13: "Ar-Rad", 14: "Ibrahim", 15: "Al-Hijr",
    16: "An-Nahl", 17: "Al-Isra", 18: "Al-Kahf", 19: "Maryam", 20: "Ta-Ha",
    21: "Al-Anbiya", 22: "Al-Hajj", 23: "Al-Muminun", 24: "An-Nur", 25: "Al-Furqan",
    26: "Ash-Shuara", 27: "An-Naml", 28: "Al-Qasas", 29: "Al-Ankabut", 30: "Ar-Rum",
    31: "Luqman", 32: "As-Sajdah", 33: "Al-Ahzab", 34: "Saba", 35: "Fatir",
    36: "Ya-Sin", 37: "As-Saffat", 38: "Sad", 39: "Az-Zumar", 40: "Ghafir",
    41: "Fussilat", 42: "Ash-Shura", 43: "Az-Zukhruf", 44: "Ad-Dukhan", 45: "Al-Jathiyah",
    46: "Al-Ahqaf", 47: "Muhammad", 48: "Al-Fath", 49: "Al-Hujurat", 50: "Qaf",
    51: "Adh-Dhariyat", 52: "At-Tur", 53: "An-Najm", 54: "Al-Qamar", 55: "Ar-Rahman",
    56: "Al-Waqiah", 57: "Al-Hadid", 58: "Al-Mujadila", 59: "Al-Hashr", 60: "Al-Mumtahanah",
    61: "As-Saf", 62: "Al-Jumuah", 63: "Al-Munafiqun", 64: "At-Taghabun", 65: "At-Talaq",
    66: "At-Tahrim", 67: "Al-Mulk", 68: "Al-Qalam", 69: "Al-Haqqah", 70: "Al-Maarij",
    71: "Nuh", 72: "Al-Jinn", 73: "Al-Muzzammil", 74: "Al-Muddaththir", 75: "Al-Qiyamah",
    76: "Al-Insan", 77: "Al-Mursalat", 78: "An-Naba", 79: "An-Naziat", 80: "Abasa",
    81: "At-Takwir", 82: "Al-Infitar", 83: "Al-Mutaffifin", 84: "Al-Inshiqaq", 85: "Al-Buruj",
    86: "At-Tariq", 87: "Al-Ala", 88: "Al-Ghashiyah", 89: "Al-Fajr", 90: "Al-Balad",
    91: "Ash-Shams", 92: "Al-Layl", 93: "Ad-Duha", 94: "Ash-Sharh", 95: "At-Tin",
    96: "Al-Alaq", 97: "Al-Qadr", 98: "Al-Bayyinah", 99: "Az-Zalzalah", 100: "Al-Adiyat",
    101: "Al-Qariah", 102: "At-Takathur", 103: "Al-Asr", 104: "Al-Humazah", 105: "Al-Fil",
    106: "Quraysh", 107: "Al-Maun", 108: "Al-Kawthar", 109: "Al-Kafirun", 110: "An-Nasr",
    111: "Al-Masad", 112: "Al-Ikhlas", 113: "Al-Falaq", 114: "An-Nas",
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
    "mow": "mo",
    "moh": "mo",
    "oh play": "mo play",
    "oh recite": "mo recite",
    "oh stop": "mo stop",
    "oh pause": "mo pause",
    "oh resume": "mo resume",
    "oh surah": "mo surah",
    "play to": "play 2",
    "play too": "play 2",
    "play tu": "play 2",
    "surah to": "surah 2",
    "surah too": "surah 2",
    "surah tu": "surah 2",
    "recite to": "recite 2",
    "recite too": "recite 2",
    "read to": "read 2",
    "read too": "read 2",
    "take a break": "pause",
    "hold on": "pause",
    "go on": "resume",
    "carry on": "resume",
    "keep going": "resume",
    "turn it off": "stop",
    "stop it": "stop",
    "be quiet": "stop",
    "sir": "surah",
    "sarah": "surah",
    "circle": "surah",
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
    "mu": "mo",
    "moo": "mo",
    "muh": "mo",
    "ma": "mo",
    "me": "mo",
    "my": "mo",
    "no": "mo",
    "know": "mo",
    "go": "mo",
    "s2p": "stop",
    "paws": "pause",
    "pose": "pause",
    "poz": "pause",
    "pase": "pause",
    "stap": "stop",
    "stob": "stop",
    "stock": "stop",
    "dtop": "stop",
    "dop": "stop",
    "top": "stop",
    "resum": "resume",
    "rezum": "resume",
    "resoom": "resume",
    "risum": "resume",
    "cont": "resume",
    "pley": "play",
    "plei": "play",
    "plai": "play",
    "pray": "play",
    "prey": "play",
    "resight": "recite",
    "resait": "recite",
    "raseet": "recite",
    "sura": "surah",
    "soura": "surah",
    "sorah": "surah",
    "sowrah": "surah",
    "yasien": "yasin",
    "yessin": "yasin",
    "yesseen": "yasin",
    "yessine": "yasin",
}

PHRASE_REPLACEMENTS = {k: v for k, v in COMMON_REPLACEMENTS.items() if " " in k}
WORD_REPLACEMENTS = {k: v for k, v in COMMON_REPLACEMENTS.items() if " " not in k}
WORD_REPLACEMENT_PATTERN = re.compile(
    r"\b(" + "|".join(map(re.escape, WORD_REPLACEMENTS.keys())) + r")\b"
) if WORD_REPLACEMENTS else None

WAKE_WORDS = {"mo"}

STOP_KEYWORDS = {"stop", "quiet", "silence", "halt", "end", "cancel"}
PAUSE_KEYWORDS = {"pause", "hold", "wait", "break"}
RESUME_KEYWORDS = {"resume", "continue", "unpause"}
PLAY_KEYWORDS = {"play", "recite", "read", "start"}
SEARCH_KEYWORDS = {"search", "find", "look"}
COMMAND_KEYWORDS = STOP_KEYWORDS | PAUSE_KEYWORDS | RESUME_KEYWORDS | PLAY_KEYWORDS | SEARCH_KEYWORDS
CONTROL_KEYWORDS = STOP_KEYWORDS | PAUSE_KEYWORDS | RESUME_KEYWORDS
STOP_PHRASES = {"turn it off", "stop it", "be quiet"}
PAUSE_PHRASES = {"take a break", "hold on"}
RESUME_PHRASES = {"go on", "carry on", "keep going"}

EMBEDDING_DIR = Path(__file__).parent / "embeddings"
EMBEDDING_VECTOR_PATH = EMBEDDING_DIR / "verse_embeddings.npy"
EMBEDDING_META_PATH = EMBEDDING_DIR / "verse_metadata.json"

MOOD_TO_SURAH = {
    "calm": 55,
    "calming": 55,
    "soothing": 55,
    "peace": 36,
    "peaceful": 36,
    "focus": 36,
    "motivated": 94,
    "inspiration": 19,
    "hopeful": 19,
    "sleep": 67,
    "relax": 55,
    "relaxing": 55
}

TOPIC_SYNONYMS = {
    "mercy": "mercy",
    "compassion": "mercy",
    "kindness": "mercy",
    "forgiveness": "forgiveness",
    "forgive": "forgiveness",
    "repent": "forgiveness",
    "patience": "patience",
    "patient": "patience",
    "persevere": "patience",
    "gratitude": "gratitude",
    "thankful": "gratitude",
    "thanks": "gratitude",
    "hope": "hope",
    "hopeful": "hope",
    "optimism": "hope",
    "protection": "protection",
    "protect": "protection",
    "shield": "protection",
    "guidance": "guidance",
    "guide": "guidance",
    "light": "guidance",
    "calm": "calm",
    "peace": "peace",
    "peaceful": "peace",
    "trust": "trust",
    "fear": "fear",
    "anxiety": "fear"
}

TOPIC_TO_VERSE = {
    "mercy": (19, 21),
    "forgiveness": (39, 53),
    "patience": (2, 153),
    "gratitude": (14, 7),
    "hope": (65, 2),
    "hopeful": (65, 2),
    "protection": (18, 10),
    "guidance": (1, 6),
    "calm": (55, 1),
    "peace": (36, 58),
    "trust": (3, 173),
    "fear": (2, 286),
    "anxiety": (13, 28)
}

SPECIAL_VERSES = {
    "ayatul kursi": (2, 255),
    "last two of baqarah": (2, 285),
    "surah mulk": (67, 1)
}

MAX_HISTORY = 5
FOLLOWUP_WINDOW_SECONDS = max(0.0, float(os.getenv("VOICE_FOLLOWUP_WINDOW_SEC", "2")))
DEFAULT_CONFIDENCE = 0.65
DEFAULT_PARSER_MODE = "local"
DEFAULT_STT_MODEL = "base.en"
DEFAULT_STT_LANGUAGE = "en"
DEFAULT_WAKE_WINDOW_SEC = 1.5
DEFAULT_COMMAND_WINDOW_SEC = 2.5
DEFAULT_MEMORY_CHECK_INTERVAL_SEC = 60
FUZZY_SURAH_THRESHOLD = 0.82
DEFAULT_SILENCE_MAX_AMP = 60
DEFAULT_SILENCE_RMS_AMP = 12
DEFAULT_COMMAND_DEBOUNCE_SEC = 3.0

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

def contains_any_token(text, keywords):
    if not text:
        return False
    return bool(set(tokenize_words(text)).intersection(keywords))


def contains_phrase(text, phrases):
    if not text:
        return False
    lowered = text.lower()
    return any(_contains_phrase(lowered, phrase) for phrase in phrases)


def contains_fuzzy_token(text, keywords, cutoff=0.78):
    """Match near-miss tokens to keyword sets for accented / noisy STT output."""
    if not text:
        return False
    words = tokenize_words(text)
    if not words:
        return False
    keyword_list = sorted(set(keywords))
    for word in words:
        if word in keywords:
            return True
        if difflib.get_close_matches(word, keyword_list, n=1, cutoff=cutoff):
            return True
    return False


def parse_wake_words(raw_wake_words):
    if raw_wake_words is None:
        return set(WAKE_WORDS)

    if isinstance(raw_wake_words, (list, tuple, set)):
        values = raw_wake_words
    else:
        values = str(raw_wake_words).split(",")

    parsed = {str(word).strip().lower() for word in values if str(word).strip()}
    return parsed or set(WAKE_WORDS)


def has_wake_word(text, wake_words=None):
    return contains_any_token(text, wake_words or WAKE_WORDS)


def strip_wake_words(text, wake_words=None):
    if not text:
        return ""
    wake_set = wake_words or WAKE_WORDS
    filtered = [token for token in tokenize_words(text) if token not in wake_set]
    return " ".join(filtered).strip()

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

SURAH_ALIASES_SORTED = sorted(SURAH_NAMES.items(), key=lambda item: len(item[0]), reverse=True)
SURAH_ALIAS_LIST = [alias for alias, _ in SURAH_ALIASES_SORTED]

def _contains_phrase(text, phrase):
    pattern = r"(?<!\w)" + re.escape(phrase) + r"(?!\w)"
    return re.search(pattern, text) is not None

def _fuzzy_surah_lookup(tokens, threshold=FUZZY_SURAH_THRESHOLD):
    if not tokens:
        return None

    candidates = []
    max_ngram = min(3, len(tokens))
    for ngram_size in range(1, max_ngram + 1):
        for idx in range(len(tokens) - ngram_size + 1):
            phrase = " ".join(tokens[idx:idx + ngram_size]).strip()
            if phrase and phrase != "surah":
                candidates.append(phrase)

    for candidate in candidates:
        matches = difflib.get_close_matches(candidate, SURAH_ALIAS_LIST, n=1, cutoff=threshold)
        if matches:
            return SURAH_NAMES[matches[0]]
    return None

def extract_surah_number(text):
    """Extract a surah number from free-form text."""
    if not text:
        return None

    lowered = re.sub(r"\s+", " ", text.lower().strip())

    # 1) Exact alias phrase match (deterministic, highest confidence).
    for alias, number in SURAH_ALIASES_SORTED:
        if _contains_phrase(lowered, alias):
            return number

    # 2) Explicit numeric reference like "surah 55".
    numeric_surah_match = re.search(r"\bsurah\s+(\d{1,3})\b", lowered)
    if numeric_surah_match:
        number = int(numeric_surah_match.group(1))
        if 1 <= number <= 114:
            return number

    # 3) Number words / numeric tokens in utterance.
    tokens = tokenize_words(lowered)
    for token in tokens:
        if token.isdigit():
            num = int(token)
            if 1 <= num <= 114:
                return num
        if token in NUMBER_WORDS:
            return NUMBER_WORDS[token]

    # 4) Fuzzy match for misheard aliases (threshold fixed for determinism).
    return _fuzzy_surah_lookup(tokens)

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
  "action": "play" | "play_verse" | "pause" | "resume" | "stop" | "search" | "none",
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
- Use "pause" when the user asks to pause/hold.
- Use "resume" when the user asks to continue/unpause current recitation.
- Use "search" only when you need Mo to find a verse by topic; include a descriptive topic string.
- If the user asks for an emotion, quality, or theme (e.g., calming, mercy, forgiveness) without naming a surah, prefer {"action":"search","topic":"<theme>"}.
- Never invent Surah numbers; use integers from 1-114.
- Respond with JSON ONLY. No prose, no markdown.

Examples:
Input: "Mo, play Surah Yasin from verse 5"
Output: {"action":"play","surah":36,"topic":null,"mood":null,"verse_start":5,"verse_end":null,"confidence":0.91,"reason":"explicit request","follow_up_needed":false}

Input: "Give me something calming"
Output: {"action":"play","surah":55,"topic":null,"mood":"calm","verse_start":null,"verse_end":null,"confidence":0.63,"reason":"calming implies Surah Ar-Rahman","follow_up_needed":false}

Input: "Stop"
Output: {"action":"stop","surah":null,"topic":null,"mood":null,"verse_start":null,"verse_end":null,"confidence":0.99,"reason":"user asked to stop","follow_up_needed":false}

Input: "Pause for now"
Output: {"action":"pause","surah":null,"topic":null,"mood":null,"verse_start":null,"verse_end":null,"confidence":0.97,"reason":"user asked to pause","follow_up_needed":false}
"""


class OllamaVoiceListener:
    def __init__(
        self,
        device="pulse",
        mirror_url="http://localhost:8080",
        ollama_url=OLLAMA_URL,
        enable_beeps=False,
        enable_voice=True,
        parser_mode=DEFAULT_PARSER_MODE,
        stt_model=DEFAULT_STT_MODEL,
        stt_language=DEFAULT_STT_LANGUAGE,
        wake_window_sec=DEFAULT_WAKE_WINDOW_SEC,
        command_window_sec=DEFAULT_COMMAND_WINDOW_SEC,
        wake_words=None,
        silence_max_amp=DEFAULT_SILENCE_MAX_AMP,
        silence_rms_amp=DEFAULT_SILENCE_RMS_AMP
    ):
        self.device = device
        self.mirror_url = mirror_url
        self.ollama_url = ollama_url
        self.current_process = None
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
        self.parser_mode = parser_mode if parser_mode in {"local", "hybrid", "ollama"} else DEFAULT_PARSER_MODE
        self.stt_model = stt_model or DEFAULT_STT_MODEL
        self.stt_language = None if (not stt_language or stt_language == "auto") else stt_language
        self.stt_language_label = stt_language if stt_language else DEFAULT_STT_LANGUAGE
        self.wake_window_sec = max(1.0, float(wake_window_sec))
        self.command_window_sec = max(1.0, float(command_window_sec))
        self.wake_words = parse_wake_words(wake_words)
        self.primary_wake_word = sorted(self.wake_words)[0] if self.wake_words else "mo"
        self.wake_words_display = ", ".join(sorted(self.wake_words))
        self.silence_max_amp = max(0, int(silence_max_amp))
        self.silence_rms_amp = max(0, int(silence_rms_amp))
        self.command_debounce_sec = max(0.0, float(os.getenv("VOICE_COMMAND_DEBOUNCE_SEC", str(DEFAULT_COMMAND_DEBOUNCE_SEC))))
        self.timing_history = deque(maxlen=100)
        self._last_listening_status = None
        self._last_recording_status = None
        self._last_processing_status = None
        self._last_transcript_payload = None
        self._last_memory_check = 0.0
        self._last_command_signature = None
        self._last_command_ts = 0.0
        wake_words_prompt = " ".join(sorted(self.wake_words))
        self.stt_prompt = (
            "Voice command for Quran recitation. "
            f"Wake words: {wake_words_prompt}. "
            "Actions: play recite pause resume continue stop. "
            "Common surahs: fatiha baqarah imran nisa maidah anam araf anfal tawbah yunus hud yusuf ibrahim hijr nahl isra kahf maryam taha anbiya hajj muminun nur furqan shuara naml qasas ankabut rum luqman sajdah ahzab saba fatir yasin saffat sad zumar ghafir fussilat shura zukhruf dukhan jathiyah ahqaf muhammad fath hujurat qaf dhariyat tur najm qamar rahman waqiah hadid mujadila hashr mumtahanah saf jumuah munafiqun taghabun talaq tahrim mulk qalam haqqah maarij nuh jinn muzzammil muddaththir qiyamah insan mursalat naba naziat abasa takwir infitar mutaffifin inshiqaq buruj tariq ala ghashiyah fajr balad shams layl duha sharh tin alaq qadr bayyinah zalzalah adiyat qariah takathur asr humazah fil quraysh maun kawthar kafirun nasr masad ikhlas falaq nas. "
            "Quran vocabulary: surah ayah verse recite bismillah ayatul kursi mercy patience guidance protection."
        )

        # Print audio device information
        print(f"🔊 Using audio device: {device}")
        print("Available PulseAudio sources:")
        try:
            sources = subprocess.check_output(["pactl", "list", "sources", "short"], text=True, errors='ignore')
            print(sources)
        except Exception as e:
            print(f"  Error listing sources: {e}")

        # Initialize Whisper (loads model into RAM once)
        print(f"⏳ Loading Whisper model ({self.stt_model})...")
        try:
            self.whisper = WhisperModel(self.stt_model, device="opencl", compute_type="int8")
        except Exception:
            self.whisper = WhisperModel(self.stt_model, device="cpu", compute_type="int8")

    def within_followup_window(self):
        return time.time() < self.followup_deadline

    def extend_followup_window(self):
        self.followup_deadline = time.time() + FOLLOWUP_WINDOW_SECONDS

    def detect_wake_word(self, text):
        return has_wake_word(text, self.wake_words)

    def remove_wake_words(self, text):
        return strip_wake_words(text, self.wake_words)

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

    def detect_topic_from_text(self, text):
        if not text:
            return None
        lowered = text.lower()
        # Check multi-word phrases first
        phrases = sorted([k for k in TOPIC_SYNONYMS.keys() if " " in k], key=len, reverse=True)
        for phrase in phrases:
            if phrase in lowered:
                return self.normalize_topic(phrase)
        # Check single tokens
        for token in tokenize_words(lowered):
            if token in TOPIC_SYNONYMS:
                return self.normalize_topic(token)
        return None

    def apply_semantic_overrides(self, intent, slots, raw_text):
        if intent is None:
            intent = create_intent()
        text = (raw_text or "").lower()

        normalized_topic = self.normalize_topic(intent.get("topic"))
        if normalized_topic:
            intent["topic"] = normalized_topic
        elif not intent.get("topic"):
            detected_topic = self.detect_topic_from_text(text)
            if detected_topic:
                intent["topic"] = detected_topic
                if intent.get("action") == "none":
                    intent["action"] = "search"

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

        if not intent.get("surah") and contains_any_token(text, {"same", "again", "continue", "resume"}) and self.last_surah:
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
        if action == "pause":
            return ("pause", None)
        if action == "resume":
            return ("resume", None)
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
        surah_num = intent.get("surah")
        surah_name = SURAH_DISPLAY_NAMES.get(surah_num, f"Surah {surah_num}") if surah_num else None
        if action == "play":
            message = f"Playing {surah_name}, right away."
        elif action == "play_verse":
            verse = intent.get("verse_start")
            message = f"Playing {surah_name} from verse {verse}."
        elif action == "pause":
            message = "Pausing recitation."
        elif action == "resume":
            message = "Resuming recitation."
        elif action == "stop":
            message = "Stopping playback."
        else:
            message = "Command not recognized."

        print(f"🎧 {message}")
        if self.enable_voice:
            self.speak(message)

    def speak(self, text):
        if not self.enable_voice or not text:
            return
        try:
            # espeak-ng: fast, no init overhead, available on all Pi/Raspbian installs
            # -s 145 = speech rate, -p 40 = pitch (slightly lower = less robotic),
            # -a 80 = amplitude, -g 8 = word gap (slight pause between words)
            subprocess.run(
                ["espeak-ng", "-s", "145", "-p", "40", "-a", "80", "-g", "8", text],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10
            )
        except FileNotFoundError:
            # Fallback to pyttsx3 if espeak-ng not installed
            try:
                if self.tts_engine is None:
                    import pyttsx3
                    self.tts_engine = pyttsx3.init()
                    self.tts_engine.setProperty("rate", 150)
                self.tts_engine.say(text)
                self.tts_engine.runAndWait()
            except Exception as e:
                print(f"TTS error: {e}")
                self.enable_voice = False
        except Exception as e:
            print(f"TTS error: {e}")

    def _parse_command(self, command_text):
        local_result = self.parse_fallback(command_text, require_wake=False)
        local_action = local_result[0] if local_result and len(local_result) == 3 else None

        if self.parser_mode == "local":
            return local_result

        if self.parser_mode == "hybrid":
            if local_action and local_action != "none":
                return local_result
            if self.ollama_available:
                return self.parse_with_ollama(command_text, require_wake=False)
            return local_result

        # parser_mode == "ollama"
        if self.ollama_available:
            return self.parse_with_ollama(command_text, require_wake=False)
        return local_result

    def start_chainer(self, surah, verse_start=None):
        # Defensive guard: enforce one active chainer even if a stale process remains.
        if self.current_process and self.current_process.poll() is None:
            self.stop_playback()
        self._terminate_stale_chainers()

        command = [sys.executable, "quran_chainer.py", "--surah", str(surah)]
        if verse_start is not None:
            command.extend(["--start-verse", str(verse_start)])
        print(f"  Launching chainer: {' '.join(command)}")
        self.current_process = subprocess.Popen(
            command,
            cwd=self.script_dir,
            stdin=subprocess.PIPE,
            text=True
        )

    def send_chainer_command(self, command):
        if not self.current_process or self.current_process.poll() is not None:
            return False
        try:
            if self.current_process.stdin:
                self.current_process.stdin.write(f"{command}\n")
                self.current_process.stdin.flush()
                return True
        except Exception as e:
            print(f"  Could not send {command} command: {e}")
        return False

    def _terminate_stale_chainers(self):
        """Terminate leftover quran_chainer processes not tracked by this listener."""
        try:
            result = subprocess.run(
                ["pgrep", "-af", "quran_chainer.py"],
                capture_output=True,
                text=True,
                timeout=2
            )
            if result.returncode not in {0, 1}:
                return

            tracked_pid = self.current_process.pid if self.current_process else None
            lines = [line.strip() for line in (result.stdout or "").splitlines() if line.strip()]
            for line in lines:
                parts = line.split(maxsplit=1)
                if not parts:
                    continue
                try:
                    pid = int(parts[0])
                except ValueError:
                    continue
                if tracked_pid and pid == tracked_pid:
                    continue
                cmd = parts[1] if len(parts) > 1 else ""
                print(f"  Terminating stale chainer PID {pid}: {cmd}")
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    continue
        except Exception as e:
            print(f"  Warning: could not scan stale chainer processes: {e}")

    def _command_signature(self, action, value):
        if action == "play_verse" and isinstance(value, (tuple, list)) and len(value) >= 2:
            return ("play_verse", int(value[0]), int(value[1]))
        if action == "play" and value is not None:
            return ("play", int(value))
        return (str(action), str(value))

    def _is_duplicate_command(self, signature):
        if signature != self._last_command_signature:
            return False
        return (time.time() - self._last_command_ts) < self.command_debounce_sec

    def _remember_command(self, signature):
        self._last_command_signature = signature
        self._last_command_ts = time.time()

    def _pids_from_pgrep(self, pattern):
        pids = []
        try:
            result = subprocess.run(
                ["pgrep", "-af", pattern],
                capture_output=True,
                text=True,
                timeout=2
            )
            if result.returncode not in {0, 1}:
                return pids

            for raw_line in (result.stdout or "").splitlines():
                line = raw_line.strip()
                if not line:
                    continue
                parts = line.split(maxsplit=1)
                if not parts:
                    continue
                try:
                    pid = int(parts[0])
                except ValueError:
                    continue
                if pid != os.getpid():
                    pids.append(pid)
        except Exception:
            return pids
        return pids

    def _signal_external_playback(self, sig):
        """Fallback control path for stale/untracked chainer/mpv processes."""
        targets = set()
        targets.update(self._pids_from_pgrep("quran_chainer.py"))
        targets.update(self._pids_from_pgrep("mpv --no-video --really-quiet"))

        tracked_pid = self.current_process.pid if self.current_process else None
        sent = 0
        for pid in sorted(targets):
            if tracked_pid and pid == tracked_pid:
                continue
            try:
                os.kill(pid, sig)
                sent += 1
            except ProcessLookupError:
                continue
            except Exception:
                continue
        return sent

    def has_control_intent_hint(self, text):
        return (
            contains_any_token(text, CONTROL_KEYWORDS)
            or contains_phrase(text, STOP_PHRASES | PAUSE_PHRASES | RESUME_PHRASES)
            or contains_fuzzy_token(text, CONTROL_KEYWORDS, cutoff=0.74)
        )

    def has_command_hint(self, text):
        return (
            contains_any_token(text, COMMAND_KEYWORDS)
            or contains_phrase(text, STOP_PHRASES | PAUSE_PHRASES | RESUME_PHRASES)
            or contains_fuzzy_token(text, COMMAND_KEYWORDS, cutoff=0.74)
            or bool(extract_surah_number(text))
        )

    def pause_chainer(self):
        if self.send_chainer_command("PAUSE"):
            print("⏸ Pause command sent to quran_chainer.")
            return True
        signaled = self._signal_external_playback(signal.SIGSTOP)
        if signaled > 0:
            print(f"⏸ Pause signal sent to {signaled} external playback process(es).")
            return True
        print("  No active recitation process to pause.")
        return False

    def resume_chainer(self):
        if self.send_chainer_command("RESUME"):
            print("▶ Resume command sent to quran_chainer.")
            return True
        signaled = self._signal_external_playback(signal.SIGCONT)
        if signaled > 0:
            print(f"▶ Resume signal sent to {signaled} external playback process(es).")
            return True
        print("  No active recitation process to resume.")
        return False

    def process_command(self, command_text, raw_text=None):
        self.send_transcript_status(command_text, phase="processing", raw_text=raw_text or command_text)
        self.send_processing_status(True)
        self.send_listening_status(False)
        try:
            parse_started_at = time.perf_counter()
            slots = extract_slots(command_text)
            result = self._parse_command(command_text)
            parse_ms = (time.perf_counter() - parse_started_at) * 1000

            if not result or len(result) != 3:
                action, value, intent = ("none", None, create_intent())
            else:
                action, value, intent = result

            intent = self.apply_semantic_overrides(intent, slots, command_text)
            resolved_action, resolved_value = self.resolve_action_value(intent)
            if resolved_action != "none":
                action, value = resolved_action, resolved_value

            confidence = intent.get("confidence", DEFAULT_CONFIDENCE)
            print(f"  Parser mode={self.parser_mode}, action={action}, confidence={confidence:.2f}, parse_ms={parse_ms:.1f}")
            if action == "none" or (confidence < 0.4 and action not in {"stop", "pause", "resume"}):
                self.send_transcript_status(command_text, phase="unrecognized", raw_text=raw_text or command_text)
                self.play_error()
                print("  (Command not understood)")
                return

            signature = self._command_signature(action, value)
            if self._is_duplicate_command(signature):
                self.send_transcript_status(command_text, phase="duplicate", raw_text=raw_text or command_text)
                print(f"  Duplicate command ignored within {self.command_debounce_sec:.1f}s: {signature}")
                return

            self.acknowledge_intent(intent)
            self.remember_intent(command_text, intent)
            self.extend_followup_window()

            if action == "play" and value:
                self._remember_command(signature)
                self.play_confirmation()
                self.stop_playback()
                self.start_chainer(value)
            elif action == "play_verse" and value:
                surah, verse = value
                self._remember_command(signature)
                self.play_confirmation()
                self.stop_playback()
                self.start_chainer(surah, verse_start=verse)
            elif action == "pause":
                self._remember_command(signature)
                if self.pause_chainer():
                    self.play_confirmation()
                else:
                    self.play_error()
            elif action == "resume":
                self._remember_command(signature)
                if self.resume_chainer():
                    self.play_confirmation()
                else:
                    self.play_error()
            elif action == "stop":
                self._remember_command(signature)
                self.play_confirmation()
                self.stop_playback()
            else:
                self.send_transcript_status(command_text, phase="unrecognized", raw_text=raw_text or command_text)
                self.play_error()
                print("  (Command not executed)")
        finally:
            self.send_processing_status(False)
            self.send_listening_status(True)

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

        # Handle "oh, play ..." style wake-word miss heard as "oh".
        text = re.sub(r"\boh[\s,]+(?=(play|recite|stop|pause|resume|surah)\b)", "mo ", text)

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

    def record_audio(self, duration=5, show_recording=False):
        """Record audio using arecord"""
        capture_seconds = max(1, int(math.ceil(duration)))
        timeout = capture_seconds + 7  # Additional buffer for device initialization
        print(
            f"  Recording audio for {duration:.1f}s using device '{self.device}' "
            f"(arecord capture: {capture_seconds}s)..."
        )
        temp_file = None
        if show_recording:
            self.send_listening_status(False)
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
                        "-d", str(capture_seconds), "-q", temp_file
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
            if show_recording:
                self.send_recording_status(False)
                self.send_listening_status(True)

    def is_silent(self, audio_file):
        """Check if the audio file is silent using both max and RMS amplitude."""
        try:
            import wave
            with wave.open(audio_file, 'rb') as wf:
                nframes = wf.getnframes()
                data = wf.readframes(nframes)
                if wf.getsampwidth() != 2:
                    return False

                samples = np.frombuffer(data, dtype=np.int16)
                if samples.size == 0:
                    return True

                abs_samples = np.abs(samples.astype(np.int32))
                max_amp = int(abs_samples.max())
                rms_amp = float(np.sqrt(np.mean(samples.astype(np.float32) ** 2)))

                if self.silence_max_amp == 0 and self.silence_rms_amp == 0:
                    print("  Silence gate disabled (both thresholds set to 0)")
                    return False

                silent = max_amp < self.silence_max_amp and rms_amp < self.silence_rms_amp
                state = "silent" if silent else "voice"
                print(
                    f"  Audio levels: max={max_amp}, rms={rms_amp:.1f} "
                    f"(gate max<{self.silence_max_amp}, rms<{self.silence_rms_amp}) -> {state}"
                )
                return silent
        except Exception as e:
            print(f"  Silence check error: {e}")
            return False

    def transcribe_whisper(self, audio_file):
        """Transcribe audio using Faster-Whisper"""
        try:
            language = self.stt_language if self.stt_language else None
            segments, info = self.whisper.transcribe(
                audio_file,
                beam_size=5,
                language=language,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 250},
                initial_prompt=self.stt_prompt,
                condition_on_previous_text=False
            )
            segments = list(segments)
            text = " ".join(segment.text for segment in segments)
            language_detected = getattr(info, "language", "unknown")
            language_prob = getattr(info, "language_probability", 0.0)
            print(f"  Whisper language={language_detected} prob={language_prob:.2f}")
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
            domain_hint = (
                "Command vocabulary includes: mo, play, recite, pause, resume, stop, surah, verse. "
                "Common surah names: fatiha, baqarah, yasin, rahman, kahf, mulk, ikhlas, nas."
            )
            prompt = (
                "Conversation context:\n"
                f"{context}\n\n"
                f"Domain hint: {domain_hint}\n\n"
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
                timeout=8
            )

            if response.status_code == 200:
                response_text = response.json().get("response", "").strip()
                if response_text:
                    print(f"  Ollama raw response: {response_text}")
                result = self._parse_intent_response(response_text)
                if result:
                    action, value, intent = result
                    confidence = intent.get("confidence", DEFAULT_CONFIDENCE)
                    if action in {"stop", "pause", "resume"} or confidence >= 0.35:
                        return result
                    print(f"  Ollama low confidence ({confidence:.2f}); using fallback parser.")
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
        elif intent["action"] == "pause":
            return ("pause", None, intent)
        elif intent["action"] == "resume":
            return ("resume", None, intent)
        elif intent["action"] == "stop":
            return ("stop", None, intent)

        return ("none", None, intent)

    def parse_fallback(self, text, require_wake=True):
        """Fallback parser when Ollama unavailable"""
        if not text:
            return (None, None, create_intent())

        wake_present = self.detect_wake_word(text)
        command_text = self.remove_wake_words(text)
        words = tokenize_words(command_text)

        if require_wake and not wake_present:
            return (None, None, create_intent())

        if (
            contains_any_token(command_text, STOP_KEYWORDS)
            or contains_phrase(command_text, STOP_PHRASES)
            or contains_fuzzy_token(command_text, STOP_KEYWORDS, cutoff=0.74)
        ):
            confidence = 0.7 if wake_present else 0.6
            return ("stop", None, create_intent(action="stop", confidence=confidence))

        if (
            contains_any_token(command_text, PAUSE_KEYWORDS)
            or contains_phrase(command_text, PAUSE_PHRASES)
            or contains_fuzzy_token(command_text, PAUSE_KEYWORDS, cutoff=0.74)
        ):
            confidence = 0.75 if wake_present else 0.65
            return ("pause", None, create_intent(action="pause", confidence=confidence))

        if (
            contains_any_token(command_text, RESUME_KEYWORDS)
            or contains_phrase(command_text, RESUME_PHRASES)
            or contains_fuzzy_token(command_text, RESUME_KEYWORDS, cutoff=0.74)
        ):
            confidence = 0.75 if wake_present else 0.65
            return ("resume", None, create_intent(action="resume", confidence=confidence))

        surah_number = extract_surah_number(command_text)

        if surah_number and (wake_present or not require_wake):
            return ("play", surah_number, create_intent(action="play", surah=surah_number, confidence=0.72))

        if contains_any_token(command_text, PLAY_KEYWORDS) or contains_fuzzy_token(command_text, PLAY_KEYWORDS, cutoff=0.72):
            if surah_number:
                return ("play", surah_number, create_intent(action="play", surah=surah_number, confidence=0.7))

            if any(token in {"quran", "koran", "quron"} for token in words):
                return ("play", 1, create_intent(action="play", surah=1, confidence=0.5))

            return ("play", 1, create_intent(action="play", surah=1, confidence=0.45))

        if contains_any_token(command_text, SEARCH_KEYWORDS) or contains_fuzzy_token(command_text, SEARCH_KEYWORDS, cutoff=0.74):
            topic = self.detect_topic_from_text(command_text)
            if topic:
                return ("search", topic, create_intent(action="search", topic=topic, confidence=0.6))

        return (None, None, create_intent())

    def confirm_command(self, text):
        """Confirm command with user"""
        # Implement command confirmation logic here
        # For now, just return True
        return True

    def stop_playback(self):
        """Stop playback and release resources"""
        if self.current_process:
            try:
                if self.current_process.poll() is None:
                    print("⏹ Stopping Quran chainer process...")
                    self.send_chainer_command("STOP")
                    if self.current_process.stdin:
                        self.current_process.stdin.close()
                    self.current_process.terminate()
                    try:
                        self.current_process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        print("  ⚠  Process still running, killing...")
                        self.current_process.kill()
            except Exception as e:
                print(f"  ⚠  Error stopping chainer: {e}")
            finally:
                self.current_process = None
        killed_external = self._signal_external_playback(signal.SIGTERM)
        if killed_external > 0:
            print(f"⏹ Terminated {killed_external} external playback process(es).")
        try:
            requests.post(f"{self.mirror_url}/api/quran/clear", timeout=1)
        except Exception:
            pass
        self.send_playback_status(False)

    def send_listening_status(self, listening):
        """Send listening status to MagicMirror"""
        listening = bool(listening)
        if self._last_listening_status == listening:
            return
        self._last_listening_status = listening
        try:
            url = f"{self.mirror_url}/api/quran/listening"
            requests.post(url, json={"isListening": listening}, timeout=1)
        except Exception as e:
            print(f" Could not send listening status: {e}")

    def send_recording_status(self, recording):
        """Send recording status to MagicMirror"""
        recording = bool(recording)
        if self._last_recording_status == recording:
            return
        self._last_recording_status = recording
        try:
            url = f"{self.mirror_url}/api/quran/recording"
            requests.post(url, json={"isRecording": recording}, timeout=1)
        except Exception as e:
            print(f" Could not send recording status: {e}")

    def send_processing_status(self, processing):
        """Send command-processing status to MagicMirror"""
        processing = bool(processing)
        if self._last_processing_status == processing:
            return
        self._last_processing_status = processing
        try:
            url = f"{self.mirror_url}/api/quran/processing"
            requests.post(url, json={"isProcessing": processing}, timeout=1)
        except Exception as e:
            print(f" Could not send processing status: {e}")

    def send_transcript_status(self, text="", phase="idle", raw_text=""):
        """Send latest recognized phrase to MagicMirror"""
        payload = {
            "text": (text or "").strip(),
            "phase": str(phase or "idle"),
            "rawText": (raw_text or "").strip()
        }
        if self._last_transcript_payload == payload:
            return
        self._last_transcript_payload = payload
        try:
            url = f"{self.mirror_url}/api/quran/transcript"
            requests.post(url, json=payload, timeout=1)
        except Exception as e:
            print(f" Could not send transcript status: {e}")

    def send_playback_status(self, playing):
        """Send playback status to MagicMirror"""
        try:
            url = f"{self.mirror_url}/api/quran/status"
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
        now = time.time()
        if (now - self._last_memory_check) < DEFAULT_MEMORY_CHECK_INTERVAL_SEC:
            return
        self._last_memory_check = now

        if psutil is None:
            return

        try:
            mem = psutil.virtual_memory()
            if mem.percent > 80:  # If memory usage is over 80%
                print("High memory usage! Clearing cache...")
                self.whisper = None
                import gc
                gc.collect()
                # Reinitialize Whisper
                try:
                    self.whisper = WhisperModel(self.stt_model, device="opencl", compute_type="int8")
                except Exception:
                    self.whisper = WhisperModel(self.stt_model, device="cpu", compute_type="int8")
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
        print(f"Parser mode: {self.parser_mode}")
        print(f"STT model: {self.stt_model}")
        print(f"STT language: {self.stt_language_label}")
        print(f"Wake window: {self.wake_window_sec:.1f}s")
        print(f"Command window: {self.command_window_sec:.1f}s")
        print(f"Silence gate: max<{self.silence_max_amp}, rms<{self.silence_rms_amp}")
        print(f"Wake words: {self.wake_words_display}")
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

        if self.parser_mode == "local":
            self.ollama_available = False
            print("Local parser mode active; skipping Ollama check.")
        else:
            self.check_ollama()
            if self.parser_mode == "ollama" and not self.ollama_available:
                print("⚠ Parser mode is 'ollama' but Ollama is unavailable; listener will fall back to local parser.")
        print(f"\nListening... (say '{self.primary_wake_word}' to start)")

        self.send_processing_status(False)
        self.send_recording_status(False)
        self.send_listening_status(True)
        self.send_transcript_status("", phase="idle")

        while self.is_running:
            try:
                wake_record_started_at = time.perf_counter()
                audio_file = self.record_audio(self.wake_window_sec, show_recording=False)
                wake_record_ms = (time.perf_counter() - wake_record_started_at) * 1000
                if not audio_file:
                    continue

                # Check if the audio is silent
                if self.is_silent(audio_file):
                    print("  Recording is silent, skipping...")
                    if os.path.exists(audio_file):
                        os.unlink(audio_file)
                    continue

                wake_stt_started_at = time.perf_counter()
                text = self.transcribe_whisper(audio_file)
                wake_stt_ms = (time.perf_counter() - wake_stt_started_at) * 1000

                if text:
                    print(f"  Raw Input: '{text}'")
                    text_fixed = self.normalize_speech(text)
                    print(f"  Processing: '{text_fixed}'")
                    wake_detected = self.detect_wake_word(text_fixed)
                    command_candidate = self.remove_wake_words(text_fixed) if wake_detected else text_fixed
                    followup_active = self.within_followup_window()
                    command_hint_present = self.has_command_hint(command_candidate)
                    print(f"  Wake words detected: {wake_detected} (follow-up active: {followup_active})")

                    should_handle = False
                    immediate_text = None

                    if wake_detected:
                        should_handle = True
                        self.send_transcript_status(text_fixed, phase="wake", raw_text=text)
                        if command_hint_present and command_candidate:
                            immediate_text = command_candidate
                            print("  Wake word and command detected in same utterance.")
                        else:
                            print("  Wake word detected. Waiting for command phrase...")
                    elif followup_active and command_hint_present:
                        should_handle = True
                        immediate_text = command_candidate
                        print("  Follow-up window active; accepting command without wake word.")
                    elif self.current_process and self.current_process.poll() is None and self.has_control_intent_hint(command_candidate):
                        should_handle = True
                        immediate_text = command_candidate
                        print("  Active playback; accepting control command without wake word.")

                    if should_handle:
                        command_text = immediate_text or ""
                        command_raw_text = command_text
                        command_record_ms = 0.0
                        command_stt_ms = 0.0

                        if not immediate_text:
                            if command_hint_present:
                                print("  Using full command from initial detection")
                                command_text = command_candidate
                                command_raw_text = command_candidate
                            else:
                                print("  Recording command...")
                                command_record_started_at = time.perf_counter()
                                audio_file = self.record_audio(self.command_window_sec, show_recording=True)
                                command_record_ms = (time.perf_counter() - command_record_started_at) * 1000

                                if not audio_file:
                                    continue

                                if self.is_silent(audio_file):
                                    print("  Recording is silent, skipping...")
                                    if os.path.exists(audio_file):
                                        os.unlink(audio_file)
                                    continue

                                command_stt_started_at = time.perf_counter()
                                text = self.transcribe_whisper(audio_file)
                                command_stt_ms = (time.perf_counter() - command_stt_started_at) * 1000
                                if text:
                                    print(f"  Raw Input: '{text}'")
                                    command_raw_text = text
                                    command_text = self.normalize_speech(text)
                                    command_text = self.remove_wake_words(command_text)
                                    print(f"  Processing: '{command_text}'")

                        if not command_text:
                            continue

                        self.send_transcript_status(command_text, phase="captured", raw_text=command_raw_text)

                        print(
                            "  Timing ms: "
                            f"wake_record={wake_record_ms:.1f}, wake_stt={wake_stt_ms:.1f}, "
                            f"command_record={command_record_ms:.1f}, command_stt={command_stt_ms:.1f}"
                        )

                        if self.confirm_command(command_text):
                            print("  Command captured. Parsing intent...")
                            command_processing_started_at = time.perf_counter()
                            self.process_command(command_text, raw_text=command_raw_text)
                            command_processing_ms = (time.perf_counter() - command_processing_started_at) * 1000
                            self.timing_history.append({
                                "wake_record_ms": wake_record_ms,
                                "wake_stt_ms": wake_stt_ms,
                                "command_record_ms": command_record_ms,
                                "command_stt_ms": command_stt_ms,
                                "command_processing_ms": command_processing_ms
                            })
                            print(f"  Timing ms: process_command={command_processing_ms:.1f}")
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

        print("\n👋 Voice listener stopped")
        self.send_processing_status(False)
        self.send_recording_status(False)
        self.send_listening_status(False)
        self.send_transcript_status("", phase="idle")
        self.stop_playback()


def signal_handler(sig, frame):
    print("\n\nShutting down...")
    sys.exit(0)


def main():
    signal.signal(signal.SIGINT, signal_handler)

    parser = argparse.ArgumentParser(description="Mo Quran voice listener")
    parser.add_argument("--device", default="pulse", help="ALSA/Pulse input device")
    parser.add_argument("--mirror-url", default="http://localhost:8080", help="MagicMirror base URL")
    parser.add_argument("--enable-beeps", action="store_true", help="Enable confirmation beeps")
    parser.add_argument("--enable-voice", action="store_true", default=True, help="Enable TTS acknowledgements (on by default)")
    parser.add_argument("--no-voice", action="store_false", dest="enable_voice", help="Disable TTS acknowledgements")
    parser.add_argument(
        "--parser-mode",
        choices=["local", "hybrid", "ollama"],
        default=DEFAULT_PARSER_MODE,
        help="Command parser mode"
    )
    parser.add_argument(
        "--stt-model",
        default=DEFAULT_STT_MODEL,
        help="Faster-Whisper model name (e.g. tiny, base)"
    )
    parser.add_argument(
        "--stt-language",
        default=DEFAULT_STT_LANGUAGE,
        help="STT language code or 'auto'"
    )
    parser.add_argument(
        "--wake-window-sec",
        type=float,
        default=DEFAULT_WAKE_WINDOW_SEC,
        help="Wake capture window length in seconds"
    )
    parser.add_argument(
        "--command-window-sec",
        type=float,
        default=DEFAULT_COMMAND_WINDOW_SEC,
        help="Follow-up command capture window length in seconds"
    )
    parser.add_argument(
        "--wake-words",
        default=",".join(sorted(WAKE_WORDS)),
        help="Comma-separated wake words (default includes common 'Mo' variants)"
    )
    parser.add_argument(
        "--silence-max-amp",
        type=int,
        default=int(os.getenv("VOICE_SILENCE_MAX_AMP", DEFAULT_SILENCE_MAX_AMP)),
        help="Max int16 amplitude below which audio may be treated as silent"
    )
    parser.add_argument(
        "--silence-rms-amp",
        type=int,
        default=int(os.getenv("VOICE_SILENCE_RMS_AMP", DEFAULT_SILENCE_RMS_AMP)),
        help="RMS int16 amplitude below which audio may be treated as silent"
    )

    args = parser.parse_args()

    listener = OllamaVoiceListener(
        device=args.device,
        mirror_url=args.mirror_url,
        enable_beeps=args.enable_beeps,
        enable_voice=args.enable_voice,
        parser_mode=args.parser_mode,
        stt_model=args.stt_model,
        stt_language=args.stt_language,
        wake_window_sec=args.wake_window_sec,
        command_window_sec=args.command_window_sec,
        wake_words=args.wake_words,
        silence_max_amp=args.silence_max_amp,
        silence_rms_amp=args.silence_rms_amp
    )
    listener.listen_loop()


if __name__ == "__main__":
    main()
