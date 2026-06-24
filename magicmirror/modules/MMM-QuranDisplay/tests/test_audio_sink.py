#!/usr/bin/env python3
"""Dry-run unit tests for the hardware-agnostic sink resolver.

Feeds sample `pactl list short sinks` output and asserts the correct sink is
chosen for each preference tier. Runs with no audio hardware, no network, and
no external test framework.

    python3 tests/test_audio_sink.py
"""

import sys
from pathlib import Path

# Import the module under test from the parent module directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from audio_sink import parse_short_sinks, choose_sink, is_auto  # noqa: E402

# Realistic `pactl list short sinks` fixtures (tab/space separated columns).
SINKS_BT_HDMI_ANALOG = """\
48\talsa_output.platform-fef00700.hdmi.hdmi-stereo\tPipeWire\ts16le 2ch 48000Hz\tIDLE
49\talsa_output.platform-bcm2835_audio.analog-stereo\tPipeWire\ts16le 2ch 44100Hz\tIDLE
50\tbluez_output.FC_A8_9A_F6_FB_DA.1\tPipeWire\ts16le 2ch 48000Hz\tRUNNING
"""

SINKS_HDMI_ANALOG = """\
48\talsa_output.platform-fef00700.hdmi.hdmi-stereo\tPipeWire\ts16le 2ch 48000Hz\tIDLE
49\talsa_output.platform-bcm2835_audio.analog-stereo\tPipeWire\ts16le 2ch 44100Hz\tIDLE
"""

SINKS_ANALOG_ONLY = """\
49\talsa_output.platform-bcm2835_audio.analog-stereo\tPipeWire\ts16le 2ch 44100Hz\tIDLE
"""

SINKS_GENERIC_ONLY = """\
12\talsa_output.usb-Generic_USB_Audio-00.pro-output-0\tPipeWire\ts16le 2ch 48000Hz\tIDLE
"""

SINKS_EMPTY = ""


CASES = []


def case(name, fn):
    CASES.append((name, fn))


def expect(actual, expected, ctx):
    if actual != expected:
        raise AssertionError(f"{ctx}: expected {expected!r}, got {actual!r}")


# --- parse ---------------------------------------------------------------
def t_parse_names():
    names = parse_short_sinks(SINKS_BT_HDMI_ANALOG)
    expect(len(names), 3, "parse count")
    expect(names[2], "bluez_output.FC_A8_9A_F6_FB_DA.1", "parse bt name")
    expect(parse_short_sinks(SINKS_EMPTY), [], "parse empty")


case("parse short sinks", t_parse_names)


# --- tier ordering -------------------------------------------------------
def t_prefers_bluetooth():
    names = parse_short_sinks(SINKS_BT_HDMI_ANALOG)
    expect(choose_sink(names), "bluez_output.FC_A8_9A_F6_FB_DA.1", "auto -> bluetooth")


case("auto picks bluetooth when present", t_prefers_bluetooth)


def t_falls_back_to_hdmi():
    names = parse_short_sinks(SINKS_HDMI_ANALOG)
    expect(
        choose_sink(names),
        "alsa_output.platform-fef00700.hdmi.hdmi-stereo",
        "no bt -> hdmi",
    )


case("no bluetooth falls back to hdmi", t_falls_back_to_hdmi)


def t_falls_back_to_analog():
    names = parse_short_sinks(SINKS_ANALOG_ONLY)
    expect(
        choose_sink(names),
        "alsa_output.platform-bcm2835_audio.analog-stereo",
        "analog only -> analog",
    )


case("only analog falls back to analog/3.5mm", t_falls_back_to_analog)


def t_default_sink_tier():
    names = parse_short_sinks(SINKS_GENERIC_ONLY)
    target = "alsa_output.usb-Generic_USB_Audio-00.pro-output-0"
    # No bt/hdmi/analog match -> default sink (if listed) wins over arbitrary first.
    expect(choose_sink(names, default_sink=target), target, "generic -> default sink")


case("generic sink uses system default tier", t_default_sink_tier)


def t_first_available_last_resort():
    names = parse_short_sinks(SINKS_GENERIC_ONLY)
    # No bt/hdmi/analog and no usable default -> first available.
    expect(
        choose_sink(names, default_sink="nonexistent"),
        "alsa_output.usb-Generic_USB_Audio-00.pro-output-0",
        "no default -> first",
    )


case("first available is the last resort", t_first_available_last_resort)


# --- explicit override ---------------------------------------------------
def t_override_present_wins():
    names = parse_short_sinks(SINKS_BT_HDMI_ANALOG)
    override = "alsa_output.platform-fef00700.hdmi.hdmi-stereo"
    # Override beats bluetooth when the override sink is actually present.
    expect(choose_sink(names, override=override), override, "override present wins")


case("explicit override (present) wins over bluetooth", t_override_present_wins)


def t_override_absent_falls_through():
    names = parse_short_sinks(SINKS_HDMI_ANALOG)
    # Override points at a now-disconnected Bluetooth sink -> fall through to hdmi.
    expect(
        choose_sink(names, override="bluez_output.DEAD_BEEF.1"),
        "alsa_output.platform-fef00700.hdmi.hdmi-stereo",
        "override absent -> tier fallthrough",
    )


case("override not in live list falls through tiers", t_override_absent_falls_through)


def t_auto_sentinels():
    names = parse_short_sinks(SINKS_HDMI_ANALOG)
    for sentinel in ("auto", "", "default", "AUTO", "  Auto  "):
        expect(is_auto(sentinel), True, f"is_auto({sentinel!r})")
        # 'auto' must never be treated as a literal sink name.
        expect(
            choose_sink(names, override=sentinel),
            "alsa_output.platform-fef00700.hdmi.hdmi-stereo",
            f"auto sentinel {sentinel!r} -> tier pick",
        )
    expect(is_auto("bluez_output.X.1"), False, "is_auto real name")


case("auto/empty sentinels trigger detection", t_auto_sentinels)


def t_empty_sinks():
    expect(choose_sink([], override="anything"), "", "no sinks -> empty")


case("no sinks returns empty string", t_empty_sinks)


def main():
    failed = 0
    for name, fn in CASES:
        try:
            fn()
            print(f"PASS  {name}")
        except AssertionError as exc:
            failed += 1
            print(f"FAIL  {name}: {exc}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"ERROR {name}: {exc!r}")
    total = len(CASES)
    print(f"\n{total - failed}/{total} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
