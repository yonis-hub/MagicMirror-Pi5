#!/usr/bin/env python3
"""Local-only webcam face identity worker for MagicMirror.

This process never serves frames over HTTP. It reads from the local webcam,
matches against locally stored encodings, and emits identity updates as JSON
lines on stdout for the Node helper to relay inside MagicMirror only.
"""

from __future__ import annotations

import argparse
import base64
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


def configure_camera(camera, width: int, height: int) -> None:
    if width > 0:
        camera.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    if height > 0:
        camera.set(cv2.CAP_PROP_FRAME_HEIGHT, height)


def open_camera(camera_index: int, camera_device: str, width: int, height: int):
    attempts = []
    candidates = []

    if camera_device:
        candidates.append(("device", camera_device, cv2.CAP_ANY))
        if hasattr(cv2, "CAP_V4L2"):
            candidates.append(("device-v4l2", camera_device, cv2.CAP_V4L2))
    else:
        if hasattr(cv2, "CAP_V4L2"):
            candidates.append(("index-v4l2", camera_index, cv2.CAP_V4L2))
        candidates.append(("index", camera_index, cv2.CAP_ANY))
        candidates.append(("path", f"/dev/video{camera_index}", cv2.CAP_ANY))
        if hasattr(cv2, "CAP_V4L2"):
            candidates.append(("path-v4l2", f"/dev/video{camera_index}", cv2.CAP_V4L2))

    for label, source, backend in candidates:
        try:
            camera = cv2.VideoCapture(source, backend)
        except TypeError:
            camera = cv2.VideoCapture(source)
        configure_camera(camera, width, height)
        attempts.append(f"{label}:{source}")
        if camera and camera.isOpened():
            ok, _frame = camera.read()
            if ok:
                return camera, attempts
        if camera:
            camera.release()

    return None, attempts


def detect_identities(
    frame: np.ndarray,
    profiles: Dict[str, List[np.ndarray]],
    match_threshold: float,
    detector_model: str
) -> Tuple[List[dict], float, int]:
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    locations = face_recognition.face_locations(rgb_frame, model=detector_model)
    encodings = face_recognition.face_encodings(rgb_frame, locations)
    detections: List[dict] = []
    best_confidence = 0.0

    for location, encoding in zip(locations, encodings):
        best_label = "unknown"
        best_distance = None
        confidence = 0.0

        for label, known_encodings in profiles.items():
            distances = face_recognition.face_distance(np.array(known_encodings), encoding)
            if distances.size == 0:
                continue
            distance = float(np.min(distances))
            if best_distance is None or distance < best_distance:
                best_distance = distance
                best_label = label

        if best_distance is None or best_distance > match_threshold:
            best_label = "unknown"
        else:
            confidence = max(0.0, 1.0 - (best_distance / max(match_threshold, 1e-6)))
            best_confidence = max(best_confidence, confidence)

        detections.append(
            {
                "label": best_label,
                "confidence": float(confidence),
                "location": [int(v) for v in location]
            }
        )

    return detections, best_confidence, len(locations)


def collapse_identity(labels: Sequence[str]) -> str:
    label_set = {label for label in labels if label and label != "unknown"}
    if len(label_set) >= 2:
        return "both"
    if len(label_set) == 1:
        return next(iter(label_set))
    return "unknown"


