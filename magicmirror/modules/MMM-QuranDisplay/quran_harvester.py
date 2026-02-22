#!/usr/bin/env python3
"""
Quran data harvester for MMM-QuranDisplay.

Downloads complete verse JSON data and audio files into:
    <repo>/quran_data/<surah>/<ayah>.json|mp3

Default behavior:
- Surah range: 1..114
- Writes JSON for each verse
- Writes surah metadata index: <repo>/quran_data/surah_index.json
- Downloads missing/invalid MP3 files
"""

from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests

ARABIC_QURAN_URL = "https://api.alquran.cloud/v1/quran/quran-uthmani"
ENGLISH_QURAN_URL = "https://api.alquran.cloud/v1/quran/en.asad"
AUDIO_BASE_URL = "https://cdn.islamic.network/quran/audio/128/ar.alafasy"
TOTAL_SURAHS = 114
SURAH_INDEX_FILENAME = "surah_index.json"


def find_repo_root() -> Path:
    """Locate repo root by searching for quran_data from current script directory."""
    script_dir = Path(__file__).resolve().parent
    for parent in [script_dir] + list(script_dir.parents):
        if (parent / "quran_data").exists():
            return parent
    # Fallback for expected layout: <repo>/magicmirror/modules/MMM-QuranDisplay
    parents = Path(__file__).resolve().parents
    if len(parents) > 3:
        return parents[3]
    return script_dir


def fetch_api_payload(url: str) -> Dict:
    response = requests.get(url, timeout=90)
    response.raise_for_status()
    payload = response.json()
    if payload.get("code") != 200:
        raise RuntimeError(f"API error for {url}: {payload.get('status')}")
    return payload["data"]


def is_mp3_file(path: Path) -> bool:
    if not path.exists() or path.stat().st_size < 512:
        return False
    try:
        with path.open("rb") as stream:
            header = stream.read(3)
    except OSError:
        return False
    if header.startswith(b"ID3"):
        return True
    if len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xE0) == 0xE0:
        return True
    return False


def write_verse_json(path: Path, payload: Dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8"
    )


def clean_text(value: str) -> str:
    # Some upstream responses include UTF-8 BOM on the first ayah.
    return str(value).replace("\ufeff", "").strip()


def download_audio_file(url: str, target_path: Path, retries: int = 3) -> Tuple[bool, Optional[str]]:
    temp_path = target_path.with_suffix(target_path.suffix + ".part")
    last_error: Optional[str] = None

    for attempt in range(1, retries + 1):
        try:
            with requests.get(url, timeout=90, stream=True) as response:
                response.raise_for_status()
                with temp_path.open("wb") as stream:
                    for chunk in response.iter_content(chunk_size=65536):
                        if chunk:
                            stream.write(chunk)

            if not is_mp3_file(temp_path):
                raise RuntimeError("downloaded file is not valid MP3 content")

            temp_path.replace(target_path)
            return True, None
        except Exception as error:  # pragma: no cover - retry path
            last_error = str(error)
            if temp_path.exists():
                temp_path.unlink()
            time.sleep(0.75 * attempt)

    return False, last_error


def build_manifest(
    arabic_surahs: List[Dict],
    english_surahs: List[Dict],
    start_surah: int,
    end_surah: int,
    output_dir: Path
) -> List[Dict]:
    if len(arabic_surahs) != TOTAL_SURAHS or len(english_surahs) != TOTAL_SURAHS:
        raise RuntimeError(
            f"Unexpected surah count from API. "
            f"Arabic={len(arabic_surahs)} English={len(english_surahs)}"
        )

    manifest: List[Dict] = []
    for ar_surah, en_surah in zip(arabic_surahs, english_surahs):
        surah_num = int(ar_surah["number"])
        if surah_num < start_surah or surah_num > end_surah:
            continue

        ar_ayahs = ar_surah.get("ayahs", [])
        en_ayahs = en_surah.get("ayahs", [])
        if len(ar_ayahs) != len(en_ayahs):
            raise RuntimeError(f"Ayah count mismatch in surah {surah_num}")

        surah_dir = output_dir / f"{surah_num:03}"
        surah_dir.mkdir(parents=True, exist_ok=True)

        for ar_ayah, en_ayah in zip(ar_ayahs, en_ayahs):
            verse_num = int(ar_ayah["numberInSurah"])
            ayah_number = int(ar_ayah["number"])
            audio_url = f"{AUDIO_BASE_URL}/{ayah_number}.mp3"
            file_prefix = f"{verse_num:03}"

            manifest.append({
                "surah": surah_num,
                "verse": verse_num,
                "ayah_number": ayah_number,
                "text_uthmani": clean_text(ar_ayah["text"]),
                "translation_en": clean_text(en_ayah["text"]),
                "audio_url": audio_url,
                "json_path": surah_dir / f"{file_prefix}.json",
                "mp3_path": surah_dir / f"{file_prefix}.mp3",
            })

    return manifest


