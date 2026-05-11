#!/usr/bin/env python3
"""Enrol your voice for speaker verification.

Records 3 short samples of you talking, computes a Resemblyzer
embedding from each, and stores their mean to disk. The listener
loads this embedding and compares it against every captured command
when --speaker-id is on.

Run once after installing the v2 requirements:
    source venv/bin/activate
    python3 enroll_voice.py
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

DEFAULT_OUT = Path(__file__).parent / "voiceprint.npy"
DEFAULT_DEVICE = os.environ.get("VOICE_DEVICE", "pulse")
SAMPLE_DURATION_SEC = 5
NUM_SAMPLES = 3
PROMPTS = [
    "Read this clearly: 'The morning sun rises over the eastern hills as birds begin to sing.'",
    "Now say in your normal voice: 'Hey Mo, play Surah Al Fatihah at a slow pace please.'",
    "One more — talk casually: 'I'd like to hear the recitation of the Quran whenever I ask Mo.'",
]


def record_sample(device: str, out_path: str, seconds: int = SAMPLE_DURATION_SEC) -> bool:
    cmd = [
        "arecord", "-D", device,
        "-f", "S16_LE", "-c", "1", "-r", "16000",
        "-d", str(seconds), "-q", out_path,
    ]
    try:
        subprocess.run(cmd, check=True, timeout=seconds + 5)
        return True
    except Exception as e:
        print(f"  ❌ Recording failed: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Enrol speaker voiceprint")
    parser.add_argument("--device", default=DEFAULT_DEVICE, help="ALSA/Pulse input device")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="Where to save voiceprint.npy")
    parser.add_argument("--samples", type=int, default=NUM_SAMPLES, help="Number of enrolment recordings")
    parser.add_argument("--seconds", type=int, default=SAMPLE_DURATION_SEC, help="Duration of each recording")
    args = parser.parse_args()

    try:
        from voice_v2.speaker import save_embedding
    except Exception as e:
        print(f"❌ voice_v2.speaker not importable: {e}")
        print("   Did you `pip install -r requirements_v2.txt`?")
        sys.exit(1)

    print(f"Enrolling voiceprint -> {args.out}")
    print(f"Recording device: {args.device}")
    print(f"You'll record {args.samples} samples of {args.seconds}s each.\n")

    sample_paths: list[str] = []
    try:
        for i in range(args.samples):
            prompt = PROMPTS[i % len(PROMPTS)]
            print(f"\n[Sample {i + 1}/{args.samples}] {prompt}")
            input("Press ENTER when ready to record... ")
            for c in (3, 2, 1):
                print(f"  Starting in {c}...")
                time.sleep(1)
            print(f"  🎙  RECORDING for {args.seconds}s — speak now")
            fd, tmp = tempfile.mkstemp(suffix=".wav", prefix=f"enroll_{i}_")
            os.close(fd)
            if not record_sample(args.device, tmp, args.seconds):
                print("  Skipping this sample.")
                continue
            sample_paths.append(tmp)
            print("  ✅ Captured")

        if not sample_paths:
            print("\nNo usable samples — aborting.")
            sys.exit(2)

        print(f"\nComputing voice embedding from {len(sample_paths)} sample(s)...")
        out = save_embedding(sample_paths, Path(args.out))
        print(f"✅ Voiceprint saved to {out}")
        print("\nTo enable speaker matching, restart the listener with --speaker-id (or VOICE_SPEAKER_ID=1).")
    finally:
        for p in sample_paths:
            try:
                os.unlink(p)
            except Exception:
                pass


if __name__ == "__main__":
    main()
