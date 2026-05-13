#!/usr/bin/env python3
"""
Quran Verse Chainer for MagicMirror
Plays verses using local quran_data first, falls back to API when needed,
and sends display updates to MMM-QuranDisplay module.

Usage:
    python3 quran_chainer.py --surah 1 --start-verse 1 --mirror-url http://localhost:8080
"""

import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
import time
import requests
import signal
import threading
from pathlib import Path

# Surah name mapping for voice command parsing
SURAH_NAMES = {
    "fatiha": 1, "baqara": 2, "imran": 3, "nisa": 4, "maida": 5,
    "anam": 6, "araf": 7, "anfal": 8, "tawba": 9, "yunus": 10,
    "hud": 11, "yusuf": 12, "rad": 13, "ibrahim": 14, "hijr": 15,
    "nahl": 16, "isra": 17, "kahf": 18, "maryam": 19, "taha": 20,
    "anbiya": 21, "hajj": 22, "muminun": 23, "nur": 24, "furqan": 25,
    "shuara": 26, "naml": 27, "qasas": 28, "ankabut": 29, "rum": 30,
    "luqman": 31, "sajda": 32, "ahzab": 33, "saba": 34, "fatir": 35,
    "yasin": 36, "saffat": 37, "sad": 38, "zumar": 39, "ghafir": 40,
    "fussilat": 41, "shura": 42, "zukhruf": 43, "dukhan": 44, "jathiya": 45,
    "ahqaf": 46, "muhammad": 47, "fath": 48, "hujurat": 49, "qaf": 50,
    "dhariyat": 51, "tur": 52, "najm": 53, "qamar": 54, "rahman": 55,
    "waqia": 56, "hadid": 57, "mujadila": 58, "hashr": 59, "mumtahina": 60,
    "saff": 61, "jumua": 62, "munafiqun": 63, "taghabun": 64, "talaq": 65,
    "tahrim": 66, "mulk": 67, "qalam": 68, "haqqa": 69, "maarij": 70,
    "nuh": 71, "jinn": 72, "muzzammil": 73, "muddaththir": 74, "qiyama": 75,
    "insan": 76, "mursalat": 77, "naba": 78, "naziat": 79, "abasa": 80,
    "takwir": 81, "infitar": 82, "mutaffifin": 83, "inshiqaq": 84, "buruj": 85,
    "tariq": 86, "ala": 87, "ghashiya": 88, "fajr": 89, "balad": 90,
    "shams": 91, "layl": 92, "duha": 93, "sharh": 94, "tin": 95,
    "alaq": 96, "qadr": 97, "bayyina": 98, "zalzala": 99, "adiyat": 100,
    "qaria": 101, "takathur": 102, "asr": 103, "humaza": 104, "fil": 105,
    "quraysh": 106, "maun": 107, "kawthar": 108, "kafirun": 109, "nasr": 110,
    "masad": 111, "ikhlas": 112, "falaq": 113, "nas": 114
}

SURAH_INDEX_FILENAME = "surah_index.json"


