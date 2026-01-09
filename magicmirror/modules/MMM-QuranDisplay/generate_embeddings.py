#!/usr/bin/env python3
"""Utility script to build verse embeddings for semantic topic search."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import List, Dict

import numpy as np

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    print("sentence-transformers is required. Install with: pip install sentence-transformers")
    sys.exit(1)

MODULE_DIR = Path(__file__).resolve().parent


def find_repo_root() -> Path:
    current = MODULE_DIR
    for parent in [current] + list(current.parents):
        if (parent / "quran_data").exists():
            return parent
    return MODULE_DIR


REPO_ROOT = find_repo_root()
QURAN_DATA_DIR = REPO_ROOT / "quran_data"
EMBEDDING_DIR = MODULE_DIR / "embeddings"
EMBEDDING_DIR.mkdir(parents=True, exist_ok=True)
EMBEDDING_VECTOR_PATH = EMBEDDING_DIR / "verse_embeddings.npy"
EMBEDDING_META_PATH = EMBEDDING_DIR / "verse_metadata.json"


def load_verses() -> List[Dict[str, str]]:
    verses: List[Dict[str, str]] = []
    if not QURAN_DATA_DIR.exists():
        raise FileNotFoundError(f"Quran data directory not found: {QURAN_DATA_DIR}")

    for surah_dir in sorted(QURAN_DATA_DIR.iterdir()):
        if not surah_dir.is_dir():
            continue
        try:
            surah_num = int(surah_dir.name)
        except ValueError:
            try:
                surah_num = int(surah_dir.name.lstrip("0"))
            except ValueError:
                continue

        for json_path in sorted(surah_dir.glob("*.json")):
            try:
                payload = json.loads(json_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue

            verse_key = payload.get("verse_key") or f"{surah_num}:{json_path.stem}"
            verse_num_part = verse_key.split(":")[-1]
            try:
                verse_num = int(verse_num_part)
            except ValueError:
                verse_num = int(json_path.stem.lstrip("0") or 0)

            text_candidates = [
                payload.get("text"),
                payload.get("translation"),
                payload.get("translation_en"),
                payload.get("text_clean"),
                payload.get("text_uthmani"),
            ]
            verse_text = " ".join(t for t in text_candidates if t).strip()
            if not verse_text:
                continue

            verses.append({
                "surah": surah_num,
                "verse": verse_num,
                "text": verse_text
            })
    return verses


def build_embeddings(verses: List[Dict[str, str]]):
    print(f"Encoding {len(verses)} verses...")
    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    texts = [item["text"] for item in verses]
    embeddings = model.encode(
        texts,
        batch_size=64,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )
    embeddings = embeddings.astype(np.float32)
    np.save(EMBEDDING_VECTOR_PATH, embeddings)
    EMBEDDING_META_PATH.write_text(
        json.dumps([
            {"surah": item["surah"], "verse": item["verse"]}
            for item in verses
        ], ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"Saved embeddings to {EMBEDDING_VECTOR_PATH}")
    print(f"Saved metadata to {EMBEDDING_META_PATH}")


def main():
    verses = load_verses()
    if not verses:
        print("No verse data found. Ensure quran_data directory is populated.")
        sys.exit(1)
    build_embeddings(verses)


if __name__ == "__main__":
    main()
