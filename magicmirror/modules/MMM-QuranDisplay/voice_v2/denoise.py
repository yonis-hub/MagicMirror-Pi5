"""Spectral noise reduction for command audio.

Used only on the post-wake command capture (not on continuous wake
detection) to avoid CPU spikes. Removes AC / fan / hum so Whisper sees
a clean signal.
"""

from __future__ import annotations

import tempfile
import wave
from pathlib import Path
from typing import Optional

import numpy as np

from . import Unavailable


class Denoiser:
    def __init__(self):
        try:
            import noisereduce  # noqa: F401
        except Exception as e:
            raise Unavailable(f"noisereduce not importable: {e}") from e

    def clean_wav(self, in_path: str) -> str:
        """Return path to a new WAV with noise reduced. Caller should
        delete it after use. On failure returns the original path."""
        try:
            import noisereduce as nr
            with wave.open(in_path, "rb") as w:
                rate = w.getframerate()
                frames = w.readframes(w.getnframes())
                samples = np.frombuffer(frames, dtype=np.int16)

            if len(samples) == 0:
                return in_path

            float_samples = samples.astype(np.float32) / 32768.0
            cleaned = nr.reduce_noise(y=float_samples, sr=rate, stationary=False, prop_decrease=0.85)
            cleaned_int16 = np.clip(cleaned * 32768.0, -32768, 32767).astype(np.int16)

            fd, out_path = tempfile.mkstemp(suffix=".wav", prefix="denoise_")
            import os
            os.close(fd)
            with wave.open(out_path, "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(rate)
                w.writeframes(cleaned_int16.tobytes())
            return out_path
        except Exception as e:
            print(f"  [Denoise] error: {e} — using original audio")
            return in_path
