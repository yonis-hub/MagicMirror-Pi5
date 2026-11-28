/* MagicMirror²
 * Module: MMM-WordOfTheDay — the daily draw, with a memory.
 *
 * Plain CommonJS with no MagicMirror dependencies, so node_helper.js and the
 * regression tests share exactly the same code.
 *
 * The draw is a shuffle bag that remembers what it has handed out:
 *
 *   - Every word in the pool is shown once before any word is shown twice.
 *     That pass through the pool is a "cycle"; when it runs out a new one
 *     starts by itself.
 *   - A word shown near the end of one cycle cannot open the next one: it has
 *     to rest for half a cycle first. The old date-seeded draw shuffled each
 *     pass independently, so a word could come back the very next day.
 *   - Words added to words.json join the current cycle straight away, and
 *     removed ones are simply never drawn again; neither disturbs what has
 *     already been shown.
 *
 * All of it lives in one small JSON state object, which node_helper.js keeps
 * on disk so restarts pick up where they left off.
 *
 * MIT Licensed.
 */
"use strict";

const STATE_VERSION = 1;
const HISTORY_LIMIT = 1000; // days of history kept in the state file

/**
 * Identity of an entry across edits of words.json. A correction to either the
 * Somali or the English makes it a different entry, which simply means the
 * corrected version gets a turn of its own.
 *
 * @param {object} word an entry from words.json
 * @returns {string} the key
 */
function wordKey(word) {
	return `${String(word.so).trim().toLowerCase()}|${String(word.en).trim().toLowerCase()}`;
}

/**
 * @param {string} dateKey a "YYYY-MM-DD" local calendar date
 * @returns {number} whole days since 1970-01-01
 */
