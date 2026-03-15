#!/usr/bin/env python3
"""Capture local-only face encodings for MMM-FaceIdentity.

This script stores embeddings only. It does not save webcam frames by default.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    import cv2
except Exception as exc:  # pragma: no cover - runtime dependency check
    cv2 = None
    CV2_IMPORT_ERROR = str(exc)
else:
    CV2_IMPORT_ERROR = ""

try:
    import face_recognition
except Exception as exc:  # pragma: no cover - runtime dependency check
    face_recognition = None
    FACE_IMPORT_ERROR = str(exc)
else:
    FACE_IMPORT_ERROR = ""


def ensure_private_parent(file_path: Path) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(file_path.parent, 0o700)
    except OSError:
        pass


def open_camera(camera_index: int, camera_device: str, width: int, height: int):
    source = camera_device if camera_device else camera_index
    camera = cv2.VideoCapture(source)
    if width > 0:
        camera.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    if height > 0:
        camera.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    return camera


def load_existing_profiles(data_file: Path) -> dict:
    if not data_file.exists():
        return {"version": 1, "profiles": {}}

    try:
        raw = json.loads(data_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"version": 1, "profiles": {}}
    if not isinstance(raw, dict):
        return {"version": 1, "profiles": {}}
    raw.setdefault("version", 1)
    raw.setdefault("profiles", {})
    return raw


def save_profiles(data_file: Path, payload: dict) -> None:
    ensure_private_parent(data_file)
    data_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        os.chmod(data_file, 0o600)
    except OSError:
        pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", required=True, help="profile label, e.g. hyonis or wife")
    parser.add_argument("--samples", type=int, default=6)
    parser.add_argument("--sample-delay-sec", type=float, default=1.0)
    parser.add_argument("--camera-index", type=int, default=0)
    parser.add_argument("--camera-device", default="")
    parser.add_argument("--frame-width", type=int, default=640)
    parser.add_argument("--frame-height", type=int, default=480)
    parser.add_argument("--data-file", default="data/encodings.json")
    parser.add_argument("--replace", action="store_true")
    return parser.parse_args()


def main() -> int:
    if cv2 is None:
        print(f"OpenCV unavailable: {CV2_IMPORT_ERROR}", file=sys.stderr)
        return 1
    if face_recognition is None:
        print(f"face_recognition unavailable: {FACE_IMPORT_ERROR}", file=sys.stderr)
        return 1

    args = parse_args()
    data_file = Path(args.data_file).expanduser().resolve()
    ensure_private_parent(data_file)

    print(
        f"Starting local-only enrollment for '{args.label}'. "
        "No raw webcam images will be stored."
    )
    print("Stand in front of the webcam. Samples will be captured automatically.")

    camera = open_camera(args.camera_index, args.camera_device, args.frame_width, args.frame_height)
    if not camera or not camera.isOpened():
        print("Unable to open webcam for enrollment.", file=sys.stderr)
        return 1

    collected = []
    last_capture_at = 0.0

    try:
        while len(collected) < args.samples:
            ok, frame = camera.read()
            if not ok or frame is None:
                time.sleep(0.2)
                continue

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            locations = face_recognition.face_locations(rgb, model="hog")
            if len(locations) != 1:
                print(f"Waiting for exactly one clear face... detected={len(locations)}")
                time.sleep(0.4)
                continue

            now = time.time()
            if now - last_capture_at < args.sample_delay_sec:
                time.sleep(0.1)
                continue

            encodings = face_recognition.face_encodings(rgb, locations)
            if not encodings:
                time.sleep(0.2)
                continue

            collected.append(encodings[0].tolist())
            last_capture_at = now
            print(f"Captured sample {len(collected)}/{args.samples}")
            time.sleep(0.4)
    finally:
        camera.release()

    payload = load_existing_profiles(data_file)
    profiles = payload.setdefault("profiles", {})
    if args.replace:
        profiles[args.label] = collected
    else:
        existing = profiles.get(args.label, [])
        if not isinstance(existing, list):
            existing = []
        profiles[args.label] = existing + collected

    save_profiles(data_file, payload)
    print(f"Saved {len(collected)} samples for '{args.label}' to {data_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