def draw_corner_box(image: np.ndarray, left: int, top: int, right: int, bottom: int, color: Tuple[int, int, int]) -> None:
    width = max(right - left, 1)
    height = max(bottom - top, 1)
    corner = max(12, min(width, height) // 5)
    thickness = 2

    cv2.line(image, (left, top), (left + corner, top), color, thickness)
    cv2.line(image, (left, top), (left, top + corner), color, thickness)

    cv2.line(image, (right, top), (right - corner, top), color, thickness)
    cv2.line(image, (right, top), (right, top + corner), color, thickness)

    cv2.line(image, (left, bottom), (left + corner, bottom), color, thickness)
    cv2.line(image, (left, bottom), (left, bottom - corner), color, thickness)

    cv2.line(image, (right, bottom), (right - corner, bottom), color, thickness)
    cv2.line(image, (right, bottom), (right, bottom - corner), color, thickness)


def annotate_preview(
    frame: np.ndarray,
    detections: Sequence[dict],
    preview_width: int,
    preview_height: int,
    preview_quality: int,
    preview_mirror: bool,
    identity: str
) -> str:
    annotated = frame.copy()
    hud_green = (88, 255, 166)
    dim_green = (44, 154, 108)

    for detection in detections:
        top, right, bottom, left = detection.get("location", [0, 0, 0, 0])
        label = str(detection.get("label", "unknown")).upper()
        confidence = float(detection.get("confidence", 0.0))
        draw_corner_box(annotated, left, top, right, bottom, hud_green)

        label_text = label
        if label != "UNKNOWN":
            label_text = f"{label} {int(round(confidence * 100))}%"

        text_size, baseline = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        text_x = max(left, 8)
        text_y = max(top - 10, text_size[1] + 12)
        bg_left = max(text_x - 8, 0)
        bg_top = max(text_y - text_size[1] - 8, 0)
        bg_right = min(text_x + text_size[0] + 8, annotated.shape[1] - 1)
        bg_bottom = min(text_y + baseline + 4, annotated.shape[0] - 1)
        cv2.rectangle(annotated, (bg_left, bg_top), (bg_right, bg_bottom), (0, 0, 0), -1)
        cv2.rectangle(annotated, (bg_left, bg_top), (bg_right, bg_bottom), dim_green, 1)
        cv2.putText(annotated, label_text, (text_x, text_y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, hud_green, 1, cv2.LINE_AA)

    cv2.putText(annotated, "LOCAL ONLY", (10, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, hud_green, 1, cv2.LINE_AA)
    cv2.putText(
        annotated,
        f"IDENTITY {identity.upper()}",
        (10, annotated.shape[0] - 14),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.45,
        hud_green,
        1,
        cv2.LINE_AA
    )

    if preview_mirror:
        annotated = cv2.flip(annotated, 1)

    if preview_width > 0 and preview_height > 0:
        annotated = cv2.resize(annotated, (preview_width, preview_height), interpolation=cv2.INTER_AREA)

    ok, encoded = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), int(preview_quality)])
    if not ok:
        return ""

    return base64.b64encode(encoded.tobytes()).decode("ascii")


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
    parser.add_argument("--emit-preview", action="store_true")
    parser.add_argument("--preview-width", type=int, default=220)
    parser.add_argument("--preview-height", type=int, default=124)
    parser.add_argument("--preview-interval-ms", type=int, default=2500)
    parser.add_argument("--preview-quality", type=int, default=60)
    parser.add_argument("--preview-mirror", action="store_true")
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

    camera, camera_attempts = open_camera(args.camera_index, args.camera_device, args.frame_width, args.frame_height)
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
            error=f"Unable to open local webcam. Tried: {', '.join(camera_attempts) if camera_attempts else 'none'}",
            updatedAt=int(time.time() * 1000)
        )
        return 1

    stable_identity = "unknown"
    candidate_identity = ""
    candidate_hits = 0
    last_recognized_at = 0.0
    last_emitted = None
    last_preview_at = 0.0

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

            detections, confidence, face_count = detect_identities(
                frame=frame,
                profiles=profiles,
                match_threshold=args.match_threshold,
                detector_model=args.detector_model
            )
            labels = [str(detection.get("label", "")) for detection in detections if str(detection.get("label", ""))]
            recognized_labels = sorted({label for label in labels if label and label != "unknown"})
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
                "labels": recognized_labels,
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

            preview_due = args.emit_preview and ((loop_started - last_preview_at) * 1000 >= max(args.preview_interval_ms, 200))
            if preview_due:
                preview_b64 = annotate_preview(
                    frame=frame,
                    detections=detections,
                    preview_width=args.preview_width,
                    preview_height=args.preview_height,
                    preview_quality=max(25, min(args.preview_quality, 95)),
                    preview_mirror=args.preview_mirror,
                    identity=stable_identity
                )
                if preview_b64:
                    emit(
                        "preview",
                        image=preview_b64,
                        mimeType="image/jpeg",
                        width=args.preview_width,
                        height=args.preview_height,
                        updatedAt=int(loop_started * 1000),
                        secureLocalOnly=True
                    )
                    last_preview_at = loop_started

            elapsed = time.time() - loop_started
            sleep_for = max((args.scan_interval_ms / 1000.0) - elapsed, 0.05)
            time.sleep(sleep_for)
    finally:
        camera.release()

    return 0


if __name__ == "__main__":
    sys.exit(main())