function dayIndex(dateKey) {
	const [y, m, d] = String(dateKey).split("-").map(Number);
	return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * @param {number} index whole days since 1970-01-01
 * @returns {string} the matching "YYYY-MM-DD"
 */
function dateKeyFromIndex(index) {
	return new Date(index * 86400000).toISOString().slice(0, 10);
}

/**
 * The words eligible for a draw, after the difficulty filter. An entry with
 * no "level" counts as "core". A filter that matches nothing falls back to the
 * whole list rather than leaving the bottom bar empty over a typo.
 *
 * @param {object[]} words every usable entry
 * @param {string[]|null} levels config.levels
 * @returns {object[]} the pool
 */
function filterLevels(words, levels) {
	if (!Array.isArray(levels) || levels.length === 0) {
		return words;
	}
	const allowed = new Set(levels.map((level) => String(level).toLowerCase()));
	const pool = words.filter((word) => allowed.has(String(word.level || "core").toLowerCase()));
	return pool.length > 0 ? pool : words;
}

/**
 * Words per day for this pool: config.wordsPerDay, but never more than the
 * pool holds and never less than one.
 */
function clampPerDay(perDay, poolSize) {
	return Math.max(1, Math.min(Number(perDay) || 1, poolSize));
}

function shuffle(items, rng) {
	const out = items.slice();
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

function freshState() {
	return { version: STATE_VERSION, cycle: 1, used: [], lastShown: {}, today: null, history: [] };
}

/**
 * Accept whatever was on disk, keeping the fields we understand.
 *
 * @param {object|null} raw parsed state, or null
 * @returns {object} a state object that is safe to mutate
 */
function normalizeState(raw) {
	const state = freshState();
	if (!raw || typeof raw !== "object") {
		return state;
	}
	state.cycle = Number.isInteger(raw.cycle) && raw.cycle > 0 ? raw.cycle : 1;
	state.used = Array.isArray(raw.used) ? raw.used.filter((k) => typeof k === "string") : [];
	state.lastShown = raw.lastShown && typeof raw.lastShown === "object" ? { ...raw.lastShown } : {};
	if (raw.today && typeof raw.today.date === "string" && Array.isArray(raw.today.keys)) {
		state.today = { date: raw.today.date, cycle: raw.today.cycle || state.cycle, keys: raw.today.keys.slice() };
	}
	state.history = Array.isArray(raw.history) ? raw.history.slice(-HISTORY_LIMIT) : [];
	if (raw.seededFromLegacy) {
		state.seededFromLegacy = raw.seededFromLegacy;
	}
	return state;
}

/**
 * How many days a word must rest after being shown before it can be drawn
 * again: half a cycle. Large enough that a cycle's closing words cannot open
 * the next one; small enough that at least half the pool is always eligible,
 * so the rule never starves a day.
 */
function minimumGapDays(poolSize, perDay) {
	return Math.floor(Math.ceil(poolSize / perDay) / 2);
}

/**
 * Draw the words for one day.
 *
 * Asking again for a day that has already been drawn returns the same words
 * (a restart mid-day changes nothing), and asking for a day *before* the last
 * drawn one returns that last day unchanged rather than rewriting history.
 *
 * @param {object[]} pool eligible entries (after filterLevels)
 * @param {object|null} state the stored state, or null for a first run
 * @param {string} todayKey "YYYY-MM-DD"
 * @param {number} perDay words wanted per day
 * @param {Function} [rng] random source in [0, 1); Math.random by default
 * @returns {{words: object[], state: object, changed: boolean}} the day's
 *   words, the state to store, and whether that state differs from the input
 */
function drawDay(pool, state, todayKey, perDay, rng) {
	const random = typeof rng === "function" ? rng : Math.random;
	const st = normalizeState(state);
	const byKey = new Map();
	pool.forEach((word) => {
		const key = wordKey(word);
		if (!byKey.has(key)) {
			byKey.set(key, word);
		}
	});
	const keys = [...byKey.keys()];
	if (keys.length === 0) {
		return { words: [], state: st, changed: false };
	}
	const count = clampPerDay(perDay, keys.length);

	if (st.today) {
		const stored = st.today.keys.map((k) => byKey.get(k)).filter(Boolean);
		const sameDay = st.today.date === todayKey;
		const earlierDay = dayIndex(todayKey) < dayIndex(st.today.date);
		// Same day and the stored set still fits the pool and the config: keep it.
		// A day earlier than the last one drawn (clock wound back): keep the
		// last one rather than redraw a day that already has a history entry.
		if ((sameDay && stored.length === count) || (earlierDay && stored.length > 0)) {
			return { words: stored, state: st, changed: false };
		}
	}

	const todayIdx = dayIndex(todayKey);
	const minGap = minimumGapDays(keys.length, count);
	const lastIdx = (k) => (st.lastShown[k] ? dayIndex(st.lastShown[k]) : -Infinity);
	const rested = (k) => todayIdx - lastIdx(k) >= minGap;

	let used = new Set(st.used);
	const picks = [];
	const picked = new Set();

	// At most two rounds: the tail of the current cycle, then (if that ran out
	// mid-day) the start of the next.
	for (let round = 0; round < 3 && picks.length < count; round++) {
		let unused = keys.filter((k) => !used.has(k) && !picked.has(k));
		if (unused.length === 0) {
			st.cycle += 1;
			used = new Set();
			unused = keys.filter((k) => !picked.has(k));
			if (unused.length === 0) {
				break;
			}
		}

		const need = count - picks.length;
		let take = shuffle(unused.filter(rested), random).slice(0, need);
		if (take.length < need) {
			// Not enough well-rested words: top up with whichever unused ones
			// have waited longest (never-shown first).
			const chosen = new Set(take);
			const waiting = shuffle(unused.filter((k) => !chosen.has(k)), random)
				.sort((a, b) => lastIdx(a) - lastIdx(b));
			take = take.concat(waiting.slice(0, need - take.length));
		}

		take.forEach((k) => {
			picks.push(k);
			picked.add(k);
			used.add(k);
		});
	}

	picks.forEach((k) => {
		st.lastShown[k] = todayKey;
	});
	st.used = [...used];
	st.today = { date: todayKey, cycle: st.cycle, keys: picks };

	const entry = { date: todayKey, cycle: st.cycle, keys: picks };
	if (st.history.length > 0 && st.history[st.history.length - 1].date === todayKey) {
		st.history[st.history.length - 1] = entry; // a same-day redraw (config changed)
	} else {
		st.history.push(entry);
	}
	if (st.history.length > HISTORY_LIMIT) {
		st.history = st.history.slice(-HISTORY_LIMIT);
	}

	return { words: picks.map((k) => byKey.get(k)), state: st, changed: true };
}

// ----------------------------------------------------------------------------
// One-off migration from the old date-seeded draw.
//
// Before this file existed the mirror chose each day's words from the date
// alone (see legacyPickForDay). The first time the new draw runs it replays
// that schedule, so words the old one showed recently start out "recently
// shown" instead of coming straight back on the day of the switch.
// ----------------------------------------------------------------------------

/** mulberry32, exactly as the old module had it. */
function seededRandom(seed) {
	let state = seed | 0;
	return function () {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * The old module's pickForDay, verbatim apart from taking its inputs as
 * arguments. Only used to reconstruct what it showed.
 */
function legacyPickForDay(pool, dayNumber, perDay) {
	const total = pool.length;
	if (total === 0) {
		return [];
	}
	const count = clampPerDay(perDay, total);
	const daysPerPass = Math.ceil(total / count);
	const pass = Math.floor(dayNumber / daysPerPass);
	const slot = dayNumber - pass * daysPerPass;

	let remaining = pool.map((_, i) => i);
	let picked = [];
	for (let day = 0; day <= slot; day++) {
		const random = seededRandom(Math.imul(pass + 1, 0x9e3779b1) ^ Math.imul(day + 1, 0x85ebca6b));
		picked = [];
		for (let i = 0; i < count; i++) {
			if (remaining.length === 0) {
				const takenToday = new Set(picked);
				remaining = pool.map((_, idx) => idx).filter((idx) => !takenToday.has(idx));
				if (remaining.length === 0) {
					break;
				}
			}
			const j = Math.floor(random() * remaining.length);
			picked.push(remaining[j]);
			remaining.splice(j, 1);
		}
	}
	return picked.map((i) => pool[i]);
}

/**
 * Build a first state from the old schedule.
 *
 * @param {object[]} pool today's eligible entries
 * @param {object[]} legacyPool the entries the old draw was using, in their
 *   original order (words.json minus anything with an "added" date)
 * @param {string} todayKey "YYYY-MM-DD"
 * @param {number} perDay config.wordsPerDay
 * @returns {object} a state for drawDay
 */
function seedFromLegacy(pool, legacyPool, todayKey, perDay) {
	const st = freshState();
	st.seededFromLegacy = todayKey;
	if (legacyPool.length === 0) {
		return st;
	}

	const today = dayIndex(todayKey);
	const count = clampPerDay(perDay, legacyPool.length);
	const daysPerPass = Math.ceil(legacyPool.length / count);
	const passStart = Math.floor(today / daysPerPass) * daysPerPass;
	const inPool = new Set(pool.map(wordKey));
	const used = new Set();

	// Two passes back is enough to cover every rest period; today is included
	// because the old draw already put today's words on screen this morning.
	for (let d = today - 2 * daysPerPass; d <= today; d++) {
		const date = dateKeyFromIndex(d);
		legacyPickForDay(legacyPool, d, count).forEach((word) => {
			const key = wordKey(word);
			st.lastShown[key] = date;
			if (d >= passStart && inPool.has(key)) {
				used.add(key); // shown during the old draw's current pass
			}
		});
	}
	st.used = [...used];
	return st;
}

/**
 * A summary for logs and the status endpoint.
 *
 * @param {object[]} pool eligible entries
 * @param {object} state the current state
 * @param {number} perDay config.wordsPerDay
 * @returns {object} counts plus today's words and the last week
 */
function summarize(pool, state, perDay) {
	const st = normalizeState(state);
	const keys = new Set(pool.map(wordKey));
	const count = clampPerDay(perDay, keys.size || 1);
	const usedInCycle = st.used.filter((k) => keys.has(k)).length;
	const label = (k) => {
		const [so, en] = k.split("|");
		return `${so} — ${en}`;
	};
	return {
		cycle: st.cycle,
		poolSize: keys.size,
		wordsPerDay: count,
		usedThisCycle: usedInCycle,
		remainingThisCycle: keys.size - usedInCycle,
		daysPerCycle: Math.ceil(keys.size / count),
		minimumGapDays: minimumGapDays(keys.size, count),
		today: st.today ? { date: st.today.date, words: st.today.keys.map(label) } : null,
		lastSevenDays: st.history.slice(-7).map((h) => ({ date: h.date, cycle: h.cycle, words: h.keys.map(label) })),
		daysRecorded: st.history.length,
		seededFromLegacy: st.seededFromLegacy || null
	};
}

module.exports = {
	STATE_VERSION,
	wordKey,
	dayIndex,
	dateKeyFromIndex,
	filterLevels,
	minimumGapDays,
	drawDay,
	legacyPickForDay,
	seedFromLegacy,
	summarize,
	normalizeState
};
