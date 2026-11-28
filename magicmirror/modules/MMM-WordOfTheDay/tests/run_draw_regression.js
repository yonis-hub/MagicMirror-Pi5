#!/usr/bin/env node
/* Regression checks for the MMM-WordOfTheDay daily draw.
 *
 * draw.js is plain CommonJS, so most of this calls it directly. The last
 * sections load node_helper.js and the browser module with MagicMirror's
 * globals stubbed (the same trick MMM-QuranDisplay's parser regression uses
 * for its audio runtime), with the state file pointed at a temp directory.
 *
 * Run: node tests/run_draw_regression.js
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const MODULE_DIR = path.join(__dirname, "..");
const draw = require(path.join(MODULE_DIR, "draw.js"));

const data = JSON.parse(fs.readFileSync(path.join(MODULE_DIR, "words.json"), "utf8"));
const ALL_WORDS = data.words.filter((w) => w && w.so && w.en);

let failures = 0;
function check(label, condition, detail) {
	if (condition) {
		console.log(`PASS ${label}`);
	} else {
		failures += 1;
		console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

/** Deterministic random source, so a failure reproduces. */
function lcg(seed) {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

const START = "2026-11-28";
const dateAt = (offset) => draw.dateKeyFromIndex(draw.dayIndex(START) + offset);

/**
 * Run the draw for `days` consecutive days.
 * @returns {{days: string[][], state: object}} keys drawn per day, final state
 */
function simulate(pool, days, perDay, opts) {
	const options = opts || {};
	let state = options.state || null;
	const rng = lcg(options.seed || 1);
	const out = [];
	for (let d = 0; d < days; d++) {
		const poolToday = options.poolForDay ? options.poolForDay(d) : pool;
		const result = draw.drawDay(poolToday, state, dateAt(d + (options.offset || 0)), perDay, rng);
		state = options.roundTrip ? JSON.parse(JSON.stringify(result.state)) : result.state;
		out.push(result.words.map(draw.wordKey));
	}
	return { days: out, state };
}

// ------------------------------------------------------------ one full cycle
{
	const perDay = 10;
	const total = ALL_WORDS.length;
	const daysPerCycle = Math.ceil(total / perDay);
	const { days, state } = simulate(ALL_WORDS, daysPerCycle, perDay);
	const counts = new Map();
	days.flat().forEach((k) => counts.set(k, (counts.get(k) || 0) + 1));

	check(
		`every word appears once in the first cycle (${total} words / ${daysPerCycle} days)`,
		ALL_WORDS.every((w) => counts.get(draw.wordKey(w)) >= 1),
		`${counts.size} of ${total} seen`
	);
	check(
		"no word appears twice inside a cycle",
		[...counts.values()].filter((c) => c > 1).length <= perDay,
		"(only the last day may borrow from the next cycle)"
	);
	check("every day is perDay distinct words", days.every((d) => d.length === perDay && new Set(d).size === perDay));
	check(
		`the cycle rolls over by itself (cycle ${state.cycle} after ${daysPerCycle} days)`,
		total % perDay === 0 ? state.cycle === 1 || state.cycle === 2 : state.cycle === 2
	);
}

// ---------------------------------------------- spacing across many cycles
{
	const perDay = 10;
	const total = ALL_WORDS.length;
	const daysPerCycle = Math.ceil(total / perDay);
	const minGap = draw.minimumGapDays(total, perDay);
	const { days } = simulate(ALL_WORDS, daysPerCycle * 6, perDay, { seed: 7 });
	const last = new Map();
	const gaps = [];
	days.forEach((keys, d) => {
		keys.forEach((k) => {
			if (last.has(k)) gaps.push(d - last.get(k));
			last.set(k, d);
		});
	});
	const shortest = Math.min(...gaps);
	const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
	console.log(`     (${gaps.length} returns over 6 cycles: shortest ${shortest} days, mean ${mean.toFixed(1)}, cycle ${daysPerCycle})`);
	check(`no word returns sooner than ${minGap} days (half a cycle)`, shortest >= minGap, `shortest ${shortest}`);
	check("the average return is about one cycle", Math.abs(mean - daysPerCycle) <= 2, `mean ${mean.toFixed(1)}`);
	check(
		"every word keeps getting its turn (each seen in every cycle)",
		ALL_WORDS.every((w) => days.flat().filter((k) => k === draw.wordKey(w)).length >= 5)
	);
}

// -------------------------------------------------- same day = same words
{
	const first = draw.drawDay(ALL_WORDS, null, START, 10, lcg(3));
	const again = draw.drawDay(ALL_WORDS, first.state, START, 10, lcg(99));
	check("asking for the same day again returns the same ten (a restart)", again.words.map(draw.wordKey).join() === first.words.map(draw.wordKey).join());
	check("...and does not change the state", again.changed === false);

	const tomorrow = draw.drawDay(ALL_WORDS, first.state, dateAt(1), 10, lcg(3));
	check("the next day is a different ten", tomorrow.words.every((w) => !first.words.includes(w)));

	const backwards = draw.drawDay(ALL_WORDS, tomorrow.state, START, 10, lcg(5));
	check(
		"a clock wound back keeps the last drawn day and writes nothing",
		backwards.changed === false && backwards.words.map(draw.wordKey).join() === tomorrow.words.map(draw.wordKey).join()
	);

	const rt = simulate(ALL_WORDS, 60, 10, { roundTrip: true, seed: 11 });
	const flat = rt.days.slice(0, 52).flat();
	check("state survives a JSON round trip every day (the on-disk path)", new Set(flat).size === flat.length);
}

// ------------------------------------------------ editing words.json mid-cycle
{
	const base = ALL_WORDS.slice(0, 200);
	const extra = ALL_WORDS.slice(200, 230);
	const withExtra = base.concat(extra);
	const { days } = simulate(base, 40, 10, {
		seed: 5,
		poolForDay: (d) => (d < 5 ? base : withExtra)
	});
	const cycleDays = days.slice(0, 23).flat(); // 230 words / 10 = 23 days
	const extraKeys = new Set(extra.map(draw.wordKey));
	check(
		"words added mid-cycle get their turn within that cycle",
		[...extraKeys].every((k) => cycleDays.includes(k)),
		`${[...extraKeys].filter((k) => cycleDays.includes(k)).length} of ${extraKeys.size}`
	);
	check("adding words does not bring back ones already shown this cycle", new Set(cycleDays).size === cycleDays.length);

	const removed = base.slice(0, 50);
	const trimmed = base.slice(50);
	const removedKeys = new Set(removed.map(draw.wordKey));
	const after = simulate(base, 30, 10, { seed: 9, poolForDay: (d) => (d < 3 ? base : trimmed) });
	check("removed words are never drawn again", after.days.slice(3).flat().every((k) => !removedKeys.has(k)));
}

// -------------------------------------- wordsPerDay that does not divide total
{
	const pool = ALL_WORDS.slice(0, 240);
	const perDay = 7;
	const daysPerCycle = Math.ceil(pool.length / perDay); // 35 days, 245 slots
	const { days } = simulate(pool, daysPerCycle * 3, perDay, { seed: 13 });
	check(`wordsPerDay=7 always returns 7 distinct words`, days.every((d) => d.length === 7 && new Set(d).size === 7));
	const firstCycle = days.slice(0, daysPerCycle - 1).flat();
	check("wordsPerDay=7: no repeats inside a cycle", new Set(firstCycle).size === firstCycle.length);
}

// ------------------------------------------------------------- level filter
{
	const levels = new Set(ALL_WORDS.map((w) => String(w.level || "core").toLowerCase()));
	console.log(`     (levels present in words.json: ${[...levels].join(", ")})`);
	const core = draw.filterLevels(ALL_WORDS, ["core"]);
	check("levels:['core'] excludes advanced entries", core.length > 0 && core.every((w) => String(w.level || "core") === "core"));
	const adv = draw.filterLevels(ALL_WORDS, ["advanced"]);
	check("levels:['advanced'] returns only advanced entries", adv.length > 0 && adv.every((w) => w.level === "advanced"));
	check("levels:['core','advanced'] is the whole list", draw.filterLevels(ALL_WORDS, ["core", "advanced"]).length === ALL_WORDS.length);
	check("an unmatched level falls back to the full list (bar never blanks)", draw.filterLevels(ALL_WORDS, ["nonsense"]).length === ALL_WORDS.length);
	check("levels:[] means no filter", draw.filterLevels(ALL_WORDS, []).length === ALL_WORDS.length);
	check("every new entry is advanced and flagged for review", ALL_WORDS.filter((w) => w.added).every((w) => w.level === "advanced" && w.review === true));
}

// ------------------------------------- migration from the old date-seeded draw
{
	const legacyPool = ALL_WORDS.filter((w) => !w.added);
	const perDay = 10;
	const seeded = draw.seedFromLegacy(ALL_WORDS, legacyPool, START, perDay);
	const today = draw.dayIndex(START);

	// What the old draw showed over the last minGap days, today included.
	const minGap = draw.minimumGapDays(ALL_WORDS.length, perDay);
	const recent = new Set();
	for (let d = today - minGap + 1; d <= today; d++) {
		draw.legacyPickForDay(legacyPool, d, perDay).forEach((w) => recent.add(draw.wordKey(w)));
	}
	const { days } = simulate(ALL_WORDS, minGap, perDay, { state: seeded, seed: 21 });
	const clash = days.flat().filter((k) => recent.has(k));
	check(
		`after the switch, nothing the old draw showed in the last ${minGap} days comes back for ${minGap} days`,
		clash.length === 0,
		`${clash.length} clashes, e.g. ${clash.slice(0, 3).join(", ")}`
	);

	const daysPerPass = Math.ceil(legacyPool.length / perDay);
	const passStart = Math.floor(today / daysPerPass) * daysPerPass;
	const shownThisPass = new Set();
	for (let d = passStart; d <= today; d++) {
		draw.legacyPickForDay(legacyPool, d, perDay).forEach((w) => shownThisPass.add(draw.wordKey(w)));
	}
	check(
		`words the old draw already showed this pass (${shownThisPass.size}) count as used`,
		seeded.used.length === shownThisPass.size && seeded.used.every((k) => shownThisPass.has(k))
	);
}

// ------------------------------------------------- node_helper, end to end
{
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wotd-"));
	process.env.WOTD_STATE_FILE = path.join(tmp, "state", "history.json");

	const realLoad = Module._load;
	Module._load = function (request, ...rest) {
		if (request === "node_helper") return { create: (def) => def };
		return realLoad.call(this, request, ...rest);
	};
	const helperDef = require(path.join(MODULE_DIR, "node_helper.js"));
	Module._load = realLoad;

	const routes = {};
	const sent = [];
	const helper = Object.assign({}, helperDef, {
		name: "MMM-WordOfTheDay",
		expressApp: { get: (route, fn) => (routes[route] = fn) },
		sendSocketNotification: (n, p) => sent.push({ n, p })
	});
	const quiet = console.log;
	console.log = () => {};
	helper.start();

	const ask = (dayKey) => helper.socketNotificationReceived("WOTD_GET_DAY", { dayKey, wordsFile: "words.json", levels: ["core", "advanced"], wordsPerDay: 10 });
	ask(START);
	const day1 = sent[sent.length - 1];
	ask(START);
	const day1again = sent[sent.length - 1];
	ask(dateAt(1));
	const day2 = sent[sent.length - 1];
	console.log = quiet;

	check("helper answers with ten words and the categories", day1.n === "WOTD_DAY" && day1.p.words.length === 10 && Object.keys(day1.p.categories).length > 0);
	check("helper writes the state file", fs.existsSync(process.env.WOTD_STATE_FILE));
	check("a second request for the day (restart) gets the same ten", day1again.p.words.map((w) => w.so).join() === day1.p.words.map((w) => w.so).join());
	check("the next day gets ten different words", day2.p.words.every((w) => !day1.p.words.some((x) => x.so === w.so)));

	let statusBody = null;
	routes["/api/wotd/status"]({}, { json: (b) => (statusBody = b), status: () => ({ json: (b) => (statusBody = b) }) });
	check(
		"GET /api/wotd/status reports the cycle, progress and today's words",
		statusBody && statusBody.cycle === 1 && statusBody.poolSize === ALL_WORDS.length && statusBody.today.words.length === 10 && statusBody.lastSevenDays.length === 2
	);

	fs.writeFileSync(process.env.WOTD_STATE_FILE, "{ not json");
	console.error = () => {};
	console.log = () => {};
	ask(dateAt(2));
	console.log = quiet;
	const afterCorrupt = sent[sent.length - 1];
	const asideFiles = fs.readdirSync(path.dirname(process.env.WOTD_STATE_FILE)).filter((f) => f.includes(".corrupt-"));
	check("a corrupt state file is moved aside and the day still gets words", afterCorrupt.n === "WOTD_DAY" && afterCorrupt.p.words.length === 10 && asideFiles.length === 1);

	fs.rmSync(tmp, { recursive: true, force: true });
	delete process.env.WOTD_STATE_FILE;
}

// ------------------------------------------------- the browser module's side
{
	let captured = null;
	global.Module = { register: (name, def) => (captured = def) };
	global.Log = { info() {}, warn() {}, error() {} };
	require(path.join(MODULE_DIR, "MMM-WordOfTheDay.js"));
	const sentUp = [];
	const mod = Object.assign({}, captured, {
		name: "MMM-WordOfTheDay",
		config: Object.assign({}, captured.defaults),
		updateDom() {},
		sendSocketNotification: (n, p) => sentUp.push({ n, p })
	});
	global.setInterval = () => 0;
	mod.start();
	const key = mod.currentDayKey();
	check("module asks the helper for today on start", sentUp[0] && sentUp[0].n === "WOTD_GET_DAY" && /^\d{4}-\d{2}-\d{2}$/.test(sentUp[0].p.dayKey));
	mod.socketNotificationReceived("WOTD_DAY", { dayKey: key, words: ALL_WORDS.slice(0, 10), categories: data.categories });
	check("module shows the words it is sent", mod.loaded && mod.daySet.length === 10 && mod.index === 0);
	mod.rotate();
	check("rotation advances through the day", mod.index === 1);
	mod.socketNotificationReceived("WOTD_DAY", { dayKey: "1999-01-01", words: ALL_WORDS.slice(10, 20), categories: {} });
	check("an answer for some other day is ignored once loaded", mod.daySet[0] === ALL_WORDS[0]);
}

console.log(`\nSummary: ${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
