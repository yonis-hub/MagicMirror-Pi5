#!/usr/bin/env node
/* Regression checks for the MMM-WordOfTheDay daily draw.
 *
 * The module is browser code registered through MagicMirror's global Module
 * object, so this stubs that global (and Log), captures the definition, and
 * calls the draw methods against a plain object standing in for `this`. Same
 * idea as MMM-QuranDisplay/tests/run_parser_regression.py stubbing the audio
 * and STT runtime.
 */

const fs = require("fs");
const path = require("path");

const MODULE_DIR = path.join(__dirname, "..");

let captured = null;
global.Module = {
	register: function (name, definition) {
		captured = definition;
	}
};
global.Log = { info() {}, warn() {}, error() {} };

require(path.join(MODULE_DIR, "MMM-WordOfTheDay.js"));
if (!captured) {
	console.error("FAIL: Module.register was never called");
	process.exit(1);
}

const data = JSON.parse(fs.readFileSync(path.join(MODULE_DIR, "words.json"), "utf8"));
const ALL_WORDS = data.words.filter((w) => w && w.so && w.en);

/** A module instance with `words` loaded and config overrides applied. */
function instance(overrides) {
	return Object.assign({}, captured, {
		name: "MMM-WordOfTheDay",
		words: ALL_WORDS,
		config: Object.assign({}, captured.defaults, overrides || {})
	});
}

let failures = 0;
function check(label, condition, detail) {
	if (condition) {
		console.log(`PASS ${label}`);
	} else {
		failures += 1;
		console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

// A pass boundary, so slot 0 really is the first day of a pass.
function passStart(mod, dayKey) {
	const total = mod.activeWords().length;
	const perDay = Math.max(1, Math.min(Number(mod.config.wordsPerDay) || 1, total));
	const daysPerPass = Math.ceil(total / perDay);
	return { base: Math.floor(dayKey / daysPerPass) * daysPerPass, daysPerPass, perDay, total };
}

// ---------------------------------------------------------------- exhaustive
{
	const mod = instance({ levels: ["core"], wordsPerDay: 10 });
	const { base, daysPerPass, perDay, total } = passStart(mod, 20733);
	const seen = new Set();
	let allFullAndDistinct = true;

	for (let d = 0; d < daysPerPass; d++) {
		const day = mod.pickForDay(base + d);
		const unique = new Set(day.map((w) => w.so));
		if (day.length !== perDay || unique.size !== perDay) {
			allFullAndDistinct = false;
		}
		day.forEach((w) => seen.add(w.so));
	}

	check(
		`every core word appears once per pass (${total} words / ${daysPerPass} days)`,
		seen.size === total,
		`saw ${seen.size} distinct of ${total}`
	);
	check("every day of the pass is perDay distinct words", allFullAndDistinct);
}

// ----------------------------------------------------------------- stability
{
	const mod = instance({ levels: ["core"], wordsPerDay: 10 });
	const a = mod.pickForDay(20733).map((w) => w.so);
	const b = mod.pickForDay(20733).map((w) => w.so);
	check("same dayKey gives the same set (survives a restart)", JSON.stringify(a) === JSON.stringify(b));

	const other = instance({ levels: ["core"], wordsPerDay: 10 });
	const c = other.pickForDay(20733).map((w) => w.so);
	check("a second instance agrees (two mirrors match)", JSON.stringify(a) === JSON.stringify(c));

	const tomorrow = mod.pickForDay(20734).map((w) => w.so);
	check("the next day is a different set", JSON.stringify(a) !== JSON.stringify(tomorrow));
}

// ------------------------------------------------------- pass-to-pass change
{
	const mod = instance({ levels: ["core"], wordsPerDay: 10 });
	const { base, daysPerPass } = passStart(mod, 20733);
	const slot0ThisPass = mod.pickForDay(base).map((w) => w.so).sort();
	const slot0NextPass = mod.pickForDay(base + daysPerPass).map((w) => w.so).sort();
	check(
		"the same slot in the next pass is grouped differently",
		JSON.stringify(slot0ThisPass) !== JSON.stringify(slot0NextPass)
	);
}

// -------------------------------------------------------------- level filter
{
	const levels = new Set(ALL_WORDS.map((w) => String(w.level || "core").toLowerCase()));
	console.log(`     (levels present in words.json: ${[...levels].join(", ")})`);

	const core = instance({ levels: ["core"] });
	check(
		"levels:['core'] excludes advanced entries",
		core.activeWords().every((w) => String(w.level || "core").toLowerCase() === "core")
	);

	if (levels.has("advanced")) {
		const adv = instance({ levels: ["advanced"] });
		const pool = adv.activeWords();
		check("levels:['advanced'] returns only advanced entries", pool.length > 0 && pool.every((w) => w.level === "advanced"));

		const both = instance({ levels: ["core", "advanced"] });
		check(
			"levels:['core','advanced'] is the whole list",
			both.activeWords().length === ALL_WORDS.length,
			`${both.activeWords().length} vs ${ALL_WORDS.length}`
		);

		const mixed = instance({ levels: ["core", "advanced"], wordsPerDay: 10 });
		const { base, daysPerPass } = passStart(mixed, 20733);
		let sawAdvanced = false;
		for (let d = 0; d < daysPerPass; d++) {
			if (mixed.pickForDay(base + d).some((w) => w.level === "advanced")) {
				sawAdvanced = true;
				break;
			}
		}
		check("a mixed pass actually surfaces advanced words", sawAdvanced);
	} else {
		console.log("SKIP advanced-level checks — no advanced entries in words.json yet");
	}

	const bogus = instance({ levels: ["nonsense"] });
	check(
		"an unmatched level falls back to the full list (bar never blanks)",
		bogus.activeWords().length === ALL_WORDS.length
	);

	const empty = instance({ levels: [] });
	check("levels:[] means no filter", empty.activeWords().length === ALL_WORDS.length);
}

// -------------------------------------- perDay that does not divide the total
{
	const mod = instance({ levels: ["core"], wordsPerDay: 7 });
	const { base, daysPerPass, perDay, total } = passStart(mod, 20733);
	let ok = true;
	const offenders = [];
	const counts = new Map();

	for (let d = 0; d < daysPerPass; d++) {
		const day = mod.pickForDay(base + d);
		const unique = new Set(day.map((w) => w.so));
		if (day.length !== perDay || unique.size !== perDay) {
			ok = false;
			offenders.push(`day ${d}: ${day.length} words, ${unique.size} distinct`);
		}
		day.forEach((w) => counts.set(w.so, (counts.get(w.so) || 0) + 1));
	}

	check(
		`wordsPerDay=7 over ${daysPerPass} days always returns 7 distinct words`,
		ok,
		offenders.slice(0, 3).join("; ")
	);
	check("wordsPerDay=7 still reaches every word in the pass", counts.size === total, `${counts.size} of ${total}`);

	// daysPerPass*perDay > total when perDay does not divide total, so this many
	// repeats are unavoidable. Assert the refill adds none beyond that minimum.
	const forced = daysPerPass * perDay - total;
	const repeated = [...counts.values()].filter((c) => c > 1).length;
	check(
		`wordsPerDay=7 repeats only the ${forced} words arithmetic forces`,
		repeated === forced,
		`${repeated} repeated, expected ${forced}`
	);
}

console.log(`\nSummary: ${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
