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
	 * A stable shuffle of every index in the list. The same pass always produces
	 * the same order, which is what keeps the daily draw reproducible.
	 *
	 * @param {number} total number of words in the list
	 * @param {number} pass which sweep through the whole list we are on
	 * @returns {number[]} shuffled indices
	 */
	shuffledOrder: function (total, pass) {
		let seed = Math.imul(pass + 1, 0x9e3779b1);
		const random = function () {
			seed = (seed + 0x6d2b79f5) | 0;
			let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};

		const order = Array.from({ length: total }, (_, i) => i);
		for (let i = total - 1; i > 0; i--) {
			const j = Math.floor(random() * (i + 1));
			[order[i], order[j]] = [order[j], order[i]];
		}

		return order;
	},

	/**
	 * The words for one specific day.
	 *
	 * @param {number} dayKey day index from dayNumber()
	 * @returns {object[]} today's slice of the list
	 */
	pickForDay: function (dayKey) {
		const total = this.words.length;
		const perDay = Math.max(1, Math.min(Number(this.config.wordsPerDay) || 1, total));
		const daysPerPass = Math.ceil(total / perDay);
		const pass = Math.floor(dayKey / daysPerPass);
		const slot = dayKey - pass * daysPerPass;
		const order = this.shuffledOrder(total, pass);

		const picked = [];
		for (let i = 0; i < perDay; i++) {
			picked.push(this.words[order[(slot * perDay + i) % total]]);
		}

		return picked;
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
