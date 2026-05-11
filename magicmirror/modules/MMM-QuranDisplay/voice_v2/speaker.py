"""Resemblyzer speaker verification.

Supports multiple enrolled voices. Each enrolled person's embedding is
stored as a separate `.npy` file in the voiceprints directory. On
verify, the captured audio is compared against every enrolled voiceprint
— if the best match clears the threshold, we accept it.

File layout::

    magicmirror/modules/MMM-QuranDisplay/
        voiceprints/
            alice.npy
            bob.npy

A legacy ``voiceprint.npy`` (single-user) is still honoured for
backward compatibility.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import numpy as np

from . import Unavailable

DEFAULT_VOICEPRINTS_DIR = Path(
    os.environ.get(
        "SPEAKER_VOICEPRINTS_DIR",
        Path.home() / "MagicMirror-Pi5" / "magicmirror" / "modules"
        / "MMM-QuranDisplay" / "voiceprints",
    )
)
LEGACY_SINGLE_VOICEPRINT = Path(
    os.environ.get(
        "SPEAKER_EMBEDDING",
        Path.home() / "MagicMirror-Pi5" / "magicmirror" / "modules"
        / "MMM-QuranDisplay" / "voiceprint.npy",
    )
)


class SpeakerVerifier:
    def __init__(
        self,
        voiceprints_dir: Path = DEFAULT_VOICEPRINTS_DIR,
        threshold: float = 0.55,
    ):
        self.voiceprints_dir = Path(voiceprints_dir)
        self.threshold = threshold
        self.references: dict[str, np.ndarray] = {}

        if self.voiceprints_dir.exists():
            for p in sorted(self.voiceprints_dir.glob("*.npy")):
                try:
                    self.references[p.stem] = np.load(p)
                except Exception as e:
                    print(f"  [SpeakerID] failed to load {p.name}: {e}")

        if LEGACY_SINGLE_VOICEPRINT.exists() and "default" not in self.references:
            try:
                self.references["default"] = np.load(LEGACY_SINGLE_VOICEPRINT)
            except Exception as e:
                print(f"  [SpeakerID] failed to load legacy voiceprint: {e}")

        if not self.references:
            raise Unavailable(
                f"No enrolled voiceprints in {self.voiceprints_dir} "
                f"or {LEGACY_SINGLE_VOICEPRINT}. Run enroll_voice.py."
            )

        try:
            from resemblyzer import VoiceEncoder
        except Exception as e:
            raise Unavailable(f"resemblyzer not importable: {e}") from e
        try:
            self.encoder = VoiceEncoder()
        except Exception as e:
            raise Unavailable(f"VoiceEncoder failed to init: {e}") from e

        print(f"  [SpeakerID] {len(self.references)} enrolled voice(s): "
              f"{', '.join(self.references)}")

    def verify_wav(self, wav_path: str) -> tuple[bool, float]:
        """Return (matches, best_similarity_score)."""
        try:
            from resemblyzer import preprocess_wav
            wav = preprocess_wav(wav_path)
            embedding = self.encoder.embed_utterance(wav)
            best_sim = -1.0
            best_name = None
            for name, ref in self.references.items():
                sim = float(np.dot(embedding, ref) / (
                    np.linalg.norm(embedding) * np.linalg.norm(ref) + 1e-9
                ))
                if sim > best_sim:
                    best_sim = sim
                    best_name = name
            if best_name:
                print(f"  [SpeakerID] best match: {best_name} ({best_sim:.2f})")
            return best_sim >= self.threshold, best_sim
        except Exception as e:
            print(f"  [SpeakerID] error: {e} — failing open (allow)")
            return True, 1.0


def save_embedding(
    wav_paths: list[str],
    name: str = "default",
    voiceprints_dir: Path = DEFAULT_VOICEPRINTS_DIR,
) -> Path:
    """Compute and save a mean embedding for `name`."""
    from resemblyzer import VoiceEncoder, preprocess_wav
    encoder = VoiceEncoder()
    embeddings = []
    for p in wav_paths:
        wav = preprocess_wav(p)
        embeddings.append(encoder.embed_utterance(wav))
    if not embeddings:
        raise ValueError("No enrollment audio supplied.")
    mean = np.mean(embeddings, axis=0)
    voiceprints_dir = Path(voiceprints_dir)
    voiceprints_dir.mkdir(parents=True, exist_ok=True)
    out_path = voiceprints_dir / f"{name}.npy"
    np.save(out_path, mean)
    return out_path
