"""Piper TTS wrapper. Falls back to None on import/model failure so the
caller can use espeak-ng instead.

Piper produces natural-sounding speech from a small ONNX model. On Pi 5,
the en_US-amy-medium voice runs faster than real time.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Optional

from . import Unavailable

DEFAULT_VOICE_DIR = Path(
    os.environ.get(
        "PIPER_VOICE_DIR",
        Path.home() / "MagicMirror-Pi5" / "magicmirror" / "modules"
        / "MMM-QuranDisplay" / "voices",
    )
)
DEFAULT_VOICE_NAME = os.environ.get("PIPER_VOICE", "en_US-amy-medium")


class PiperTTS:
    """Thin synchronous wrapper around piper-tts.

    Uses the `piper` CLI (installed via `pip install piper-tts`) and pipes
    the resulting raw PCM to `aplay`. This avoids needing a Python audio
    output dependency.
    """

    def __init__(self, voice_dir: Path = DEFAULT_VOICE_DIR, voice_name: str = DEFAULT_VOICE_NAME):
        self.voice_dir = Path(voice_dir)
        self.voice_name = voice_name
        self.model_path = self.voice_dir / f"{voice_name}.onnx"
        self.config_path = self.voice_dir / f"{voice_name}.onnx.json"

        if not self.model_path.exists():
            raise Unavailable(f"Piper voice model not found at {self.model_path}")
        if not self.config_path.exists():
            raise Unavailable(f"Piper voice config not found at {self.config_path}")

        try:
            subprocess.run(
                ["piper", "--help"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                check=False,
            )
        except FileNotFoundError as e:
            raise Unavailable("piper CLI not on PATH (pip install piper-tts)") from e

    def speak(self, text: str, output_device: Optional[str] = None) -> bool:
        """Synthesize `text` and play it. Blocks until playback completes.

        Volume is scaled by PIPER_VOLUME env var (0.0 - 1.0, default 0.85
        = ~15% softer than the model's native output). When < 1.0 we route
        through ffmpeg's `volume` filter; when 1.0 we skip ffmpeg entirely.
        """
        if not text:
            return True
        try:
            try:
                vol = float(os.environ.get("PIPER_VOLUME", "0.85"))
            except ValueError:
                vol = 0.85
            vol = max(0.0, min(1.5, vol))  # clamp; allow slight boost but cap

            piper = subprocess.Popen(
                [
                    "piper",
                    "--model", str(self.model_path),
                    "--config", str(self.config_path),
                    "--output_raw",
                ],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
            )

            # Insert ffmpeg in the pipe when we need to scale volume.
            volume_filter = None
            if abs(vol - 1.0) > 1e-3:
                volume_filter = subprocess.Popen(
                    [
                        "ffmpeg", "-loglevel", "error", "-nostdin",
                        "-f", "s16le", "-ar", "22050", "-ac", "1", "-i", "pipe:0",
                        "-af", f"volume={vol:.3f}",
                        "-f", "s16le", "pipe:1",
                    ],
                    stdin=piper.stdout,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                )
                # Hand the read end off; parent shouldn't keep it.
                if piper.stdout:
                    piper.stdout.close()
                play_input = volume_filter.stdout
            else:
                play_input = piper.stdout

            aplay_cmd = ["aplay", "-r", "22050", "-f", "S16_LE", "-t", "raw", "-q"]
            if output_device:
                aplay_cmd.extend(["-D", output_device])
            aplay = subprocess.Popen(
                aplay_cmd,
                stdin=play_input,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

            assert piper.stdin is not None
            piper.stdin.write(text.encode("utf-8"))
            piper.stdin.close()
            if volume_filter is None and piper.stdout:
                piper.stdout.close()
            if volume_filter is not None and volume_filter.stdout:
                volume_filter.stdout.close()

            piper.wait(timeout=15)
            if volume_filter is not None:
                volume_filter.wait(timeout=15)
            aplay.wait(timeout=15)
            return aplay.returncode == 0
        except Exception as e:
            print(f"  [Piper] error: {e}")
            return False
