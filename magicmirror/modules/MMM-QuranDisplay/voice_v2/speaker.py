"""Resemblyzer speaker verification.

Stores a voice embedding for the enrolled user. On wake, the captured
audio is matched against the embedding. If similarity falls below a
threshold, the trigger is rejected (probably TV / someone else).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import numpy as np

from . import Unavailable

DEFAULT_EMBEDDING_PATH = Path(
    os.environ.get(
        "SPEAKER_EMBEDDING",
        Path.home() / "MagicMirror-Pi5" / "magicmirror" / "modules"
        / "MMM-QuranDisplay" / "voiceprint.npy",
    )
)


class SpeakerVerifier:
    def __init__(self, embedding_path: Path = DEFAULT_EMBEDDING_PATH, threshold: float = 0.65):
        self.embedding_path = Path(embedding_path)
        self.threshold = threshold
        if not self.embedding_path.exists():
            raise Unavailable(
                f"No enrolled voiceprint at {self.embedding_path}. "
                "Run enroll_voice.py to create one."
            )
        try:
            from resemblyzer import VoiceEncoder
        except Exception as e:
            raise Unavailable(f"resemblyzer not importable: {e}") from e
        try:
            self.encoder = VoiceEncoder()
        except Exception as e:
            raise Unavailable(f"VoiceEncoder failed to init: {e}") from e
        self.reference = np.load(self.embedding_path)

    def verify_wav(self, wav_path: str) -> tuple[bool, float]:
        """Return (matches, similarity). Caller decides what to do."""
        try:
            from resemblyzer import preprocess_wav
            wav = preprocess_wav(wav_path)
            embedding = self.encoder.embed_utterance(wav)
            sim = float(np.dot(embedding, self.reference) / (
                np.linalg.norm(embedding) * np.linalg.norm(self.reference) + 1e-9
            ))
            return sim >= self.threshold, sim
        except Exception as e:
            print(f"  [SpeakerID] error: {e} — failing open (allow)")
            return True, 1.0  # fail open on errors so a broken speaker-id doesn't lock you out


def save_embedding(wav_paths: list[str], out_path: Path = DEFAULT_EMBEDDING_PATH) -> Path:
    """Compute and save a mean embedding from one or more enrollment WAVs."""
    from resemblyzer import VoiceEncoder, preprocess_wav
    encoder = VoiceEncoder()
    embeddings = []
    for p in wav_paths:
        wav = preprocess_wav(p)
        embeddings.append(encoder.embed_utterance(wav))
    if not embeddings:
        raise ValueError("No enrollment audio supplied.")
    mean = np.mean(embeddings, axis=0)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    np.save(out_path, mean)
    return out_path
