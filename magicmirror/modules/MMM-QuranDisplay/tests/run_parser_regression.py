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

    if "requests" not in sys.modules:
        # The parser path never makes HTTP calls -- Ollama is only reached from
        # parse_with_ollama(), which these cases bypass via parser_mode="local".
        # Stubbing it keeps the suite runnable on a bare Python with no venv.
        module = types.ModuleType("requests")

        class StubConnectionError(Exception):
            pass

        class StubTimeout(Exception):
            pass

        def unavailable(*args, **kwargs):
            raise StubConnectionError("requests is stubbed in parser regression tests")

        exceptions = types.ModuleType("requests.exceptions")
        exceptions.Timeout = StubTimeout
        exceptions.ConnectionError = StubConnectionError
        exceptions.RequestException = Exception

        module.ConnectionError = StubConnectionError
        module.Timeout = StubTimeout
        module.RequestException = Exception
        module.exceptions = exceptions
        module.get = unavailable
        module.post = unavailable
        sys.modules["requests"] = module
        sys.modules["requests.exceptions"] = exceptions


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
        # Optional floor on the local parser's confidence. Matters because
        # hybrid mode only skips the Ollama round-trip when the local result
        # scores >= LOCAL_HIGH_CONFIDENCE; a case can return the right action
        # and still be a latency regression if it scores below the gate.
        expected_min_confidence = case.get("expected_min_confidence")

        result = listener.parse_fallback(normalized_text, require_wake=require_wake)
        action, value, intent = result
        actual_confidence = listener_module.result_confidence(result)
        action = normalize_action(action)
        actual_surah = extract_surah(action, value, intent)

        mismatch = action != expected_action or actual_surah != expected_surah
        low_confidence = (
            expected_min_confidence is not None
            and actual_confidence < expected_min_confidence
        )

        if mismatch or low_confidence:
            failures.append({
                "name": case.get("name", original_text),
                "input": original_text,
                "normalized": normalized_text,
                "expected_action": expected_action,
                "actual_action": action,
                "expected_surah": expected_surah,
                "actual_surah": actual_surah,
                "expected_min_confidence": expected_min_confidence,
                "actual_confidence": actual_confidence
            })
            if mismatch:
                print(
                    f"FAIL {case.get('name', original_text)}: "
                    f"expected ({expected_action}, {expected_surah}) got ({action}, {actual_surah})"
                )
            else:
                print(
                    f"FAIL {case.get('name', original_text)}: confidence "
                    f"{actual_confidence:.2f} < required {expected_min_confidence:.2f} "
                    f"(would escalate to Ollama)"
                )
        else:
            suffix = f" [conf {actual_confidence:.2f}]" if expected_min_confidence is not None else ""
            print(f"PASS {case.get('name', original_text)}{suffix}")

    print(f"\nSummary: {len(cases) - len(failures)}/{len(cases)} passing")
    if failures:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
