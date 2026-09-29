/* MagicMirror²
 * Module: MMM-Greeting
 *
 * The bilingual welcome line above MMM-WordOfTheDay. Picks a greeting for the
 * time of day and, when MMM-FaceIdentity recognises whoever is standing at the
 * mirror, greets them by name. Every greeting carries its English reading, so
 * the greeting and the word of the day speak the same way.
 *
 * MIT Licensed.
 */
Module.register("MMM-Greeting", {
	defaults: {
		updateInterval: 60 * 1000,
		fadeSpeed: 2000,
		random: true,
		showEnglish: true,
		showRule: true,

		// Hour each part of the day begins.
		morningStartTime: 5,
		afternoonStartTime: 12,
		eveningStartTime: 17,
		nightStartTime: 21,

		identityNotification: "FACE_IDENTITY_UPDATE",
		identityFallback: "unknown",
		identityDisplayNames: {},
		// Per-person overrides, same shape as `greetings` below. Anything found
		// here is offered alongside the generic lines for that time of day.
		identityGreetings: {},

		// `{name}` is filled in when a face is recognised, and dropped along with
		// the comma that introduced it when nobody is — the camera is off more
		// often than not, so every line here has to read well without a name.
		// Keys other than the parts of the day are treated as date patterns,
		// exactly as the compliments module did.
		greetings: {
			morning: [
				{ so: "Subax wanaagsan, {name}", en: "Good morning, {name}" },
				{ so: "Maalin khayr leh, {name}", en: "A day of goodness, {name}" },
				{ so: "Maalinta ku bilow niyad wanaagsan", en: "Start the day in good spirits" },
				{ so: "Ilaahay ha kuu barakeeyo saaka", en: "May God bless your morning" },
				{ so: "Subaxdu waa fursad cusub", en: "The morning is a fresh chance" },
				{ so: "Barako iyo caafimaad, {name}", en: "Blessing and health, {name}" }
			],
			afternoon: [
				{ so: "Galab wanaagsan, {name}", en: "Good afternoon, {name}" },
				{ so: "Sii wad dadaalka, {name}", en: "Keep up the good work, {name}" },
				{ so: "Nasasho yar qaado", en: "Take a short rest" },
				{ so: "Maalintu weli way dheer tahay", en: "There is still plenty of day left" },
				{ so: "Biyo cab oo dib u bilow", en: "Drink some water and begin again" }
			],
			evening: [
				{ so: "Fiid wanaagsan, {name}", en: "Good evening, {name}" },
				{ so: "Alxamdulillaah, maanta waad martay", en: "Alhamdulillah, you got through today" },
				{ so: "Galabtii nabad, {name}", en: "Peace this evening, {name}" },
				{ so: "Maanta wanaag baad qabatay", en: "You did well today" },
				{ so: "Fiidku waa waqti degganaan", en: "Evening is a time for calm" }
			],
			night: [
				{ so: "Habeen wanaagsan, {name}", en: "Good night, {name}" },
				{ so: "Habeen deggan oo barako leh", en: "A calm and blessed night" },
				{ so: "Naso, berri waa fursad cusub", en: "Rest — tomorrow is a new chance" },
				{ so: "Hurdo wanaagsan, {name}", en: "Sleep well, {name}" },
				{ so: "Habeenku waa nasasho", en: "The night is for rest" }
			],
			anytime: [
				{ so: "Soo dhawoow, {name}", en: "Welcome, {name}" },
				{ so: "Guriga waa nabad", en: "Home is peace" },
				{ so: "Nabad iyo caano", en: "Peace and milk" }
			],
			"....-01-01": [{ so: "Sanad cusub oo wanaagsan!", en: "Happy new year!" }]
		}
	},

	getStyles: function () {
		return ["MMM-Greeting.css"];
	},

	/**
	 * Today's date as YYYY-MM-DD in local time, for the date-pattern keys.
	 *
	 * Deliberately built from Date rather than moment: this module renders
	 * nothing at all if its scripts fail to load, and vendor/ is one npm install
	 * away from being missing. There is no need for a date library to ask what
	 * hour it is.
	 *
	 * @returns {string} e.g. "2026-09-28"
	 */
	today: function () {
		const now = new Date();
		const pad = (n) => String(n).padStart(2, "0");
		return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	},

	start: function () {
		Log.info(`Starting module: ${this.name}`);

		this.currentIdentity = this.config.identityFallback || "unknown";
		this.lastIndex = -1;

		setInterval(() => {
			this.updateDom(this.config.fadeSpeed);
		}, Math.max(5000, this.config.updateInterval));
	},

	/**
	 * Which part of the day we are in.
	 *
	 * @returns {string} one of morning, afternoon, evening, night
	 */
	partOfDay: function () {
		const hour = new Date().getHours();
		const { morningStartTime, afternoonStartTime, eveningStartTime, nightStartTime } = this.config;

		if (hour >= morningStartTime && hour < afternoonStartTime) {
			return "morning";
		}
		if (hour >= afternoonStartTime && hour < eveningStartTime) {
			return "afternoon";
		}
		if (hour >= eveningStartTime && hour < nightStartTime) {
			return "evening";
		}

		return "night";
	},

	getDisplayName: function () {
		const names = this.config.identityDisplayNames;
		if (!names || typeof names !== "object") {
			return "";
		}

		return names[String(this.currentIdentity)] || "";
	},

	/**
	 * The greeting lines on offer right now: this person's own lines for this
	 * part of the day, then the generic ones, then anything for today's date.
	 *
	 * @returns {object[]} candidate {so, en} pairs
	 */
	greetingPool: function () {
		const part = this.partOfDay();
		const date = this.today();
		const profile = this.config.identityGreetings && typeof this.config.identityGreetings === "object" ? this.config.identityGreetings[String(this.currentIdentity)] : null;
		const sources = [profile, this.config.greetings];
		const pool = [];

		const append = function (source, key) {
			if (source && Array.isArray(source[key])) {
				for (const entry of source[key]) {
					if (entry && entry.so) {
						pool.push(entry);
					}
				}
			}
		};

		for (const source of sources) {
			append(source, part);
		}

		// Nothing written for this part of the day — fall back to the all-day set.
		if (pool.length === 0) {
			for (const source of sources) {
				append(source, "anytime");
			}
		}

		for (const source of sources) {
			if (!source || typeof source !== "object") {
				continue;
			}
			for (const key of Object.keys(source)) {
				if (["morning", "afternoon", "evening", "night", "anytime"].includes(key)) {
					continue;
				}
				if (Array.isArray(source[key]) && new RegExp(key).test(date)) {
					append(source, key);
				}
			}
		}

		return pool;
	},

	/**
	 * Pick a line, avoiding the one just shown.
	 *
	 * @param {object[]} pool candidate greetings
	 * @returns {object} the chosen greeting
	 */
	choose: function (pool) {
		if (pool.length === 1) {
			this.lastIndex = 0;
			return pool[0];
		}

		let index;
		if (this.config.random) {
			do {
				index = Math.floor(Math.random() * pool.length);
			} while (index === this.lastIndex);
		} else {
			index = this.lastIndex >= pool.length - 1 ? 0 : this.lastIndex + 1;
		}

		this.lastIndex = index;
		return pool[index];
	},

	/**
	 * Substitute the recognised name, or remove the placeholder cleanly when
	 * there is nobody to name.
	 *
	 * @param {string} text a greeting template
	 * @param {string} name the display name, possibly empty
	 * @returns {string} the finished line
	 */
	fillName: function (text, name) {
		const value = String(text || "");
		if (name) {
			return value.replace(/\{name\}/gi, name);
		}

		return value
			.replace(/[,—-]?\s*\{name\}/gi, "")
			.replace(/\s{2,}/g, " ")
			.trim();
	},

	getDom: function () {
		const wrapper = document.createElement("div");
		wrapper.className = "greet";

		const pool = this.greetingPool();
		if (pool.length === 0) {
			return wrapper;
		}

		const greeting = this.choose(pool);
		const name = this.getDisplayName();

		const line = document.createElement("div");
		line.className = "greet-line";

		const somali = document.createElement("span");
		somali.className = "greet-so";
		somali.textContent = this.fillName(greeting.so, name);
		line.appendChild(somali);

		if (this.config.showEnglish && greeting.en) {
			const english = document.createElement("span");
			english.className = "greet-en";
			english.textContent = this.fillName(greeting.en, name);
			line.appendChild(english);
		}

		wrapper.appendChild(line);

		if (this.config.showRule) {
			const rule = document.createElement("div");
			rule.className = "greet-rule";
			wrapper.appendChild(rule);
		}

		return wrapper;
	},

	notificationReceived: function (notification, payload) {
		if (notification !== this.config.identityNotification) {
			return;
		}

		const next = payload && payload.identity ? String(payload.identity) : this.config.identityFallback || "unknown";
		if (next === this.currentIdentity) {
			return;
		}

		this.currentIdentity = next;
		this.lastIndex = -1;
		this.updateDom(500);
	}
});
