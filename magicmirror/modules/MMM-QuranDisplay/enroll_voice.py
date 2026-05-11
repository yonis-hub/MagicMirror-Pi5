#!/usr/bin/env python3
"""Enrol one or more voices for speaker verification.

Each person gets their own voiceprint file under ``voiceprints/<name>.npy``.
The listener loads every enrolled voiceprint and accepts a command if any
matches above the similarity threshold.

Usage:
    python3 enroll_voice.py                  # enrols as "default"
    python3 enroll_voice.py --name yonis     # enrols you as "yonis"
    python3 enroll_voice.py --name kid       # add another household voice

While recording, status is mirrored to MagicMirror's transcript endpoint
so you can see prompts and countdown on the wall.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

DEFAULT_NAME = "default"
DEFAULT_DEVICE = os.environ.get("VOICE_DEVICE", "pulse")
DEFAULT_MIRROR_URL = os.environ.get("MIRROR_URL", "http://localhost:8080")
DEFAULT_VOICEPRINTS_DIR = Path(__file__).parent / "voiceprints"
SAMPLE_DURATION_SEC = 5
NUM_SAMPLES = 3
PROMPTS = [
    "Read this clearly: The morning sun rises over the eastern hills as birds begin to sing.",
    "Now in your normal voice: Hey Mo, play Surah Al Fatihah at a slow pace please.",
    "One more, talk casually: I'd like to hear the recitation of the Quran whenever I ask Mo.",
]


def mm_post(mirror_url: str, path: str, payload: dict) -> None:
    """POST a status update to MagicMirror. Silent on failure so a missing
    server can't break the enrollment flow."""
    try:
        import requests
        requests.post(f"{mirror_url.rstrip('/')}{path}", json=payload, timeout=1)
    except Exception:
        pass


def show_on_mirror(mirror_url: str, text: str, phase: str = "enrolling") -> None:
    """Display a status line on the mirror via the transcript endpoint."""
    mm_post(mirror_url, "/api/quran/transcript", {
        "text": text,
        "phase": phase,
        "rawText": text,
    })


def set_recording(mirror_url: str, recording: bool) -> None:
    mm_post(mirror_url, "/api/quran/recording", {"isRecording": recording})


def clear_mirror(mirror_url: str) -> None:
    mm_post(mirror_url, "/api/quran/transcript", {
        "text": "",
        "phase": "idle",
        "rawText": "",
    })


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
    parser = argparse.ArgumentParser(description="Enrol a speaker voiceprint")
    parser.add_argument("--name", default=DEFAULT_NAME,
                        help="Label for this voiceprint (one per person, e.g. 'yonis', 'kid')")
    parser.add_argument("--device", default=DEFAULT_DEVICE, help="ALSA/Pulse input device")
    parser.add_argument("--voiceprints-dir", default=str(DEFAULT_VOICEPRINTS_DIR),
                        help="Where to save voiceprint files")
    parser.add_argument("--mirror-url", default=DEFAULT_MIRROR_URL,
                        help="MagicMirror base URL for on-screen indicators")
    parser.add_argument("--samples", type=int, default=NUM_SAMPLES,
                        help="Number of enrolment recordings")
    parser.add_argument("--seconds", type=int, default=SAMPLE_DURATION_SEC,
                        help="Duration of each recording")
    parser.add_argument("--no-mirror", action="store_true",
                        help="Disable on-screen indicators on MagicMirror")
    args = parser.parse_args()

    mirror_url = "" if args.no_mirror else args.mirror_url

    try:
        from voice_v2.speaker import save_embedding
    except Exception as e:
        print(f"❌ voice_v2.speaker not importable: {e}")
        print("   Did you `pip install -r requirements_v2.txt`?")
        sys.exit(1)

    name_clean = "".join(c if c.isalnum() or c in "-_" else "_" for c in args.name) or "default"
    voiceprints_dir = Path(args.voiceprints_dir)
    voiceprints_dir.mkdir(parents=True, exist_ok=True)
    target = voiceprints_dir / f"{name_clean}.npy"

    print(f"Enrolling voice '{name_clean}' -> {target}")
    print(f"Recording device: {args.device}")
    if mirror_url:
        print(f"Mirror status: {mirror_url}")
    print(f"You'll record {args.samples} samples of {args.seconds}s each.\n")

    show_on_mirror(mirror_url, f"Enrolling voice: {name_clean}")
    time.sleep(0.5)

    sample_paths: list[str] = []
    try:
        for i in range(args.samples):
            prompt = PROMPTS[i % len(PROMPTS)]
            print(f"\n[Sample {i + 1}/{args.samples}] {prompt}")
            show_on_mirror(mirror_url,
                           f"Sample {i + 1}/{args.samples}: {prompt}")
            input("Press ENTER when ready to record... ")

            for c in (3, 2, 1):
                print(f"  Starting in {c}...")
                show_on_mirror(mirror_url, f"Recording in {c}...")
                time.sleep(1)

            print(f"  🎙  RECORDING for {args.seconds}s — speak now")
            show_on_mirror(mirror_url, f"🎙 Speak now ({args.seconds}s)")
            set_recording(mirror_url, True)

            fd, tmp = tempfile.mkstemp(suffix=".wav", prefix=f"enroll_{i}_")
            os.close(fd)
            ok = record_sample(args.device, tmp, args.seconds)
            set_recording(mirror_url, False)
            if not ok:
                print("  Skipping this sample.")
                show_on_mirror(mirror_url, "❌ Recording failed, retrying")
                continue
            sample_paths.append(tmp)
            print("  ✅ Captured")
            show_on_mirror(mirror_url, f"✅ Captured sample {i + 1}/{args.samples}")
            time.sleep(0.6)

        if not sample_paths:
            print("\nNo usable samples — aborting.")
            show_on_mirror(mirror_url, "❌ No samples captured — aborted")
            sys.exit(2)

        print(f"\nComputing voice embedding from {len(sample_paths)} sample(s)...")
        show_on_mirror(mirror_url, "🧠 Computing voiceprint...")
        out = save_embedding(sample_paths, name=name_clean, voiceprints_dir=voiceprints_dir)
        print(f"✅ Voiceprint saved to {out}")
        show_on_mirror(mirror_url, f"✅ Enrolled: {name_clean}")
        time.sleep(2)
        print(f"\nThis voice is now recognised. Restart the listener to apply.")
        print(f"To add another voice (family, etc.): python3 enroll_voice.py --name <person>")
    finally:
        for p in sample_paths:
            try:
                os.unlink(p)
            except Exception:
                pass
        if mirror_url:
            time.sleep(0.5)
            clear_mirror(mirror_url)


if __name__ == "__main__":
    main()
