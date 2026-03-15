#!/usr/bin/env python3
"""Local-only webcam face identity worker for MagicMirror.

This process never serves frames over HTTP. It reads from the local webcam,
matches against locally stored encodings, and emits identity updates as JSON
lines on stdout for the Node helper to relay inside MagicMirror only.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import time
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

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

import numpy as np


RUNNING = True


def emit(event: str, **payload) -> None:
    message = {"event": event, **payload}
    print(json.dumps(message, ensure_ascii=False), flush=True)


def log(message: str, level: str = "info") -> None:
    emit("log", level=level, message=message, secureLocalOnly=True)


def handle_signal(_signum, _frame) -> None:
    global RUNNING
    RUNNING = False


def ensure_private_parent(file_path: Path) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(file_path.parent, 0o700)
    except OSError:
        pass


def load_profiles(data_file: Path, allowed_labels: Sequence[str]) -> Dict[str, List[np.ndarray]]:
    if not data_file.exists():
        return {}

    try:
        raw = json.loads(data_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    profiles = raw.get("profiles", {}) if isinstance(raw, dict) else {}
    allowed = {label for label in allowed_labels if label}
    loaded: Dict[str, List[np.ndarray]] = {}

    for label, values in profiles.items():
        if allowed and label not in allowed:
            continue
        if not isinstance(values, list):
            continue

        encodings = []
        for value in values:
            if isinstance(value, list) and value:
                encodings.append(np.array(value, dtype=np.float64))

        if encodings:
            loaded[label] = encodings

    return loaded


def get_profiles_mtime(data_file: Path) -> float:
    try:
        return data_file.stat().st_mtime
    except OSError:
        return 0.0


def open_camera(camera_index: int, camera_device: str, width: int, height: int):
    source = camera_device if camera_device else camera_index
    camera = cv2.VideoCapture(source)
    if width > 0:
        camera.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    if height > 0:
        camera.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    return camera


def detect_identities(
    frame: np.ndarray,
    profiles: Dict[str, List[np.ndarray]],
    match_threshold: float,
    detector_model: str
) -> Tuple[List[str], float, int]:
    if not profiles:
        return [], 0.0, 0

    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    locations = face_recognition.face_locations(rgb_frame, model=detector_model)
    encodings = face_recognition.face_encodings(rgb_frame, locations)
    labels: List[str] = []
    best_confidence = 0.0

    for encoding in encodings:
        best_label = None
        best_distance = None
        for label, known_encodings in profiles.items():
            distances = face_recognition.face_distance(np.array(known_encodings), encoding)
            if distances.size == 0:
                continue
            distance = float(np.min(distances))
            if best_distance is None or distance < best_distance:
                best_distance = distance
                best_label = label

        if best_label is None or best_distance is None or best_distance > match_threshold:
            continue

        confidence = max(0.0, 1.0 - (best_distance / max(match_threshold, 1e-6)))
        best_confidence = max(best_confidence, confidence)
        labels.append(best_label)

    unique_labels = sorted(set(labels))
    return unique_labels, best_confidence, len(locations)


def collapse_identity(labels: Sequence[str]) -> str:
    label_set = {label for label in labels if label}
    if len(label_set) >= 2:
        return "both"
    if len(label_set) == 1:
        return next(iter(label_set))
    return "unknown"


def update_stable_identity(
    detected_identity: str,
    stable_identity: str,
    candidate_identity: str,
    candidate_hits: int,
    last_recognized_at: float,
    now: float,
    required_matches: int,
    recall_hold_ms: int,
    unknown_hold_ms: int
) -> Tuple[str, str, int, float]:
    if detected_identity != "unknown":
        last_recognized_at = now

    if detected_identity == stable_identity:
        return stable_identity, "", 0, last_recognized_at

    if detected_identity == "unknown" and stable_identity != "unknown":
        if (now - last_recognized_at) * 1000 < max(recall_hold_ms, unknown_hold_ms):
            return stable_identity, candidate_identity, candidate_hits, last_recognized_at

    if candidate_identity == detected_identity:
        candidate_hits += 1
    else:
        candidate_identity = detected_identity
        candidate_hits = 1

    needed = 1 if detected_identity == "unknown" else max(required_matches, 1)
    if candidate_hits >= needed:
        stable_identity = detected_identity
        candidate_identity = ""
        candidate_hits = 0

    return stable_identity, candidate_identity, candidate_hits, last_recognized_at


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera-index", type=int, default=0)
    parser.add_argument("--camera-device", default="")
    parser.add_argument("--frame-width", type=int, default=320)
    parser.add_argument("--frame-height", type=int, default=240)
    parser.add_argument("--scan-interval-ms", type=int, default=2500)
    parser.add_argument("--required-matches", type=int, default=2)
    parser.add_argument("--recall-hold-ms", type=int, default=25000)
    parser.add_argument("--unknown-hold-ms", type=int, default=8000)
    parser.add_argument("--match-threshold", type=float, default=0.46)
    parser.add_argument("--data-file", required=True)
    parser.add_argument("--labels", default="")
    parser.add_argument("--detector-model", choices=["hog", "cnn"], default="hog")
    parser.add_argument("--debug", action="store_true")
    return parser.parse_args()


def main() -> int:
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    args = parse_args()
    data_file = Path(args.data_file).expanduser().resolve()
    ensure_private_parent(data_file)

    if cv2 is None:
        emit(
            "identity",
            identity="unknown",
            detectedIdentity="unknown",
            labels=[],
            faceCount=0,
            confidence=0.0,
            available=False,
            configured=False,
            secureLocalOnly=True,
            error=f"OpenCV unavailable: {CV2_IMPORT_ERROR}",
            updatedAt=int(time.time() * 1000)
        )
        return 1

    if face_recognition is None:
        emit(
            "identity",
            identity="unknown",
            detectedIdentity="unknown",
            labels=[],
            faceCount=0,
            confidence=0.0,
            available=False,
            configured=False,
            secureLocalOnly=True,
            error=f"face_recognition unavailable: {FACE_IMPORT_ERROR}",
            updatedAt=int(time.time() * 1000)
        )
        return 1

    allowed_labels = [label.strip() for label in str(args.labels or "").split(",") if label.strip()]
    profiles = load_profiles(data_file, allowed_labels)
    profiles_mtime = get_profiles_mtime(data_file)
    configured = bool(profiles)
    if configured:
        loaded_labels = ", ".join(sorted(profiles.keys()))
        log(f"Loaded local face profiles for: {loaded_labels}")
    else:
        log("No local face encodings found yet; staying in generic compliments mode.", level="warn")

    camera = open_camera(args.camera_index, args.camera_device, args.frame_width, args.frame_height)
    if not camera or not camera.isOpened():
        emit(
            "identity",
            identity="unknown",
            detectedIdentity="unknown",
            labels=[],
            faceCount=0,
            confidence=0.0,
            available=False,
            configured=configured,
            secureLocalOnly=True,
            error="Unable to open local webcam.",
            updatedAt=int(time.time() * 1000)
        )
        return 1

    stable_identity = "unknown"
    candidate_identity = ""
    candidate_hits = 0
    last_recognized_at = 0.0
    last_emitted = None

    try:
        while RUNNING:
            loop_started = time.time()
            current_profiles_mtime = get_profiles_mtime(data_file)
            if current_profiles_mtime != profiles_mtime:
                profiles = load_profiles(data_file, allowed_labels)
                profiles_mtime = current_profiles_mtime
                configured = bool(profiles)
                if configured:
                    loaded_labels = ", ".join(sorted(profiles.keys()))
                    log(f"Reloaded local face profiles for: {loaded_labels}")
                else:
                    log("Face profiles removed or empty; falling back to generic compliments.", level="warn")

            ok, frame = camera.read()
            if not ok or frame is None:
                emit(
                    "identity",
                    identity=stable_identity,
                    detectedIdentity="unknown",
                    labels=[],
                    faceCount=0,
                    confidence=0.0,
                    available=False,
                    configured=configured,
                    secureLocalOnly=True,
                    error="Webcam frame read failed.",
                    updatedAt=int(loop_started * 1000)
                )
                time.sleep(max(args.scan_interval_ms / 1000.0, 1.0))
                continue

            labels, confidence, face_count = detect_identities(
                frame=frame,
                profiles=profiles,
                match_threshold=args.match_threshold,
                detector_model=args.detector_model
            )
            detected_identity = collapse_identity(labels)
            stable_identity, candidate_identity, candidate_hits, last_recognized_at = update_stable_identity(
                detected_identity=detected_identity,
                stable_identity=stable_identity,
                candidate_identity=candidate_identity,
                candidate_hits=candidate_hits,
                last_recognized_at=last_recognized_at,
                now=loop_started,
                required_matches=args.required_matches,
                recall_hold_ms=args.recall_hold_ms,
                unknown_hold_ms=args.unknown_hold_ms
            )

            payload = {
                "event": "identity",
                "identity": stable_identity,
                "detectedIdentity": detected_identity,
                "labels": labels,
                "faceCount": face_count,
                "confidence": round(float(confidence), 3),
                "available": True,
                "configured": configured,
                "secureLocalOnly": True,
                "error": "",
                "updatedAt": int(loop_started * 1000)
            }

            signature = (
                payload["identity"],
                payload["detectedIdentity"],
                tuple(payload["labels"]),
                payload["faceCount"],
                payload["configured"]
            )
            if signature != last_emitted:
                print(json.dumps(payload, ensure_ascii=False), flush=True)
                last_emitted = signature
            elif args.debug:
                log(
                    "No identity change "
                    f"(stable={stable_identity}, detected={detected_identity}, faces={face_count}, confidence={payload['confidence']})"
                )

            elapsed = time.time() - loop_started
            sleep_for = max((args.scan_interval_ms / 1000.0) - elapsed, 0.05)
            time.sleep(sleep_for)
    finally:
        camera.release()

    return 0


if __name__ == "__main__":
    sys.exit(main())
