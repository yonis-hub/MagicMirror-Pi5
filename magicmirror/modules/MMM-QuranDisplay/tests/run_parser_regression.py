#!/usr/bin/env python3
"""Run deterministic parser regression cases for MMM-QuranDisplay voice listener."""

import argparse
import json
import sys
import types
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def install_stubs():
    """Provide lightweight stubs so parser tests can run without audio/STT runtime deps."""
    if "faster_whisper" not in sys.modules:
        module = types.ModuleType("faster_whisper")

        class DummyWhisperModel:
            def __init__(self, *args, **kwargs):
                pass

            def transcribe(self, *args, **kwargs):
                class Info:
                    language = "en"
                    language_probability = 1.0

                return iter([]), Info()

        module.WhisperModel = DummyWhisperModel
        sys.modules["faster_whisper"] = module

    if "sounddevice" not in sys.modules:
        module = types.ModuleType("sounddevice")
        module.play = lambda *args, **kwargs: None
        module.wait = lambda *args, **kwargs: None
        sys.modules["sounddevice"] = module

    if "python_mpv_jsonipc" not in sys.modules:
        module = types.ModuleType("python_mpv_jsonipc")

        class DummyMPV:
            def __init__(self, *args, **kwargs):
                self.pause = False

            def terminate(self):
                return None

        module.MPV = DummyMPV
        sys.modules["python_mpv_jsonipc"] = module


def load_cases(cases_path):
    with cases_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def normalize_action(action):
    return action if action else "none"


def extract_surah(action, value, intent):
    if action == "play":
        return value
    if action == "play_verse" and isinstance(value, (list, tuple)) and len(value) >= 1:
        return value[0]
    if isinstance(intent, dict):
        return intent.get("surah")
    return None


def main():
    parser = argparse.ArgumentParser(description="Parser regression runner")
    parser.add_argument(
        "--cases",
        default=str(Path(__file__).parent / "fixtures" / "parser_cases.json"),
        help="Path to JSON test case file"
    )
    args = parser.parse_args()

    install_stubs()

    module_dir = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(module_dir))
    import voice_listener_ollama as listener_module  # pylint: disable=import-error

    listener = listener_module.OllamaVoiceListener(
        parser_mode="local",
        stt_model="tiny",
        stt_language="auto",
        wake_window_sec=2.5,
        command_window_sec=3.5
    )

    cases = load_cases(Path(args.cases))
    failures = []

    for case in cases:
        original_text = case["input"]
        normalized_text = listener.normalize_speech(original_text)
        require_wake = case.get("require_wake", True)
        expected_action = case.get("expected_action", "none")
        expected_surah = case.get("expected_surah")

        action, value, intent = listener.parse_fallback(normalized_text, require_wake=require_wake)
        action = normalize_action(action)
        actual_surah = extract_surah(action, value, intent)

        if action != expected_action or actual_surah != expected_surah:
            failures.append({
                "name": case.get("name", original_text),
                "input": original_text,
                "normalized": normalized_text,
                "expected_action": expected_action,
                "actual_action": action,
                "expected_surah": expected_surah,
                "actual_surah": actual_surah
            })
            print(
                f"FAIL {case.get('name', original_text)}: "
                f"expected ({expected_action}, {expected_surah}) got ({action}, {actual_surah})"
            )
        else:
            print(f"PASS {case.get('name', original_text)}")

    print(f"\nSummary: {len(cases) - len(failures)}/{len(cases)} passing")
    if failures:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
