#!/usr/bin/env python3
"""
Sync local adhkar audio assets for MMM-MyPrayerTimes.

This script reads adhkar_manifest.json and ensures every track URL that points to
`modules/MMM-MyPrayerTimes/...` exists on disk. Missing files are downloaded from
`sourceUrl` (or a remote `url` value if present).
"""

import argparse
import json
import shutil
import sys
import urllib.request
from pathlib import Path

MODULE_PREFIX = "modules/MMM-MyPrayerTimes/"
HTTP_PREFIXES = ("http://", "https://")


def parse_args() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description="Download/verify local adhkar audio assets.")
	parser.add_argument(
		"--manifest",
		default="adhkar_manifest.json",
		help="Manifest filename relative to MMM-MyPrayerTimes module directory."
	)
	parser.add_argument(
		"--verify-only",
		action="store_true",
		help="Only verify local files; do not download missing files."
	)
	parser.add_argument(
		"--force",
		action="store_true",
		help="Redownload files even when they already exist."
	)
	parser.add_argument(
		"--timeout",
		type=int,
		default=45,
		help="HTTP timeout in seconds (default: 45)."
	)
	return parser.parse_args()


def resolve_local_path(module_dir: Path, url_value: str) -> Path | None:
	url = str(url_value or "").strip()
	if not url:
		return None
	if url.startswith(MODULE_PREFIX):
		return module_dir / url[len(MODULE_PREFIX) :]
	if url.startswith("adhkar/"):
		return module_dir / url
	return None


def resolve_source_url(track: dict) -> str | None:
	source_url = str(track.get("sourceUrl") or "").strip()
	if source_url.lower().startswith(HTTP_PREFIXES):
		return source_url

	url_value = str(track.get("url") or "").strip()
	if url_value.lower().startswith(HTTP_PREFIXES):
		return url_value

	return None


def download_file(url: str, target: Path, timeout: int) -> None:
	req = urllib.request.Request(
		url,
		headers={
			"User-Agent": "MM-Pi5-AdhkarSync/1.0"
		}
	)
	target.parent.mkdir(parents=True, exist_ok=True)
	with urllib.request.urlopen(req, timeout=timeout) as response, target.open("wb") as out_file:
		shutil.copyfileobj(response, out_file)


def main() -> int:
	args = parse_args()
	module_dir = Path(__file__).resolve().parent
	manifest_path = (module_dir / args.manifest).resolve()

	if not manifest_path.exists():
		print(f"ERROR: manifest not found: {manifest_path}")
		return 1

	try:
		manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
	except (OSError, json.JSONDecodeError) as exc:
		print(f"ERROR: failed to read manifest: {exc}")
		return 1

	downloaded = 0
	skipped = 0
	missing = 0
	failures = 0

	for period in ("morning", "evening"):
		tracks = manifest.get(period, [])
		if not isinstance(tracks, list):
			continue

		for idx, track in enumerate(tracks, start=1):
			if not isinstance(track, dict):
				print(f"[{period} #{idx}] INVALID track entry")
				failures += 1
				continue

			title = str(track.get("title") or f"{period.title()} Adhkar {idx}")
			local_path = resolve_local_path(module_dir, str(track.get("url") or ""))
			if local_path is None:
				print(f"[{period} #{idx}] SKIP no local URL mapping for: {title}")
				skipped += 1
				continue

			exists = local_path.exists() and local_path.stat().st_size > 0
			if exists and not args.force:
				print(f"[{period} #{idx}] OK {local_path.relative_to(module_dir)}")
				skipped += 1
				continue

			source_url = resolve_source_url(track)
			if args.verify_only:
				if exists:
					print(f"[{period} #{idx}] OK {local_path.relative_to(module_dir)}")
					skipped += 1
				else:
					print(f"[{period} #{idx}] MISSING {local_path.relative_to(module_dir)}")
					missing += 1
				continue

			if not source_url:
				print(f"[{period} #{idx}] ERROR no source URL for missing file: {title}")
				failures += 1
				continue

			try:
				print(f"[{period} #{idx}] DOWNLOAD {title}")
				download_file(source_url, local_path, timeout=args.timeout)
				size_kb = round(local_path.stat().st_size / 1024, 1)
				print(f"[{period} #{idx}] SAVED {local_path.relative_to(module_dir)} ({size_kb} KB)")
				downloaded += 1
			except Exception as exc:  # noqa: BLE001
				print(f"[{period} #{idx}] ERROR download failed: {exc}")
				failures += 1

	print("")
	print(f"Summary: downloaded={downloaded} skipped={skipped} missing={missing} failures={failures}")

	if failures > 0:
		return 1
	if args.verify_only and missing > 0:
		return 2
	return 0


if __name__ == "__main__":
	sys.exit(main())
