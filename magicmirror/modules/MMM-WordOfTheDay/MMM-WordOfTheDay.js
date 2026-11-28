/* MagicMirror²
 * Module: MMM-WordOfTheDay
 *
 * Bilingual Af-Soomaali / English vocabulary for the bottom bar. Ten words are
 * drawn for each calendar day and rotate on screen all day; tomorrow draws a
 * fresh ten. The draw itself happens in node_helper.js (see draw.js), which
 * remembers what has been shown: every entry in words.json gets a turn before
 * any word comes round again, and a restart keeps the same ten for the day.
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
		// short cycle, since the cycle length follows the active pool.
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

		this.categories = {};
		this.daySet = [];
		this.dayKey = null;
		this.requestedDay = null;
		this.index = 0;
		this.loaded = false;
		this.error = null;

		this.requestDay();

		this.rotateTimer = setInterval(() => this.rotate(), Math.max(2000, this.config.rotateInterval));
	},

	/**
	 * The current mirror-day as "YYYY-MM-DD", from the local calendar date, so
	 * it does not slide by an hour across a daylight-saving change.
	 *
	 * @returns {string} the day key node_helper draws and records against
	 */
	currentDayKey: function () {
		const now = new Date();
		const rollover = Number(this.config.dayRolloverHour) || 0;
		if (rollover > 0) {
			// Before the rollover hour we are still on yesterday's set.
			now.setHours(now.getHours() - rollover);
		}
		const pad = (n) => String(n).padStart(2, "0");
		return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	},

	requestDay: function () {
		this.requestedDay = this.currentDayKey();
		this.requestedAt = Date.now();
		this.sendSocketNotification("WOTD_GET_DAY", {
			dayKey: this.requestedDay,
			wordsFile: this.config.wordsFile,
			levels: this.config.levels,
			wordsPerDay: this.config.wordsPerDay
		});
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "WOTD_DAY") {
			const words = Array.isArray(payload && payload.words) ? payload.words : [];
			// The helper answers every connected client at once; ignore an answer
			// for some other day once this one is already showing words.
			if (words.length === 0 || (this.loaded && payload.dayKey !== this.currentDayKey())) {
				return;
			}
			// A fresh day starts at its first word; a repeat of the same day
			// (another client asked) leaves the rotation where it is.
			if (payload.dayKey !== this.dayKey) {
				this.index = 0;
			}
			this.dayKey = payload.dayKey;
			this.daySet = words;
			this.index = this.index % words.length;
			this.categories = payload.categories || {};
			this.loaded = true;
			this.error = null;
			this.updateDom(this.config.fadeSpeed);
		} else if (notification === "WOTD_ERROR") {
			Log.error(`${this.name}: ${payload && payload.message}`);
			if (!this.loaded) {
				this.error = (payload && payload.message) || "unknown error";
				this.updateDom();
			}
		}
	},

	rotate: function () {
		// Not loaded yet (helper still starting, or it failed): ask again.
		if (!this.loaded) {
			this.requestDay();
			return;
		}

		// The date has turned over: ask for the new day, and keep showing the
		// old one until it arrives. Ask again if a minute passes with no answer.
		const today = this.currentDayKey();
		const unanswered = today === this.requestedDay && Date.now() - (this.requestedAt || 0) > 60000;
		if (today !== this.dayKey && (today !== this.requestedDay || unanswered)) {
			this.requestDay();
		}

		this.index = (this.index + 1) % this.daySet.length;
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
