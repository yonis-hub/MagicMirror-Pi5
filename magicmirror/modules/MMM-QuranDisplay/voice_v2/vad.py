"""silero-VAD streaming capture.

Opens an audio stream and records until the user naturally stops
speaking. The wake detector (openWakeWord) must be stopped before
calling this — only one consumer can hold the audio stream at a time.
"""

from __future__ import annotations

import os
import tempfile
import wave
from typing import Optional

import numpy as np

from . import Unavailable

SAMPLE_RATE = 16000
VAD_FRAME_MS = 32  # silero-VAD is fine with 30ms; pad to 32 for clean ints
VAD_FRAME_SIZE = int(SAMPLE_RATE * VAD_FRAME_MS / 1000)


class SileroVAD:
    def __init__(self):
        try:
            from silero_vad import load_silero_vad
        except Exception as e:
            raise Unavailable(f"silero_vad not importable: {e}") from e
        try:
            self.model = load_silero_vad()
        except Exception as e:
            raise Unavailable(f"silero_vad model failed to load: {e}") from e

    def record_command(
        self,
        max_duration_sec: float = 8.0,
        silence_tail_ms: int = 700,
        speech_start_timeout_sec: float = 3.0,
        threshold: float = 0.5,
        pre_roll_sec: float = 0.3,
    ) -> Optional[str]:
        """Open a mic stream and record until silence after speech.

        Returns path to a WAV with just the speech (pre-roll + speech + tail),
        or None if the user never spoke within `speech_start_timeout_sec`.
        """
        import sounddevice as sd
        import torch

        # Ring buffer for pre-roll so the first word isn't clipped
        pre_roll_frames = int(SAMPLE_RATE * pre_roll_sec)
        pre_roll = np.zeros(pre_roll_frames, dtype=np.int16)
        pre_roll_idx = 0

        captured: list[np.ndarray] = []
        speech_started = False
        silent_ms = 0
        elapsed_ms = 0
        max_ms = int(max_duration_sec * 1000)
        start_timeout_ms = int(speech_start_timeout_sec * 1000)

        try:
            stream = sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=1,
                dtype="int16",
                blocksize=VAD_FRAME_SIZE,
            )
        except Exception as e:
            print(f"  [VAD] cannot open stream: {e}")
            return None

        with stream:
            while elapsed_ms < max_ms:
                try:
                    frame, _ = stream.read(VAD_FRAME_SIZE)
                except Exception as e:
                    print(f"  [VAD] read error: {e}")
                    break

                samples = np.asarray(frame, dtype=np.int16).flatten()
                if len(samples) < VAD_FRAME_SIZE:
                    continue
                elapsed_ms += VAD_FRAME_MS

                # Maintain the ring-buffered pre-roll
                if not speech_started:
                    end = pre_roll_idx + len(samples)
                    if end <= pre_roll_frames:
                        pre_roll[pre_roll_idx:end] = samples
                    else:
                        overflow = end - pre_roll_frames
                        pre_roll[pre_roll_idx:] = samples[: len(samples) - overflow]
                        pre_roll[:overflow] = samples[len(samples) - overflow:]
                    pre_roll_idx = (pre_roll_idx + len(samples)) % pre_roll_frames

                frame_f32 = samples.astype(np.float32) / 32768.0
                with torch.no_grad():
                    prob = float(self.model(torch.from_numpy(frame_f32), SAMPLE_RATE).item())

                if prob >= threshold:
                    if not speech_started:
                        # Flush pre-roll into captured
                        if pre_roll_idx == 0:
                            ordered = pre_roll.copy()
                        else:
                            ordered = np.concatenate(
                                [pre_roll[pre_roll_idx:], pre_roll[:pre_roll_idx]]
                            )
                        captured.append(ordered)
                        speech_started = True
                    captured.append(samples)
                    silent_ms = 0
                else:
                    if speech_started:
                        captured.append(samples)
                        silent_ms += VAD_FRAME_MS
                        if silent_ms >= silence_tail_ms:
                            break
                    else:
                        if elapsed_ms >= start_timeout_ms:
                            return None

        if not speech_started or not captured:
            return None

        full = np.concatenate(captured)
        return _write_wav(full)


def _write_wav(samples: np.ndarray) -> str:
    fd, path = tempfile.mkstemp(suffix=".wav", prefix="vad_cmd_")
    os.close(fd)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(samples.tobytes())
    return path
