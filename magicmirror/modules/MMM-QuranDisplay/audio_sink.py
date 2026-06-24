#!/usr/bin/env python3
"""
Hardware-agnostic PulseAudio/PipeWire sink resolver.

The goal is to make audio output device selection work on *any* Pi/hardware
instead of hardcoding a specific Bluetooth sink MAC. This module parses the
output of `pactl list short sinks` (and, optionally, the default-sink name)
and picks the best available sink using a fixed preference order:

    1. explicit override   - a configured sink name, if present in the live list
    2. bluetooth           - any ``bluez_output.*`` sink
    3. hdmi                - any sink whose name mentions "hdmi"
    4. analog / 3.5mm      - any sink whose name mentions "analog"
    5. system default sink - whatever pactl reports as the default
    6. first available     - last resort

The parsing logic is intentionally pure (no subprocess) so it can be unit
tested with sample ``pactl`` output. ``resolve_sink()`` is the thin wrapper
that actually shells out to ``pactl`` on the device.

This is the canonical implementation; the Node helper
(``MMM-MyPrayerTimes/node_helper.js``) mirrors the same tier order in JS.
"""

import re
import shutil
import subprocess

# Sentinel values that mean "no explicit override; auto-detect".
AUTO_VALUES = {"", "auto", "default"}


def parse_short_sinks(pactl_short_sinks_output):
    """Parse ``pactl list short sinks`` output into a list of sink names.

    Each line looks like:
        ``50\tbluez_output.FC_A8_9A_F6_FB_DA.1\tmodule-...\ts16le 2ch 48000Hz\tRUNNING``
    The sink name is the second whitespace-delimited column.
    """
    names = []
    for row in str(pactl_short_sinks_output or "").splitlines():
        parts = row.split()
        if len(parts) >= 2:
            names.append(parts[1])
    return names


def is_auto(override):
    """True when the override means 'auto-detect' (empty/auto/default)."""
    return str(override or "").strip().lower() in AUTO_VALUES


def choose_sink(sink_names, override="", default_sink=""):
    """Pick the best sink name from ``sink_names`` using the tier order.

    Args:
        sink_names: list of available sink names (from ``parse_short_sinks``).
        override: a configured sink name. Honored only if present in
            ``sink_names`` and not an "auto" sentinel.
        default_sink: the system default sink name (tier 5), if known.

    Returns:
        The chosen sink name, or "" when no sinks exist.
    """
    names = [str(n) for n in (sink_names or []) if str(n).strip()]
    if not names:
        return ""

    # Tier 1: explicit override, only if it actually exists right now.
    override = str(override or "").strip()
    if override and not is_auto(override) and override in names:
        return override

    # Tier 2: Bluetooth output.
    for name in names:
        if re.match(r"^bluez_output\.", name):
            return name

    # Tier 3: HDMI.
    for name in names:
        if "hdmi" in name.lower():
            return name

    # Tier 4: analog / 3.5mm headphone jack.
    for name in names:
        if "analog" in name.lower():
            return name

    # Tier 5: system default sink, if it is in the list.
    default_sink = str(default_sink or "").strip()
    if default_sink and default_sink in names:
        return default_sink

    # Tier 6: first available.
    return names[0]


def _run_pactl(args, timeout=3):
    """Run pactl and return stripped stdout, or "" on any failure."""
    try:
        out = subprocess.run(
            ["pactl"] + list(args),
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return out.stdout or ""
    except Exception:
        return ""


def query_default_sink():
    """Return the system default sink name, tolerating old/new pactl.

    Modern pactl: ``pactl get-default-sink`` prints the name.
    Older pactl: parse ``pactl info`` for the ``Default Sink:`` line.
    """
    name = _run_pactl(["get-default-sink"]).strip()
    if name and not name.lower().startswith("failure") and " " not in name:
        return name

    info = _run_pactl(["info"])
    for line in info.splitlines():
        if line.lower().startswith("default sink:"):
            return line.split(":", 1)[1].strip()
    return ""


def resolve_sink(override="", *, require_pactl=True):
    """Resolve the best available sink on this machine.

    Returns "" if pactl is unavailable (and ``require_pactl`` is True) or no
    sinks are present, so callers can fall back to their own defaults.
    """
    if require_pactl and not shutil.which("pactl"):
        return ""
    sink_names = parse_short_sinks(_run_pactl(["list", "short", "sinks"]))
    if not sink_names:
        return ""
    return choose_sink(sink_names, override=override, default_sink=query_default_sink())


if __name__ == "__main__":
    import sys

    requested = sys.argv[1] if len(sys.argv) > 1 else ""
    chosen = resolve_sink(requested)
    if chosen:
        print(chosen)
        sys.exit(0)
    sys.exit(1)
