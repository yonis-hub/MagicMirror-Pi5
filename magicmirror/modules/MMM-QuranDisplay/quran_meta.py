"""Static Quran metadata: per-surah verse counts (Hafs) and juz boundaries.

Used to translate juz-level requests ("play juz 20") into the
(surah, start_verse, end_verse) segments the chainer already understands.
"""

from __future__ import annotations

# Verse count per surah (1-114), Hafs `an Asim recension.
SURAH_VERSE_COUNTS: dict[int, int] = {
    1: 7, 2: 286, 3: 200, 4: 176, 5: 120, 6: 165, 7: 206, 8: 75, 9: 129, 10: 109,
    11: 123, 12: 111, 13: 43, 14: 52, 15: 99, 16: 128, 17: 111, 18: 110, 19: 98, 20: 135,
    21: 112, 22: 78, 23: 118, 24: 64, 25: 77, 26: 227, 27: 93, 28: 88, 29: 69, 30: 60,
    31: 34, 32: 30, 33: 73, 34: 54, 35: 45, 36: 83, 37: 182, 38: 88, 39: 75, 40: 85,
    41: 54, 42: 53, 43: 89, 44: 59, 45: 37, 46: 35, 47: 38, 48: 29, 49: 18, 50: 45,
    51: 60, 52: 49, 53: 62, 54: 55, 55: 78, 56: 96, 57: 29, 58: 22, 59: 24, 60: 13,
    61: 14, 62: 11, 63: 11, 64: 18, 65: 12, 66: 12, 67: 30, 68: 52, 69: 52, 70: 44,
    71: 28, 72: 28, 73: 20, 74: 56, 75: 40, 76: 31, 77: 50, 78: 40, 79: 46, 80: 42,
    81: 29, 82: 19, 83: 36, 84: 25, 85: 22, 86: 17, 87: 19, 88: 26, 89: 30, 90: 20,
    91: 15, 92: 21, 93: 11, 94: 8, 95: 8, 96: 19, 97: 5, 98: 8, 99: 8, 100: 11,
    101: 11, 102: 8, 103: 3, 104: 9, 105: 5, 106: 4, 107: 7, 108: 3, 109: 6, 110: 3,
    111: 5, 112: 4, 113: 5, 114: 6,
}

# (start_surah, start_verse, end_surah, end_verse) per juz.
# Three boundaries diverged from the user-supplied source list and were
# reconciled against the neighbouring juz to keep the chain contiguous:
#   juz 9  ends at 8:40 (source said 6:110)
#   juz 10 ends at 9:92 (source said 7:87)
#   juz 18 starts at 23:1 (source had 23-1)
JUZ_BOUNDS: dict[int, tuple[int, int, int, int]] = {
    1:  (1,   1,  2, 141),
    2:  (2, 142,  2, 252),
    3:  (2, 253,  3,  92),
    4:  (3,  93,  4,  23),
    5:  (4,  24,  4, 147),
    6:  (4, 148,  5,  81),
    7:  (5,  82,  6, 110),
    8:  (6, 111,  7,  87),
    9:  (7,  88,  8,  40),
    10: (8,  41,  9,  92),
    11: (9,  93, 11,   5),
    12: (11,  6, 12,  52),
    13: (12, 53, 14,  52),
    14: (15,  1, 16, 128),
    15: (17,  1, 18,  74),
    16: (18, 75, 20, 135),
    17: (21,  1, 22,  78),
    18: (23,  1, 25,  20),
    19: (25, 21, 27,  55),
    20: (27, 56, 29,  45),
    21: (29, 46, 33,  30),
    22: (33, 31, 36,  27),
    23: (36, 28, 39,  31),
    24: (39, 32, 41,  46),
    25: (41, 47, 45,  37),
    26: (46,  1, 51,  30),
    27: (51, 31, 57,  29),
    28: (58,  1, 66,  12),
    29: (67,  1, 77,  50),
    30: (78,  1, 114,  6),
}

JUZ_NAMES: dict[int, str] = {
    1: "Alif Lam Meem", 2: "Sayaqool", 3: "Tilkal Rusulu", 4: "Lan tanaloo albirra",
    5: "Wal Mohsanatu", 6: "La Yuhibbullah", 7: "Wa Iza Samiu", 8: "Wa Lau Annana",
    9: "Qalal Malao", 10: "Wa A'lamu", 11: "Yatazeroon", 12: "Wa Mamin Da'abatin",
    13: "Wa Ma Ubrioo", 14: "Rubama", 15: "Subhan iladhi", 16: "Qala Alam",
    17: "Iqtaraba li'n-nasi", 18: "Qadd Aflaha", 19: "Wa Qala illadhina",
    20: "A'man Khalaqa", 21: "Utlu Ma Oohiya", 22: "Wa-Man yaqnut", 23: "Wa Mali",
    24: "Fa-man Azlamu", 25: "Ilayhi Yuruddu", 26: "Ha Meem",
    27: "Qala Fama Khatbukum", 28: "Qadd Sami Allah", 29: "Tabaraka lladhi", 30: "Amma",
}


def juz_to_segments(juz: int) -> list[tuple[int, int, int]]:
    """Expand a juz number into [(surah, start_verse, end_verse), ...] segments.

    Raises ValueError for juz outside 1-30.
    """
    if juz not in JUZ_BOUNDS:
        raise ValueError(f"juz must be 1-30, got {juz}")
    s1, v1, s2, v2 = JUZ_BOUNDS[juz]
    if s1 == s2:
        return [(s1, v1, v2)]
    segments: list[tuple[int, int, int]] = [(s1, v1, SURAH_VERSE_COUNTS[s1])]
    for s in range(s1 + 1, s2):
        segments.append((s, 1, SURAH_VERSE_COUNTS[s]))
    segments.append((s2, 1, v2))
    return segments


def juz_summary(juz: int) -> str:
    """Human-readable summary, e.g. 'Juz 20 (A'man Khalaqa): 27:56 -> 29:45'."""
    s1, v1, s2, v2 = JUZ_BOUNDS[juz]
    return f"Juz {juz} ({JUZ_NAMES[juz]}): {s1}:{v1} -> {s2}:{v2}"