def write_surah_index(arabic_surahs: List[Dict], output_dir: Path) -> None:
    index_payload: List[Dict] = []
    for surah in arabic_surahs:
        index_payload.append(
            {
                "number": int(surah["number"]),
                "arabicName": clean_text(surah.get("name", "")),
                "englishName": clean_text(surah.get("englishName", "")),
                "englishNameTranslation": clean_text(surah.get("englishNameTranslation", "")),
                "numberOfAyahs": int(surah.get("numberOfAyahs", 0) or 0),
                "revelationType": clean_text(surah.get("revelationType", "")),
            }
        )
    index_payload.sort(key=lambda entry: entry["number"])
    (output_dir / SURAH_INDEX_FILENAME).write_text(
        json.dumps(index_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Harvest Quran JSON/audio into quran_data.")
    parser.add_argument("--start-surah", type=int, default=1, help="First surah to download (1-114).")
    parser.add_argument("--end-surah", type=int, default=114, help="Last surah to download (1-114).")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Target quran_data directory. Defaults to <repo>/quran_data."
    )
    parser.add_argument("--skip-audio", action="store_true", help="Only write JSON files.")
    parser.add_argument("--force", action="store_true", help="Re-download MP3 even if existing file looks valid.")
    parser.add_argument("--workers", type=int, default=8, help="Parallel worker count for audio downloads.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not (1 <= args.start_surah <= TOTAL_SURAHS and 1 <= args.end_surah <= TOTAL_SURAHS):
        raise SystemExit("Surah range must be between 1 and 114.")
    if args.start_surah > args.end_surah:
        raise SystemExit("--start-surah must be <= --end-surah.")

    repo_root = find_repo_root()
    output_dir = (args.output_dir or (repo_root / "quran_data")).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Repo root: {repo_root}")
    print(f"Output dir: {output_dir}")
    print(f"Surah range: {args.start_surah}-{args.end_surah}")
    print("Fetching Quran text payloads...")

    arabic_data = fetch_api_payload(ARABIC_QURAN_URL)
    english_data = fetch_api_payload(ENGLISH_QURAN_URL)
    write_surah_index(arabic_data["surahs"], output_dir)
    manifest = build_manifest(
        arabic_surahs=arabic_data["surahs"],
        english_surahs=english_data["surahs"],
        start_surah=args.start_surah,
        end_surah=args.end_surah,
        output_dir=output_dir,
    )

    print(f"Building JSON files for {len(manifest)} verses...")
    for item in manifest:
        json_payload = {
            "verse_key": f"{item['surah']}:{item['verse']}",
            "ayah_number": item["ayah_number"],
            "text_uthmani": item["text_uthmani"],
            "translation_en": item["translation_en"],
            "audio_url": item["audio_url"],
            "segments": [],
            "segment_present": False,
        }
        write_verse_json(item["json_path"], json_payload)

    if args.skip_audio:
        print("Skipping audio download by request (--skip-audio).")
        return 0

    audio_tasks: List[Dict] = []
    skipped_valid = 0
    replaced_invalid = 0

    for item in manifest:
        mp3_path: Path = item["mp3_path"]
        if mp3_path.exists() and not args.force:
            if is_mp3_file(mp3_path):
                skipped_valid += 1
                continue
            replaced_invalid += 1
            mp3_path.unlink()
        audio_tasks.append(item)

    print(
        f"Audio summary before download: "
        f"skip_valid={skipped_valid}, replace_invalid={replaced_invalid}, to_download={len(audio_tasks)}"
    )

    failures: List[Tuple[Path, str]] = []
    failures_path = output_dir / "_failed_audio_downloads.txt"
    if audio_tasks:
        max_workers = max(1, min(args.workers, 24))
        print(f"Downloading audio with {max_workers} worker(s)...")
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_map = {
                executor.submit(download_audio_file, item["audio_url"], item["mp3_path"]): item
                for item in audio_tasks
            }
            completed = 0
            total = len(future_map)
            for future in as_completed(future_map):
                completed += 1
                item = future_map[future]
                ok, error_message = future.result()
                if not ok:
                    failures.append((item["mp3_path"], error_message or "unknown error"))
                if completed % 100 == 0 or completed == total:
                    print(f"Audio progress: {completed}/{total}")

    if failures:
        failures_path.write_text(
            "\n".join(f"{path}\t{error}" for path, error in failures) + "\n",
            encoding="utf-8"
        )
        print(f"Completed with {len(failures)} audio failure(s). See: {failures_path}")
        return 1

    if failures_path.exists():
        failures_path.unlink()

    print("Harvest complete with no audio failures.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
