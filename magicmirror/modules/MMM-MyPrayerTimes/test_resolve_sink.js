/*
 * Dry-run unit test for the hardware-agnostic sink resolver in node_helper.js.
 *
 * Loads the REAL node_helper.js (stubbing MagicMirror's `node_helper` module so
 * it can be required outside a running mirror), then exercises the pure
 * resolveSinkName()/isAutoSink() methods with sample `pactl list short sinks`
 * output. Mirrors tests/test_audio_sink.py so both language implementations
 * agree on the tier order.
 *
 *   node test_resolve_sink.js
 */
"use strict";

const Module = require("module");

// Stub MagicMirror's "node_helper" so `NodeHelper.create({...})` just returns
// the methods object we can instantiate and test directly.
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
	if (request === "node_helper") {
		return {
			create(def) {
				return def;
			}
		};
	}
	return originalLoad.apply(this, arguments);
};

const helperDef = require("./node_helper.js");
Module._load = originalLoad;

// Build a minimal instance exposing the pure resolver methods.
const helper = Object.create(helperDef);

const SINKS_BT_HDMI_ANALOG = [
	"48\talsa_output.platform-fef00700.hdmi.hdmi-stereo\tPipeWire\ts16le 2ch 48000Hz\tIDLE",
	"49\talsa_output.platform-bcm2835_audio.analog-stereo\tPipeWire\ts16le 2ch 44100Hz\tIDLE",
	"50\tbluez_output.FC_A8_9A_F6_FB_DA.1\tPipeWire\ts16le 2ch 48000Hz\tRUNNING"
].join("\n");

const SINKS_HDMI_ANALOG = ["48\talsa_output.platform-fef00700.hdmi.hdmi-stereo\tPipeWire\ts16le 2ch 48000Hz\tIDLE", "49\talsa_output.platform-bcm2835_audio.analog-stereo\tPipeWire\ts16le 2ch 44100Hz\tIDLE"].join("\n");

const SINKS_ANALOG_ONLY = "49\talsa_output.platform-bcm2835_audio.analog-stereo\tPipeWire\ts16le 2ch 44100Hz\tIDLE";
const SINKS_GENERIC_ONLY = "12\talsa_output.usb-Generic_USB_Audio-00.pro-output-0\tPipeWire\ts16le 2ch 48000Hz\tIDLE";

const HDMI = "alsa_output.platform-fef00700.hdmi.hdmi-stereo";
const ANALOG = "alsa_output.platform-bcm2835_audio.analog-stereo";
const BT = "bluez_output.FC_A8_9A_F6_FB_DA.1";
const GENERIC = "alsa_output.usb-Generic_USB_Audio-00.pro-output-0";

function names(short) {
	return helper.parseNamesFromShortList(short, 1);
}

const cases = [];
function test(name, fn) {
	cases.push([name, fn]);
}
function expect(actual, expected, ctx) {
	if (actual !== expected) {
		throw new Error(`${ctx}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

test("parse short sinks", () => {
	const n = names(SINKS_BT_HDMI_ANALOG);
	expect(n.length, 3, "parse count");
	expect(n[2], BT, "parse bt name");
});

test("auto picks bluetooth when present", () => {
	expect(helper.resolveSinkName("auto", names(SINKS_BT_HDMI_ANALOG)), BT, "auto -> bt");
	expect(helper.resolveSinkName("", names(SINKS_BT_HDMI_ANALOG)), BT, "empty -> bt");
});

test("no bluetooth falls back to hdmi", () => {
	expect(helper.resolveSinkName("auto", names(SINKS_HDMI_ANALOG)), HDMI, "no bt -> hdmi");
});

test("only analog falls back to analog/3.5mm", () => {
	expect(helper.resolveSinkName("auto", names(SINKS_ANALOG_ONLY)), ANALOG, "analog only -> analog");
});

test("generic sink uses system default tier", () => {
	expect(helper.resolveSinkName("auto", names(SINKS_GENERIC_ONLY), GENERIC), GENERIC, "generic -> default");
});

test("first available is the last resort", () => {
	expect(helper.resolveSinkName("auto", names(SINKS_GENERIC_ONLY), "nonexistent"), GENERIC, "no default -> first");
});

test("explicit override (present) wins over bluetooth", () => {
	expect(helper.resolveSinkName(HDMI, names(SINKS_BT_HDMI_ANALOG)), HDMI, "override present wins");
});

test("override not in live list falls through tiers", () => {
	expect(helper.resolveSinkName("bluez_output.DEAD_BEEF.1", names(SINKS_HDMI_ANALOG)), HDMI, "override absent -> tier fallthrough");
});

test("auto/empty sentinels trigger detection", () => {
	["auto", "", "default", "AUTO", "  Auto  "].forEach((s) => {
		expect(helper.isAutoSink(s), true, `isAutoSink(${JSON.stringify(s)})`);
		expect(helper.resolveSinkName(s, names(SINKS_HDMI_ANALOG)), HDMI, `auto ${JSON.stringify(s)} -> tier`);
	});
	expect(helper.isAutoSink("bluez_output.X.1"), false, "isAutoSink real name");
});

test("no sinks returns empty string", () => {
	expect(helper.resolveSinkName("anything", []), "", "no sinks -> empty");
});

let failed = 0;
for (const [name, fn] of cases) {
	try {
		fn();
		console.log(`PASS  ${name}`);
	} catch (err) {
		failed += 1;
		console.log(`FAIL  ${name}: ${err.message}`);
	}
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
