"""openWakeWord continuous wake-word engine.

Runs in a background thread, continuously reading from the mic and
firing an event when the wake phrase fires above threshold.

openWakeWord ships with several pre-trained models. For "Hey Mo" we
either:
  1. Train a custom model (see openwakeword docs — synthetic data + training)
  2. Or temporarily use a similar-sounding built-in model like 'hey_jarvis'

This wrapper picks whatever model files it finds in the model dir; if
none, it raises Unavailable so the listener falls back to Whisper-based
wake detection.
"""

from __future__ import annotations

import glob
import os
import queue
import threading
import time
from pathlib import Path
from typing import Optional

import numpy as np

from . import Unavailable

DEFAULT_MODEL_DIR = Path(
    os.environ.get(
        "OWW_MODEL_DIR",
        Path.home() / "MagicMirror-Pi5" / "magicmirror" / "modules"
        / "MMM-QuranDisplay" / "wake_models",
    )
)
SAMPLE_RATE = 16000
FRAME_SIZE = 1280  # openWakeWord expects 80ms chunks @ 16kHz = 1280 samples


class WakeDetector:
    def __init__(
        self,
        model_dir: Path = DEFAULT_MODEL_DIR,
        threshold: float = None,
        device: str = "pulse",
    ):
        if threshold is None:
            try:
                threshold = float(os.environ.get("OWW_THRESHOLD", "0.5"))
            except ValueError:
                threshold = 0.5
        self.model_dir = Path(model_dir)
        self.threshold = threshold
        self.device = device
        try:
            import openwakeword
            from openwakeword.model import Model
        except Exception as e:
            raise Unavailable(f"openwakeword not importable: {e}") from e

        model_paths = []
        if self.model_dir.exists():
            for ext in ("*.onnx", "*.tflite"):
                model_paths.extend(glob.glob(str(self.model_dir / ext)))

        # If no user-provided custom models, fall back to built-ins
        # (openwakeword auto-downloads "hey_jarvis", "alexa", "ok_nabu" etc).
        if model_paths:
            try:
                self.model = Model(wakeword_models=model_paths, inference_framework="onnx")
            except Exception as e:
                raise Unavailable(f"openWakeWord failed to load custom models: {e}") from e
        else:
            try:
                openwakeword.utils.download_models()
            except Exception:
                pass
            try:
                # hey_jarvis is the closest built-in to "hey mo" in cadence
                self.model = Model(wakeword_models=["hey_jarvis_v0.1"], inference_framework="onnx")
            except Exception as e:
                raise Unavailable(
                    f"openWakeWord failed to load built-in hey_jarvis: {e}. "
                    "Provide a custom model in voice_v2/wake_models/."
                ) from e

        self._stop = threading.Event()
        self._wake_q: "queue.Queue[float]" = queue.Queue()
        self._thread: Optional[threading.Thread] = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="oww-wake", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)

    def wait_for_wake(self, timeout: Optional[float] = None) -> bool:
        try:
            score = self._wake_q.get(timeout=timeout)
            # Drain anything else queued
            while not self._wake_q.empty():
                try:
                    self._wake_q.get_nowait()
                except queue.Empty:
                    break
            return True
        except queue.Empty:
            return False

    def _loop(self):
        import sounddevice as sd
        try:
            stream = sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=1,
                dtype="int16",
                blocksize=FRAME_SIZE,
            )
        except Exception as e:
            print(f"  [OWW] cannot open input stream: {e}")
            return

        with stream:
            cooldown_until = 0.0
            while not self._stop.is_set():
                try:
                    frame, _ = stream.read(FRAME_SIZE)
                except Exception as e:
                    print(f"  [OWW] stream read error: {e}")
                    time.sleep(0.2)
                    continue
                samples = np.asarray(frame, dtype=np.int16).flatten()
                try:
                    scores = self.model.predict(samples)
                except Exception as e:
                    print(f"  [OWW] predict error: {e}")
                    continue
                now = time.monotonic()
                if now < cooldown_until:
                    continue
                triggered = max(scores.values()) if scores else 0.0
                # Log near-misses too so the threshold can be tuned from logs
                if triggered >= self.threshold * 0.5:
                    print(f"  [OWW] score={triggered:.2f} (threshold={self.threshold:.2f})")
                if triggered >= self.threshold:
                    cooldown_until = now + 1.5  # avoid double-triggering
                    self._wake_q.put(triggered)