class QuranChainer:
    def __init__(self, mirror_url="http://localhost:8080", reciter=None):
        self.mirror_url = mirror_url
        self.is_paused = False
        self.is_stopped = False
        self.current_process = None
        self.stdin_thread = None
        self.surah_info_cache = {}
        self.repo_root = self._find_repo_root()
        data_override = os.environ.get("QURAN_DATA_DIR")
        self.quran_data_dir = Path(data_override).expanduser().resolve() if data_override else self.repo_root / "quran_data"
        metadata_api_raw = os.environ.get("QURAN_ALLOW_METADATA_API", "0")
        self.allow_metadata_api = str(metadata_api_raw).strip().lower() in {"1", "true", "yes", "on"}
        self.surah_index = self._load_surah_index()
        self.reciter_manifest = self._load_reciter_manifest()
        self.reciter_key, self.reciter = self._resolve_reciter(reciter)
        print(f"Using Quran data directory: {self.quran_data_dir}")
        print(f"Using reciter: {self.reciter.get('name', self.reciter_key)} (layout={self.reciter.get('layout')})")
        if self.surah_index:
            print(f"Loaded local surah metadata index ({len(self.surah_index)} entries)")
        elif self.allow_metadata_api:
            print("Local surah metadata index not found; API metadata fallback enabled")
        else:
            print("Local surah metadata index not found; using generic surah labels")

        # Handle signals for graceful shutdown
        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)

        # Node helper spawns this script with stdin pipe; handle PAUSE/RESUME/STOP.
        if not sys.stdin.isatty():
            self.stdin_thread = threading.Thread(target=self._stdin_listener, daemon=True)
            self.stdin_thread.start()

    def _find_repo_root(self):
        script_dir = Path(__file__).resolve().parent
        for parent in [script_dir] + list(script_dir.parents):
            if (parent / "quran_data").exists():
                return parent
        parents = Path(__file__).resolve().parents
        if len(parents) > 3:
            return parents[3]
        return script_dir

    def _reciter_manifest_path(self):
        return Path(__file__).resolve().parent / "reciters.json"

    def _load_reciter_manifest(self):
        path = self._reciter_manifest_path()
        if not path.exists():
            # Backwards-compat: no manifest -> single reciter assumed
            return {
                "default": "alafasy",
                "current": "alafasy",
                "reciters": {
                    "alafasy": {
                        "name": "Mishary Alafasy",
                        "layout": "verse",
                        "audio_dir": "quran_data",
                        "audio_pattern": "{surah:03d}/{verse:03d}.mp3",
                        "aliases": ["alafasy", "default"],
                    }
                },
            }
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"Warning: could not read reciters manifest at {path}: {e}")
            return {"default": "alafasy", "current": "alafasy", "reciters": {}}

    def _resolve_reciter(self, requested):
        reciters = self.reciter_manifest.get("reciters", {})
        chosen = requested or self.reciter_manifest.get("current") or self.reciter_manifest.get("default") or "alafasy"
        if chosen in reciters:
            return chosen, reciters[chosen]
        # Try matching by alias (case-insensitive)
        normalized = chosen.lower().strip() if isinstance(chosen, str) else ""
        for key, info in reciters.items():
            if key.lower() == normalized:
                return key, info
            for alias in info.get("aliases", []):
                if alias.lower() == normalized:
                    return key, info
        # Fall through to default
        default_key = self.reciter_manifest.get("default", "alafasy")
        return default_key, reciters.get(default_key, {"name": default_key, "layout": "verse", "audio_dir": "quran_data", "audio_pattern": "{surah:03d}/{verse:03d}.mp3"})

    def _reciter_audio_dir(self):
        rel = self.reciter.get("audio_dir", "quran_data")
        return (self.repo_root / rel).resolve()

    def _reciter_audio_path(self, surah_number, verse_number=None):
        pattern = self.reciter.get("audio_pattern", "{surah:03d}/{verse:03d}.mp3")
        try:
            rel = pattern.format(surah=int(surah_number), verse=int(verse_number) if verse_number else 0)
        except (KeyError, ValueError):
            rel = pattern
        return (self._reciter_audio_dir() / rel).resolve()

    def _stdin_listener(self):
        """Listen for control commands from parent process stdin."""
        try:
            for line in sys.stdin:
                command = line.strip().upper()
                if not command:
                    continue
                if command == "PAUSE":
                    self.is_paused = True
                    self._update_playback_status(False)
                    if self.current_process and self.current_process.poll() is None and hasattr(signal, "SIGSTOP"):
                        os.kill(self.current_process.pid, signal.SIGSTOP)
                    print("Playback paused")
                elif command == "RESUME":
                    if self.current_process and self.current_process.poll() is None and hasattr(signal, "SIGCONT"):
                        os.kill(self.current_process.pid, signal.SIGCONT)
                    self.is_paused = False
                    self._update_playback_status(True)
                    print("Playback resumed")
                elif command in {"STOP", "QUIT", "EXIT"}:
                    self.is_stopped = True
                    if self.current_process and self.current_process.poll() is None:
                        self.current_process.terminate()
                    print("Playback stop command received")
                    break
        except Exception as e:
            print(f"Control listener error: {e}")

    def _load_surah_index(self):
        index_path = self.quran_data_dir / SURAH_INDEX_FILENAME
        if not index_path.exists():
            return {}

        try:
            payload = json.loads(index_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

        rows = payload if isinstance(payload, list) else payload.values() if isinstance(payload, dict) else []
        parsed = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            try:
                number = int(row.get("number"))
            except (TypeError, ValueError):
                continue
            if not 1 <= number <= 114:
                continue

            parsed[number] = {
                "number": number,
                "arabicName": row.get("arabicName") or row.get("name") or "",
                "englishName": row.get("englishName") or f"Surah {number}",
                "englishNameTranslation": row.get("englishNameTranslation") or "",
                "totalVerses": row.get("totalVerses") or row.get("numberOfAyahs") or 0,
                "revelationType": row.get("revelationType") or ""
            }
        return parsed

    def _signal_handler(self, signum, frame):
        print("\nReceived stop signal, cleaning up...")
        self.is_stopped = True
        self.is_paused = False
        if self.current_process:
            self.current_process.terminate()
        try:
            self._update_playback_status(False)
        except Exception:
            pass
        self._clear_display()
        sys.exit(0)

    def _send_to_mirror(self, endpoint, data):
        """Send data to MagicMirror API endpoint"""
        try:
            url = f"{self.mirror_url}/api/quran/{endpoint}"
            response = requests.post(url, json=data, timeout=5)
            if response.status_code == 200:
                print(f"  sent to {endpoint}")
                return True
            else:
                print(f"  mirror returned {response.status_code}: {response.text}")
                return False
        except requests.exceptions.RequestException as e:
            print(f"  error sending to mirror: {e}")
            return False

    def _update_verse_display(self, arabic, translation, surah, verse, surah_info, is_playing=True):
        """Update the verse display on MagicMirror"""
        data = {
            "arabic": arabic,
            "translation": translation,
            "surah": surah,
            "verse": verse,
            "surahInfo": surah_info,
            "isPlaying": is_playing
        }
        return self._send_to_mirror("verse", data)

    def _update_playback_status(self, is_playing):
        """Update playback status indicator"""
        return self._send_to_mirror("status", {"isPlaying": is_playing})

    def _send_playback_info(self, total_sec, offset_sec=0.0):
        """Tell the mirror: a new track is starting, its duration is N seconds.
        UI uses this to drive the progress arc and time readout. When the
        playback is seeking into the audio (resume after stop), pass
        offset_sec so the UI's elapsed counter starts at that offset
        instead of zero."""
        offset = float(offset_sec or 0.0)
        return self._send_to_mirror("playback-info", {
            "totalSec": float(total_sec or 0),
            "startedAt": int((time.time() - max(offset, 0.0)) * 1000),
        })

    def _probe_duration(self, audio_path):
        """Return audio duration in seconds via ffprobe, or 0 if unavailable."""
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(audio_path)],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                value = result.stdout.strip()
                if value:
                    return float(value)
        except Exception as e:
            print(f"  ffprobe duration probe failed for {audio_path}: {e}")
        return 0.0

    def _clear_display(self):
        """Clear the verse display"""
        return self._send_to_mirror("clear", {})

    def _get_surah_info(self, surah_number, total_verses):
        if surah_number in self.surah_info_cache:
            cached = self.surah_info_cache[surah_number].copy()
            if not cached.get("totalVerses"):
                cached["totalVerses"] = total_verses
            return cached

        surah_info = {
            "number": surah_number,
            "arabicName": "",
            "englishName": f"Surah {surah_number}",
            "englishNameTranslation": "",
            "totalVerses": total_verses,
            "revelationType": ""
        }

        local_info = self.surah_index.get(surah_number)
        if local_info:
            surah_info.update(local_info)
            if not surah_info.get("totalVerses"):
                surah_info["totalVerses"] = total_verses
            self.surah_info_cache[surah_number] = surah_info.copy()
            return surah_info

        if not self.allow_metadata_api:
            self.surah_info_cache[surah_number] = surah_info.copy()
            return surah_info

        try:
            info_url = f"https://api.alquran.cloud/v1/surah/{surah_number}"
            response = requests.get(info_url, timeout=6)
            if response.status_code == 200:
                payload = response.json().get("data", {})
                surah_info.update({
                    "number": payload.get("number", surah_number),
                    "arabicName": payload.get("name", surah_info["arabicName"]),
                    "englishName": payload.get("englishName", surah_info["englishName"]),
                    "englishNameTranslation": payload.get("englishNameTranslation", ""),
                    "totalVerses": payload.get("numberOfAyahs", total_verses),
                    "revelationType": payload.get("revelationType", "")
                })
        except requests.exceptions.RequestException:
            pass

        self.surah_info_cache[surah_number] = surah_info.copy()
        return surah_info

    def _load_local_surah(self, surah_number):
        surah_dir = self.quran_data_dir / f"{surah_number:03}"
        if not surah_dir.exists():
            return None

        verses = []
        for json_path in sorted(surah_dir.glob("*.json")):
            try:
                payload = json.loads(json_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue

            verse_key = str(payload.get("verse_key", ""))
            try:
                verse_num = int(verse_key.split(":")[-1]) if ":" in verse_key else int(json_path.stem)
            except ValueError:
                continue

            ayah_number = payload.get("ayah_number")
            if isinstance(ayah_number, str) and ayah_number.isdigit():
                ayah_number = int(ayah_number)

            # Resolve audio path via the active reciter (per-verse only).
            # For per-surah reciters (layout=="surah"), play_surah() short-
            # circuits to a single-file playback below, so this branch is
            # only used when layout=="verse".
            if self.reciter.get("layout", "verse") == "verse":
                audio_path = self._reciter_audio_path(surah_number, verse_num)
            else:
                audio_path = surah_dir / f"{verse_num:03}.mp3"
            local_audio = str(audio_path) if audio_path.exists() else None

            verses.append({
                "number": verse_num,
                "ayah_number": ayah_number,
                "arabic": payload.get("text_uthmani") or payload.get("text") or "",
                "translation": payload.get("translation_en") or payload.get("translation") or "",
                "audio": local_audio or payload.get("audio_url")
            })

        if not verses:
            return None

        verses.sort(key=lambda verse: verse["number"])
        surah_info = self._get_surah_info(surah_number, len(verses))
        print(f"Loaded Surah {surah_number} from local quran_data ({len(verses)} verses)")
        return {"surah_info": surah_info, "verses": verses}

    def _fetch_surah_from_api(self, surah_number):
        print(f"Fetching Surah {surah_number} from API...")
        arabic_url = f"https://api.alquran.cloud/v1/surah/{surah_number}/ar.alafasy"
        english_url = f"https://api.alquran.cloud/v1/surah/{surah_number}/en.asad"

        try:
            arabic_response = requests.get(arabic_url, timeout=30)
            english_response = requests.get(english_url, timeout=30)

            if arabic_response.status_code != 200 or english_response.status_code != 200:
                print(f"API Error: Arabic={arabic_response.status_code}, English={english_response.status_code}")
                return None

            arabic_data = arabic_response.json()["data"]
            english_data = english_response.json()["data"]

            verses = []
            for ar_ayah, en_ayah in zip(arabic_data["ayahs"], english_data["ayahs"]):
                verses.append({
                    "number": ar_ayah["numberInSurah"],
                    "ayah_number": ar_ayah["number"],
                    "arabic": ar_ayah["text"],
                    "translation": en_ayah["text"],
                    "audio": ar_ayah.get("audio", ar_ayah.get("audioSecondary", [None])[0] if ar_ayah.get("audioSecondary") else None)
                })

            surah_info = {
                "number": arabic_data["number"],
                "arabicName": arabic_data["name"],
                "englishName": arabic_data["englishName"],
                "englishNameTranslation": arabic_data["englishNameTranslation"],
                "totalVerses": arabic_data["numberOfAyahs"],
                "revelationType": arabic_data["revelationType"]
            }

            self.surah_info_cache[surah_number] = surah_info.copy()
            return {"surah_info": surah_info, "verses": verses}

        except requests.exceptions.RequestException as e:
            print(f"Error fetching surah: {e}")
            return None

    def fetch_surah(self, surah_number):
        """Load surah from local quran_data first, then fall back to API."""
        local_data = self._load_local_surah(surah_number)
        if local_data:
            return local_data
        return self._fetch_surah_from_api(surah_number)

    def _prepare_pulse_sink(self, mpv_ao, mpv_audio_device):
        """Best-effort sink pin/unmute before mpv starts. Returns True if requested sink is ready."""
        if mpv_ao != "pulse" and not mpv_audio_device.startswith("pulse/"):
            return True
        if not shutil.which("pactl"):
            return False

        sink_name = os.environ.get("QURAN_PULSE_SINK", "").strip()
        pulse_card = os.environ.get("QURAN_PULSE_CARD", "").strip()
        pulse_card_profile = os.environ.get("QURAN_PULSE_CARD_PROFILE", "").strip()
        if not sink_name and mpv_audio_device.startswith("pulse/"):
            sink_name = mpv_audio_device.split("/", 1)[1].strip()
        if not sink_name:
            return True

        sink_volume = os.environ.get("QURAN_PULSE_SINK_VOLUME", "50%").strip() or "50%"
        enforce_sink_volume = str(os.environ.get("QURAN_PULSE_ENFORCE_SINK_VOLUME", "0")).strip().lower() in {
            "1",
            "true",
            "yes",
            "on"
        }
        wait_raw = os.environ.get("QURAN_PULSE_SINK_WAIT_SEC", "8").strip()
        try:
            wait_sec = max(0, min(60, int(wait_raw)))
        except ValueError:
            wait_sec = 8
        try:
            if pulse_card and pulse_card_profile:
                subprocess.run(["pactl", "set-card-profile", pulse_card, pulse_card_profile], check=False, timeout=3)

            for attempt in range(wait_sec + 1):
                sinks_out = subprocess.run(
                    ["pactl", "list", "sinks", "short"],
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=3
                )
                sink_names = []
                for row in sinks_out.stdout.splitlines():
                    parts = row.split()
                    if len(parts) >= 2:
                        sink_names.append(parts[1])

                if sink_name in sink_names:
                    subprocess.run(["pactl", "set-default-sink", sink_name], check=False, timeout=3)
                    subprocess.run(["pactl", "set-sink-mute", sink_name, "0"], check=False, timeout=3)
                    if enforce_sink_volume:
                        subprocess.run(["pactl", "set-sink-volume", sink_name, sink_volume], check=False, timeout=3)
                        print(f"  pulse sink ensured: {sink_name} volume={sink_volume} (enforced)")
                    else:
                        print(f"  pulse sink ensured: {sink_name} volume=preserved")
                    return True

                if attempt < wait_sec:
                    time.sleep(1)

            print(f"  WARNING: pulse sink unavailable after {wait_sec}s: {sink_name}")
            return False
        except Exception as e:
            print(f"  WARNING: failed to prepare pulse sink: {e}")
            return False

    def _env_flag(self, key, default=False):
        raw = os.environ.get(key)
        if raw is None:
            return bool(default)
        return str(raw).strip().lower() in {"1", "true", "yes", "on"}

    def _parse_sample_rate(self, raw_value):
        try:
            value = int(str(raw_value).strip())
        except (TypeError, ValueError):
            return None
        if value < 8000 or value > 192000:
            return None
        return value

    def _build_stable_audio_defaults(self, mpv_extra_args):
        """
        Build conservative mpv defaults for consistent loudness/pitch:
        - force speed=1.0 with pitch correction
        - lock output samplerate (default 48k for BT sinks)
        - apply dynamic loudness normalization
        """
        has_speed = any(arg == "--speed" or arg.startswith("--speed=") for arg in mpv_extra_args)
        has_pitch = any(
            arg == "--audio-pitch-correction" or arg.startswith("--audio-pitch-correction=")
            for arg in mpv_extra_args
        )
        has_samplerate = any(
            arg == "--audio-samplerate" or arg.startswith("--audio-samplerate=")
            for arg in mpv_extra_args
        )
        has_af = any(arg == "--af" or arg.startswith("--af=") for arg in mpv_extra_args)

        stable_args = []
        if not has_speed:
            stable_args.append("--speed=1.0")
        if not has_pitch:
            stable_args.append("--audio-pitch-correction=yes")

        sample_rate = self._parse_sample_rate(os.environ.get("QURAN_MPV_SAMPLE_RATE", "48000"))
        if sample_rate and not has_samplerate:
            stable_args.append(f"--audio-samplerate={sample_rate}")

        if not has_af and self._env_flag("QURAN_MPV_ENABLE_DYNAUDNORM", True):
            # Conservative dynamic normalization to reduce jumpy verse levels.
            # Keep params configurable if needed.
            norm_params = os.environ.get("QURAN_MPV_DYNAUDNORM_PARAMS", "f=150:g=7:p=0.9:m=10").strip()
            filters = []
            if norm_params:
                filters.append(f"dynaudnorm={norm_params}")
            else:
                filters.append("dynaudnorm")
            if sample_rate:
                filters.append(f"aresample={sample_rate}")
            stable_args.append(f"--af=lavfi=[{','.join(filters)}]")

        return stable_args

    def play_audio(self, audio_url, start_sec=0.0):
        """Play audio using mpv and wait for completion. Optional start_sec
        seeks mpv to that point at launch (used to resume after stop)."""
        if not audio_url:
            print("No audio URL provided")
            time.sleep(3)  # Fallback delay for display viewing
            return False

        try:
            # Use mpv for playback; allow explicit audio backend/device overrides.
            mpv_cmd = ["mpv", "--no-video", "--really-quiet"]
            if start_sec and start_sec > 0.1:
                mpv_cmd.append(f"--start={start_sec:.2f}")
            mpv_ao = os.environ.get("QURAN_MPV_AO", "").strip()
            mpv_audio_device = os.environ.get("QURAN_MPV_AUDIO_DEVICE", "").strip()
            mpv_extra = os.environ.get("QURAN_MPV_EXTRA_ARGS", "").strip()
            mpv_extra_args = shlex.split(mpv_extra) if mpv_extra else []
            mpv_volume_raw = os.environ.get("QURAN_MPV_VOLUME", "100").strip()
            try:
                mpv_volume = float(mpv_volume_raw)
            except ValueError:
                mpv_volume = 100.0

            sink_ready = self._prepare_pulse_sink(mpv_ao, mpv_audio_device)
            if (
                mpv_audio_device.startswith("pulse/")
                and not sink_ready
                and self._env_flag("QURAN_MPV_FALLBACK_TO_DEFAULT_SINK", True)
            ):
                print("  desired pulse sink unavailable; using current default sink for this verse")
                mpv_audio_device = ""

            if mpv_ao:
                mpv_cmd.append(f"--ao={mpv_ao}")
            if mpv_audio_device:
                mpv_cmd.append(f"--audio-device={mpv_audio_device}")
            mpv_cmd.append("--mute=no")
            mpv_cmd.append(f"--volume={mpv_volume:g}")
            if self._env_flag("QURAN_MPV_STABLE_AUDIO", True):
                mpv_cmd.extend(self._build_stable_audio_defaults(mpv_extra_args))
            if mpv_extra_args:
                mpv_cmd.extend(mpv_extra_args)

            mpv_cmd.append(audio_url)
            print(f"  mpv playback command: {' '.join(mpv_cmd)}")

            self.current_process = subprocess.Popen(
                mpv_cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True
            )

            # Wait for playback to complete
            while self.current_process.poll() is None:
                if self.is_stopped:
                    self.current_process.terminate()
                    return False

                # Check for pause (from stdin)
                while self.is_paused and not self.is_stopped:
                    time.sleep(0.1)

                time.sleep(0.1)

            return_code = self.current_process.returncode
            stderr_text = ""
            if self.current_process.stderr:
                try:
                    stderr_text = self.current_process.stderr.read().strip()
                except Exception:
                    stderr_text = ""

            self.current_process = None
            print(f"  mpv exited with code {return_code}")
            if return_code != 0:
                if stderr_text:
                    print(f"mpv exited with code {return_code}: {stderr_text}")
                else:
                    print(f"mpv exited with code {return_code}")
                return False
            return True

        except FileNotFoundError:
            print("mpv not installed - using 3s delay for testing")
            time.sleep(3)  # Fallback delay when mpv not available
            return False
        except Exception as e:
            print(f"Error playing audio: {e}")
            time.sleep(3)  # Fallback delay
            return False

    def play_surah(self, surah_number, start_verse=1):
        """Play an entire surah. Verse-by-verse for verse-layout reciters,
        single-file for surah-layout reciters."""
        data = self.fetch_surah(surah_number)

        if not data:
            print("Failed to fetch surah data")
            return False

        surah_info = data["surah_info"]
        verses = data["verses"]

        print(f"\n▶ Playing: {surah_info['arabicName']} - {surah_info['englishName']}")
        print(f"  {surah_info['englishNameTranslation']}")
        print(f"  Total verses: {surah_info['totalVerses']}")
        print(f"  Reciter: {self.reciter.get('name', self.reciter_key)}")
        print(f"  Starting from verse: {start_verse}\n")

        # For per-surah reciters, skip verse iteration and play the whole file.
        if self.reciter.get("layout") == "surah":
            return self._play_whole_surah(surah_number, surah_info, verses, start_verse)

        # Per-verse layout: probe each verse to build a cumulative timeline.
        # This both gives us total duration (for the UI arc) and lets us
        # translate a resume position to (start_verse, within-verse offset).
        verse_durations = []
        cumulative = 0.0
        for v in verses:
            if v["number"] < start_verse:
                verse_durations.append((v["number"], 0.0, 0.0))
                continue
            local_audio = v.get("audio")
            dur = self._probe_duration(local_audio) if (local_audio and os.path.exists(local_audio)) else 0.0
            verse_durations.append((v["number"], dur, cumulative))
            cumulative += dur
        total_duration = cumulative

        # Apply start_position_sec by translating into start_verse + offset
        offset = float(getattr(self, "start_position_sec", 0.0) or 0.0)
        self._verse_first_offset_sec = 0.0
        if offset > 0.5:
            target_verse = start_verse
            for vnum, dur, cum_start in verse_durations:
                if vnum < start_verse:
                    continue
                cum_end = cum_start + dur
                if cum_start <= offset < cum_end:
                    target_verse = vnum
                    self._verse_first_offset_sec = max(0.0, offset - cum_start)
                    break
                target_verse = vnum  # ride along if past the end
            if target_verse != start_verse:
                print(f"  Resuming at verse {target_verse} (offset {self._verse_first_offset_sec:.1f}s in)")
                start_verse = target_verse
        # Reset so it doesn't accidentally re-apply later.
        self.start_position_sec = 0.0

        # offset passes through so UI arc starts at offset/total, not at 0.
        self._send_playback_info(total_duration, offset_sec=offset)

        # Filter verses based on start_verse
        verses_to_play = [v for v in verses if v["number"] >= start_verse]

        for verse in verses_to_play:
            if self.is_stopped:
                break

            verse_num = verse["number"]
            print(f"  [{verse_num}/{surah_info['totalVerses']}] Playing verse...")

            # Update display
            self._update_verse_display(
                arabic=verse["arabic"],
                translation=verse["translation"],
                surah=surah_number,
                verse=verse_num,
                surah_info={
                    "arabicName": surah_info["arabicName"],
                    "englishName": surah_info["englishName"],
                    "totalVerses": surah_info["totalVerses"],
                    "reciter": self.reciter.get("name", self.reciter_key),
                },
                is_playing=True
            )

            # First verse of a resumed playback may need an in-verse seek.
            first_verse_offset = getattr(self, "_verse_first_offset_sec", 0.0) or 0.0
            self._verse_first_offset_sec = 0.0  # only applies to this first verse

            # Play audio
            if verse.get("audio"):
                self.play_audio(verse["audio"], start_sec=first_verse_offset)
            elif verse.get("ayah_number"):
                # Fallback requires global ayah index, not numberInSurah.
                audio_url = f"https://cdn.islamic.network/quran/audio/128/ar.alafasy/{verse['ayah_number']}.mp3"
                self.play_audio(audio_url, start_sec=first_verse_offset)
            else:
                print(f"  No audio source for verse {verse_num}; skipping playback for this verse.")

            # Brief pause between verses
            if not self.is_stopped:
                time.sleep(0.5)

        # Finished
        self._update_playback_status(False)
        print("\n✓ Playback complete")
        return True

    def _play_whole_surah(self, surah_number, surah_info, verses, start_verse=1):
        """Play a single MP3 representing the whole surah (per-surah reciter layout)."""
        audio_path = self._reciter_audio_path(surah_number)
        if not audio_path.exists():
            print(f"  No audio file at {audio_path} — falling back to per-verse if available")
            # Fall back: try to use the default reciter's verse-by-verse path
            fallback_key = self.reciter_manifest.get("default", "alafasy")
            fallback_info = self.reciter_manifest.get("reciters", {}).get(fallback_key)
            if fallback_info and fallback_key != self.reciter_key:
                self.reciter_key = fallback_key
                self.reciter = fallback_info
                return self.play_surah(surah_number, start_verse)
            print("  No fallback available; aborting.")
            return False

        # Show a 'whole surah' display: arabic surah name + reciter name on the wall,
        # without per-verse highlighting (we don't have segment timestamps).
        first_verse = next((v for v in verses if v["number"] >= start_verse), verses[0] if verses else None)
        if first_verse:
            self._update_verse_display(
                arabic=first_verse["arabic"],
                translation=first_verse["translation"],
                surah=surah_number,
                verse=first_verse["number"],
                surah_info={
                    "arabicName": surah_info["arabicName"],
                    "englishName": surah_info["englishName"],
                    "totalVerses": surah_info["totalVerses"],
                    "reciter": self.reciter.get("name", self.reciter_key),
                },
                is_playing=True,
            )

        # Probe duration so the UI progress arc fills correctly.
        duration_sec = self._probe_duration(audio_path)
        self._send_playback_info(duration_sec)
        # Resume offset (set by --start-position-sec).
        offset = float(getattr(self, "start_position_sec", 0.0) or 0.0)
        offset = max(0.0, min(offset, max(duration_sec - 1.0, 0.0)))
        # Re-send playback info now that we know the offset, so the UI arc
        # starts at offset / total instead of resetting to 0.
        if offset > 0.5:
            self._send_playback_info(duration_sec, offset_sec=offset)
        print(f"  [Whole-surah] Playing {audio_path.name} "
              f"({self.reciter.get('name', self.reciter_key)}) "
              f"duration={duration_sec:.0f}s start={offset:.1f}s ...")
        # Once we've used it, clear so subsequent calls don't re-seek.
        self.start_position_sec = 0.0
        self.play_audio(str(audio_path), start_sec=offset)

        self._update_playback_status(False)
        print("\n✓ Playback complete")
        return True


def parse_surah_input(surah_input):
    """Parse surah input - can be number or name"""
    if isinstance(surah_input, int):
        return surah_input

    # Try as number
    try:
        return int(surah_input)
    except ValueError:
        pass

    # Try as name
    name = surah_input.lower().strip()
    for surah_name, num in SURAH_NAMES.items():
        if name in surah_name or surah_name in name:
            return num

    return None


def main():
    parser = argparse.ArgumentParser(description="Quran Verse Chainer for MagicMirror")
    parser.add_argument("--surah", "-s", required=True, help="Surah number or name (e.g., 1 or fatiha)")
    parser.add_argument("--start-verse", "-v", type=int, default=1, help="Starting verse number")
    parser.add_argument("--mirror-url", "-m", default="http://localhost:8080", help="MagicMirror URL")
    parser.add_argument("--reciter", "-r", default=None, help="Reciter key or alias (overrides reciters.json current). E.g. 'alafasy' or 'noreen-sedeeq'")
    parser.add_argument("--start-position-sec", type=float, default=0.0,
                        help="Seek this many seconds into playback before starting (used to resume after stop).")

    args = parser.parse_args()

    surah_number = parse_surah_input(args.surah)
    if not surah_number or surah_number < 1 or surah_number > 114:
        print(f"Invalid surah: {args.surah}")
        print("Valid range: 1-114 or surah name (e.g., fatiha, baqara, yasin)")
        sys.exit(1)

    chainer = QuranChainer(mirror_url=args.mirror_url, reciter=args.reciter)
    chainer.start_position_sec = float(getattr(args, "start_position_sec", 0.0) or 0.0)
    chainer.play_surah(surah_number, args.start_verse)


if __name__ == "__main__":
    main()
