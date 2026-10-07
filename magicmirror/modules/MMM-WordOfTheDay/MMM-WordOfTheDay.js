/* MagicMirror²
 * Module: MMM-WordOfTheDay
 *
 * Bilingual Af-Soomaali / English vocabulary for the bottom bar. Ten words are
 * drawn for each calendar day and rotate on screen all day; tomorrow draws a
 * fresh ten. Every entry in words.json is shown exactly once before any word
 * comes round again, and the draw is derived from the date alone — so a restart
 * (or a second mirror) shows the same ten words on the same day.
 *
 * MIT Licensed.
 */
Module.register("MMM-WordOfTheDay", {
	defaults: {
		wordsFile: "words.json",
		wordsPerDay: 10,
		// Which difficulty tiers to draw from. An entry with no "level" in
		// words.json counts as "core", so the original word list needs no edit.
		// ["advanced"] alone gives only the harder tier; a short list means a
		// short pass, since the pass length follows the active pool.
		levels: ["core", "advanced"],
		rotateInterval: 30 * 1000,
		fadeSpeed: 1200,
		labelSo: "Erayada Maanta",
		labelEn: "Words of the Day",
		showHeader: true,
		showCategory: true,
		showPronunciation: true,
		showExample: true,
		showProgress: true,
		// Hour at which the mirror considers a new day to have started. 0 is
		// midnight; raise it so a late-night viewer still sees today's ten.
		dayRolloverHour: 0
	},

	getStyles: function () {
		return ["MMM-WordOfTheDay.css"];
	},

	start: function () {
		Log.info(`Starting module: ${this.name}`);

		this.words = [];
		this.categories = {};
		this.daySet = [];
		this.dayKey = null;
		this.index = 0;
		this.loaded = false;
		this.error = null;

		this.loadWords();

		this.rotateTimer = setInterval(() => this.rotate(), Math.max(2000, this.config.rotateInterval));
	},

	/**
	 * Read words.json from this module's own folder.
	 *
	 * @returns {Promise<void>} resolves once the list is loaded or the failure recorded
	 */
	loadWords: async function () {
		try {
			const response = await fetch(this.file(this.config.wordsFile));
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const data = await response.json();
			this.categories = data && typeof data.categories === "object" ? data.categories : {};
			this.words = Array.isArray(data && data.words) ? data.words.filter((word) => word && word.so && word.en) : [];

			if (this.words.length === 0) {
				throw new Error("no usable entries");
			}

			this.loaded = true;
			this.refreshDaySet(true);
			this.updateDom(this.config.fadeSpeed);
		} catch (err) {
			this.error = err.message || String(err);
			Log.error(`${this.name}: could not load ${this.config.wordsFile} — ${this.error}`);
			this.updateDom();
		}
	},

	/**
	 * Index of the current mirror-day. Built from the local calendar date rather
	 * than a raw millisecond count, so it does not slide by an hour when the
	 * clock crosses a daylight-saving boundary.
	 *
	 * @returns {number} whole days, counting up from 1970-01-01
	 */
	dayNumber: function () {
		const now = new Date();
		const rollover = Number(this.config.dayRolloverHour) || 0;
		if (rollover > 0) {
			// Before the rollover hour we are still on yesterday's set.
			now.setHours(now.getHours() - rollover);
		}

		return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
	},

	/**
	 * mulberry32 — a small deterministic PRNG. The same seed yields the same
	 * sequence on every machine, which is what lets the daily draw be random
	 * to look at yet reproducible without storing anything.
	 *
	 * @param {number} seed any 32-bit integer
	 * @returns {Function} generator returning floats in [0, 1)
	 */
	seededRandom: function (seed) {
		let state = seed | 0;
		return function () {
			state = (state + 0x6d2b79f5) | 0;
			let t = Math.imul(state ^ (state >>> 15), 1 | state);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	},

	/**
	 * The words eligible for a draw, after the difficulty filter.
	 *
	 * An entry with no "level" counts as "core" — that is what lets the original
	 * hand-written list stay untouched. A filter that matches nothing falls back
	 * to the whole list rather than leaving the bottom bar empty over a typo.
	 *
	 * @returns {object[]} words matching config.levels
	 */
	activeWords: function () {
		const wanted = Array.isArray(this.config.levels) ? this.config.levels : null;
		if (!wanted || wanted.length === 0) {
			return this.words;
		}

		const allowed = new Set(wanted.map((level) => String(level).toLowerCase()));
		const pool = this.words.filter((word) => allowed.has(String(word.level || "core").toLowerCase()));
		if (pool.length === 0) {
			Log.warn(`${this.name}: levels ${JSON.stringify(wanted)} matched no words; using the full list`);
			return this.words;
		}

		return pool;
	},

	/**
	 * The words for one specific day.
	 *
	 * Each day draws without replacement from whatever this pass has not used
	 * yet, seeded from the pass *and* the day. So the grouping is decided per
	 * day rather than being a fixed slice of one shuffle taken when the pass
	 * began, while every word still appears exactly once per pass. It stays a
	 * pure function of dayKey, so a restart mid-day — or a second mirror — draws
	 * the same set.
	 *
	 * @param {number} dayKey day index from dayNumber()
	 * @returns {object[]} today's words
	 */
	pickForDay: function (dayKey) {
		const pool = this.activeWords();
		const total = pool.length;
		if (total === 0) {
			return [];
		}

		const perDay = Math.max(1, Math.min(Number(this.config.wordsPerDay) || 1, total));
		const daysPerPass = Math.ceil(total / perDay);
		const pass = Math.floor(dayKey / daysPerPass);
		const slot = dayKey - pass * daysPerPass;

		let remaining = pool.map((_, i) => i);
		let picked = [];

		// Replay the pass from its first day so the exclusions are correct.
		// At most daysPerPass-1 extra draws, and only once a day.
		for (let day = 0; day <= slot; day++) {
			const random = this.seededRandom(
				Math.imul(pass + 1, 0x9e3779b1) ^ Math.imul(day + 1, 0x85ebca6b)
			);
			picked = [];

			for (let i = 0; i < perDay; i++) {
				if (remaining.length === 0) {
					// total is not a multiple of perDay, so daysPerPass*perDay
					// exceeds total and some repetition inside the pass is
					// arithmetically forced (240 words at 7/day = 245 draws).
					// Refill from whatever today has not taken, so the forced
					// repeats land on random words instead of always being the
					// first few of the pass, and the day stays perDay distinct.
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
	},

	/**
	 * Redraw today's set if the date has turned over.
	 *
	 * @param {boolean} force rebuild even when the day has not changed
	 * @returns {boolean} true when a new set was drawn
	 */
	refreshDaySet: function (force) {
		const dayKey = this.dayNumber();
		if (!force && dayKey === this.dayKey) {
			return false;
		}

		this.dayKey = dayKey;
		this.daySet = this.pickForDay(dayKey);
		this.index = 0;

		return true;
	},

	rotate: function () {
		if (!this.loaded) {
			return;
		}

		// A fresh day starts back at its first word instead of advancing.
		if (!this.refreshDaySet(false)) {
			this.index = (this.index + 1) % this.daySet.length;
		}

		this.updateDom(this.config.fadeSpeed);
	},

	span: function (className, text) {
		const el = document.createElement("span");
		el.className = className;
		el.textContent = text;
		return el;
	},

	/**
	 * The title line. It holds nothing else, so it stays optically centred above
	 * the word rather than being pushed off to one side by a neighbour.
	 *
	 * @returns {HTMLElement} the title row
	 */
	buildHeader: function () {
		const head = document.createElement("div");
		head.className = "wotd-head";

		const label = document.createElement("span");
		label.className = "wotd-label";
		label.appendChild(this.span("wotd-label-so", this.config.labelSo));
		label.appendChild(this.span("wotd-mid", "·"));
		label.appendChild(this.span("wotd-label-en", this.config.labelEn));
		head.appendChild(label);

		return head;
	},

	/**
	 * The small row beneath the example: which family this word belongs to, and
	 * how far through today's ten we are. Both are asides, so they sit together
	 * at the bottom and leave the title, word and example as one centred column.
	 *
	 * @param {object|null} category the category entry for today's word
	 * @returns {HTMLElement} the footer row, possibly empty
	 */
	buildFooter: function (category) {
		const footer = document.createElement("div");
		footer.className = "wotd-footer";

		if (this.config.showCategory && category) {
			const tag = document.createElement("span");
			tag.className = "wotd-tag";
			if (category.emoji) {
				tag.appendChild(this.span("wotd-emoji", category.emoji));
			}
			tag.appendChild(this.span("wotd-cat-so", category.so || ""));
			if (category.so && category.en) {
				tag.appendChild(this.span("wotd-mid", "/"));
			}
			tag.appendChild(this.span("wotd-cat-en", category.en || ""));
			footer.appendChild(tag);
		}

		if (this.config.showProgress) {
			footer.appendChild(this.buildProgress());
		}

		return footer;
	},

	buildProgress: function () {
		const dots = document.createElement("span");
		dots.className = "wotd-dots";
		dots.setAttribute("aria-label", `${this.index + 1} / ${this.daySet.length}`);

		for (let i = 0; i < this.daySet.length; i++) {
			const dot = document.createElement("span");
			dot.className = "wotd-dot";
			if (i === this.index) {
				dot.classList.add("is-now");
			} else if (i < this.index) {
				dot.classList.add("is-past");
			}
			dots.appendChild(dot);
		}

		return dots;
	},

	buildWord: function (word) {
		const row = document.createElement("div");
		row.className = "wotd-main";
		row.appendChild(this.span("wotd-so", word.so));
		row.appendChild(this.span("wotd-mid", "·"));
		row.appendChild(this.span("wotd-en", word.en));

		if (this.config.showPronunciation && word.pron) {
			row.appendChild(this.span("wotd-pron", `[${word.pron}]`));
		}

		return row;
	},

	buildExample: function (word) {
		const row = document.createElement("div");
		row.className = "wotd-example";
		row.appendChild(this.span("wotd-ex-so", word.exSo));
		row.appendChild(this.span("wotd-mid", "—"));
		row.appendChild(this.span("wotd-ex-en", word.exEn));
		return row;
	},

	getDom: function () {
		const wrapper = document.createElement("div");
		wrapper.className = "wotd";

		if (!this.loaded) {
			wrapper.classList.add("wotd-placeholder");
			wrapper.textContent = this.error ? `Erayada maanta lama hayo (${this.error})` : "Erayada maanta…";
			return wrapper;
		}

		const word = this.daySet[this.index];
		const category = this.categories[word.cat] || null;

		if (this.config.showHeader) {
			wrapper.appendChild(this.buildHeader());
		}

		wrapper.appendChild(this.buildWord(word));

		if (this.config.showExample && word.exSo && word.exEn) {
			wrapper.appendChild(this.buildExample(word));
		}

		// Only take the extra line when there is actually something to put on it.
		const footer = this.buildFooter(category);
		if (footer.childElementCount > 0) {
			wrapper.appendChild(footer);
		}

		return wrapper;
	}
});
