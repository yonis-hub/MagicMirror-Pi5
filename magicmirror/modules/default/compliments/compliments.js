/* MagicMirror²
 * Module: Compliments
 *
 * By Michael Teeuw https://michaelteeuw.nl
 * MIT Licensed.
 */
Module.register("compliments", {
	// Module config defaults.
	defaults: {
		compliments: {
			anytime: [
				"Dhoolla-caddeyntaadu waa iftiin.",
				"Qalbigaagu waa naxariis.",
				"Codkaaga waa deggan yahay.",
				"Dadaalkaaga maanta waa qiimo.",
				"Ilaahay ha kuu fududeeyo arrimahaaga."
			],
			morning: [
				"Subax wanaagsan.",
				"Ilaahay ha ka dhigo maanta maalin khayr leh.",
				"Maalinta ku bilow niyad wanaagsan.",
				"Hurdadaadii ma kuu fiicnayd?",
				"Waxaad u muuqataa firfircoon saaka."
			],
			afternoon: [
				"Galab wanaagsan.",
				"Shaqadaadii maanta si fiican bay u socotaa.",
				"Nasiino yar qaado, waad mutaysatay.",
				"Ilaahay ha kuu barakeeyo galabta."
			],
			evening: [
				"Fiid wanaagsan.",
				"Maalin wanaagsan baad qabatay, alxamdulillaah.",
				"Habeen deggan oo barako leh ha kuu noqdo.",
				"Naso, berri waa fursad cusub."
			],
			"....-01-01": ["Sanad cusub oo wanaagsan!"]
		},
		updateInterval: 30000,
		remoteFile: null,
		fadeSpeed: 4000,
		morningStartTime: 5,
		morningEndTime: 12,
		afternoonStartTime: 12,
		afternoonEndTime: 18,
		random: true,
		identityNotification: "FACE_IDENTITY_UPDATE",
		identityFallback: "unknown",
		identityDisplayNames: {},
		identityProfiles: {}
	},
	lastIndexUsed: -1,
	// Set currentweather from module
	currentWeatherType: "",

	// Define required scripts.
	getScripts: function () {
		return ["moment.js"];
	},

	// Define styles.
	getStyles: function () {
		return ["compliments.css"];
	},

	// Define start sequence.
	start: async function () {
		Log.info(`Starting module: ${this.name}`);

		this.lastComplimentIndex = -1;
		this.currentIdentity = this.config.identityFallback || "unknown";

		if (this.config.remoteFile !== null) {
			const response = await this.loadComplimentFile();
			this.config.compliments = JSON.parse(response);
			this.updateDom();
		}

		// Schedule update timer.
		setInterval(() => {
			this.updateDom(this.config.fadeSpeed);
		}, this.config.updateInterval);
	},

	getIdentityProfile: function () {
		const profiles = this.config.identityProfiles;
		if (!profiles || typeof profiles !== "object") {
			return {};
		}

		const activeIdentity = String(this.currentIdentity || this.config.identityFallback || "unknown");
		const profile = profiles[activeIdentity];
		if (!profile || typeof profile !== "object") {
			return {};
		}

		return profile;
	},

	appendCompliments: function (target, source, key) {
		if (!source || !Array.isArray(source[key])) {
			return;
		}

		Array.prototype.push.apply(target, source[key]);
	},

	appendSpecialDayCompliments: function (target, source, date) {
		if (!source || typeof source !== "object") {
			return;
		}

		for (let entry in source) {
			if (Array.isArray(source[entry]) && new RegExp(entry).test(date)) {
				Array.prototype.push.apply(target, source[entry]);
			}
		}
	},

	getIdentityDisplayName: function () {
		const names = this.config.identityDisplayNames;
		if (!names || typeof names !== "object") {
			return "";
		}

		const activeIdentity = String(this.currentIdentity || this.config.identityFallback || "unknown");
		return names[activeIdentity] || "";
	},

	formatCompliment: function (text) {
		const displayName = this.getIdentityDisplayName();
		return String(text || "")
			.replace(/\{name\}/gi, displayName)
			.replace(/\{identity\}/gi, String(this.currentIdentity || this.config.identityFallback || "unknown"));
	},

	/**
	 * Generate a random index for a list of compliments.
	 *
	 * @param {string[]} compliments Array with compliments.
	 * @returns {number} a random index of given array
	 */
	randomIndex: function (compliments) {
		if (compliments.length === 1) {
			return 0;
		}

		const generate = function () {
			return Math.floor(Math.random() * compliments.length);
		};

		let complimentIndex = generate();

		while (complimentIndex === this.lastComplimentIndex) {
			complimentIndex = generate();
		}

		this.lastComplimentIndex = complimentIndex;

		return complimentIndex;
	},

	/**
	 * Retrieve an array of compliments for the time of the day.
	 *
	 * @returns {string[]} array with compliments for the time of the day.
	 */
	complimentArray: function () {
		const hour = moment().hour();
		const date = moment().format("YYYY-MM-DD");
		const identityProfile = this.getIdentityProfile();
		let compliments = [];
		const hasComplimentKey = (source, key) => source && Array.isArray(source[key]) && source[key].length > 0;

		// Add time of day compliments
		if (hour >= this.config.morningStartTime && hour < this.config.morningEndTime && (hasComplimentKey(identityProfile, "morning") || hasComplimentKey(this.config.compliments, "morning"))) {
			this.appendCompliments(compliments, identityProfile, "morning");
			this.appendCompliments(compliments, this.config.compliments, "morning");
		} else if (hour >= this.config.afternoonStartTime && hour < this.config.afternoonEndTime && (hasComplimentKey(identityProfile, "afternoon") || hasComplimentKey(this.config.compliments, "afternoon"))) {
			this.appendCompliments(compliments, identityProfile, "afternoon");
			this.appendCompliments(compliments, this.config.compliments, "afternoon");
		} else if (hasComplimentKey(identityProfile, "evening") || hasComplimentKey(this.config.compliments, "evening")) {
			this.appendCompliments(compliments, identityProfile, "evening");
			this.appendCompliments(compliments, this.config.compliments, "evening");
		}

		// Add compliments based on weather
		this.appendCompliments(compliments, identityProfile, this.currentWeatherType);
		this.appendCompliments(compliments, this.config.compliments, this.currentWeatherType);

		// Add compliments for anytime
		this.appendCompliments(compliments, identityProfile, "anytime");
		this.appendCompliments(compliments, this.config.compliments, "anytime");

		// Add compliments for special days
		this.appendSpecialDayCompliments(compliments, identityProfile, date);
		this.appendSpecialDayCompliments(compliments, this.config.compliments, date);

		return compliments;
	},

	/**
	 * Retrieve a file from the local filesystem
	 *
	 * @returns {Promise} Resolved when the file is loaded
	 */
	loadComplimentFile: async function () {
		const isRemote = this.config.remoteFile.indexOf("http://") === 0 || this.config.remoteFile.indexOf("https://") === 0,
			url = isRemote ? this.config.remoteFile : this.file(this.config.remoteFile);
		const response = await fetch(url);
		return await response.text();
	},

	/**
	 * Retrieve a random compliment.
	 *
	 * @returns {string} a compliment
	 */
	getRandomCompliment: function () {
		// get the current time of day compliments list
		const compliments = this.complimentArray();
		// variable for index to next message to display
		let index;
		// are we randomizing
		if (this.config.random) {
			// yes
			index = this.randomIndex(compliments);
		} else {
			// no, sequential
			// if doing sequential, don't fall off the end
			index = this.lastIndexUsed >= compliments.length - 1 ? 0 : ++this.lastIndexUsed;
		}

		return this.formatCompliment(compliments[index] || "");
	},

	// Override dom generator.
	getDom: function () {
		const wrapper = document.createElement("div");
		wrapper.className = this.config.classes ? this.config.classes : "thin xlarge bright pre-line";
		// get the compliment text
		const complimentText = this.getRandomCompliment();
		// split it into parts on newline text
		const parts = complimentText.split("\n");
		// create a span to hold the compliment
		const compliment = document.createElement("span");
		// process all the parts of the compliment text
		for (const part of parts) {
			if (part !== "") {
				// create a text element for each part
				compliment.appendChild(document.createTextNode(part));
				// add a break
				compliment.appendChild(document.createElement("BR"));
			}
		}
		// only add compliment to wrapper if there is actual text in there
		if (compliment.children.length > 0) {
			// remove the last break
			compliment.lastElementChild.remove();
			wrapper.appendChild(compliment);
		}
		return wrapper;
	},

	// Override notification handler.
	notificationReceived: function (notification, payload, sender) {
		if (notification === "CURRENTWEATHER_TYPE") {
			this.currentWeatherType = payload.type;
		} else if (notification === this.config.identityNotification) {
			const nextIdentity = payload && payload.identity ? String(payload.identity) : this.config.identityFallback || "unknown";
			if (nextIdentity !== this.currentIdentity) {
				this.currentIdentity = nextIdentity;
				this.lastComplimentIndex = -1;
				this.updateDom(500);
			}
		}
	}
});
