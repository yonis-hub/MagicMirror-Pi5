#!/usr/bin/env python3
"""Round-trip test for the Quran verse disk cache.

Asserts that _cache_surah_to_local() writes the exact JSON shape that
_load_local_surah() reads back, so an API fetch becomes the local-first
(offline) source automatically. No network, no audio.

    python3 tests/test_quran_cache.py
"""

import os
import sys
import tempfile
from pathlib import Path

MODULE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MODULE_DIR))

failed = 0


def check(name, cond):
    global failed
    if cond:
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}")


def main():
    with tempfile.TemporaryDirectory() as tmp:
        # Point the chainer's data dir at an empty temp dir and disable the
        # metadata API so construction stays fully offline.
        os.environ["QURAN_DATA_DIR"] = tmp
        os.environ["QURAN_ALLOW_METADATA_API"] = "0"

        import quran_chainer  # imported after env is set

        chainer = quran_chainer.QuranChainer(mirror_url="http://localhost:0")

        surah_number = 112  # Al-Ikhlas, 4 short verses
        fetched = {
            "surah_info": {
                "number": 112,
                "arabicName": "الإخلاص",
                "englishName": "Al-Ikhlaas",
                "englishNameTranslation": "Sincerity",
                "totalVerses": 4,
                "revelationType": "Meccan",
            },
            "verses": [
                {"number": 1, "ayah_number": 6222, "arabic": "قُلْ هُوَ ٱللَّهُ أَحَدٌ",
                 "translation": "Say, He is Allah, [who is] One", "audio": "https://cdn/1.mp3"},
                {"number": 2, "ayah_number": 6223, "arabic": "ٱللَّهُ ٱلصَّمَدُ",
                 "translation": "Allah, the Eternal Refuge", "audio": "https://cdn/2.mp3"},
                {"number": 3, "ayah_number": 6224, "arabic": "لَمْ يَلِدْ وَلَمْ يُولَدْ",
                 "translation": "He neither begets nor is born", "audio": "https://cdn/3.mp3"},
                {"number": 4, "ayah_number": 6225, "arabic": "وَلَمْ يَكُن لَّهُۥ كُفُوًا أَحَدٌۢ",
                 "translation": "Nor is there to Him any equivalent", "audio": "https://cdn/4.mp3"},
            ],
        }

        # Write cache.
        chainer._cache_surah_to_local(surah_number, fetched)

        surah_dir = Path(tmp) / f"{surah_number:03}"
        check("surah dir created", surah_dir.is_dir())
        check("4 verse files written", len(list(surah_dir.glob("*.json"))) == 4)
        check("verse 001 padded filename", (surah_dir / "001.json").is_file())

        # Read it back via the production loader.
        loaded = chainer._load_local_surah(surah_number)
        check("load returns data", loaded is not None)
        if loaded:
            verses = loaded["verses"]
            check("loaded 4 verses", len(verses) == 4)
            v1 = verses[0]
            check("verse number preserved", v1["number"] == 1)
            check("arabic preserved", v1["arabic"].startswith("قُلْ"))
            check("translation preserved", "One" in v1["translation"])
            check("verses sorted ascending", [v["number"] for v in verses] == [1, 2, 3, 4])

        # Assert the persisted JSON itself carries the audio URL (the loader may
        # then prefer a local mp3 if one exists, which is a separate feature).
        import json as _json
        cached_v1 = _json.loads((surah_dir / "001.json").read_text(encoding="utf-8"))
        check("cached json keeps audio_url", cached_v1["audio_url"] == "https://cdn/1.mp3")
        check("cached json verse_key shape", cached_v1["verse_key"] == "112:1")
        check("cached json text_uthmani key", cached_v1["text_uthmani"].startswith("قُلْ"))

        # Empty payload is a no-op, never raises.
        chainer._cache_surah_to_local(99, {"verses": []})
        check("empty payload writes nothing", not (Path(tmp) / "099").exists())

    print(f"\n{'FAILURES: ' + str(failed) if failed else 'all checks passed'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
