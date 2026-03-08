/*
//-------------------------------------------
MMM-MyPrayerTime
Copyright (C) 2024 - H. Tilburgs
MIT License
//-------------------------------------------
*/

Module.register("MMM-MyPrayerTimes", {
	// Default values
	defaults: {
		mptLat: null,
		mptLon: null,
		mptMethod: 3,
		mptOffset: "0,0,0,0,0,0,0,0,0",
		showSunrise: true,
		showSunset: true,
		showMidnight: true,
		showImsak: true,
		show24Clock: true,
		showOnlyNext: false,
		showHijriDate: true,
		maxWidth: "500px",
		animationSpeed: 1000,
		initialLoadDelay: 1000,
		retryDelay: 2500,
		updateInterval: 60 * 60 * 1000,
		// Adhan audio settings
		playAdhan: true,
		adhanFile: "modules/MMM-MyPrayerTimes/adaan.mp3",
		adhanVolume: 0.8,
		adhanPrayers: ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"],
		adhanCheckInterval: 30 * 1000,
		adhanTriggerWindowMinutes: 1,
		// Adhkar autoplay settings
		autoPlayAdhkar: true,
		adhkarManifestFile: "adhkar_manifest.json",
		morningAdhkarTracks: [],
		eveningAdhkarTracks: [],
		adhkarVolume: 0.85,
		adhkarCheckInterval: 30 * 1000,
		// Arbitration settings (avoid overlapping Quran/adhaan/adhkar audio)
		pauseQuranForAdhan: true,
		pauseQuranForAdhkar: true,
		resumeQuranAfterInterruptions: true,
		quranPauseNotification: "QURAN_PAUSE",
		quranResumeNotification: "QURAN_RESUME"
	},

	// Define required files
	getStyles: function () {
		return ["MMM-MyPrayerTimes.css"];
	},
	getTranslations: function () {
		return {
			en: "translations/en.json",
			nl: "translations/nl.json",
			tr: "translations/tr.json"
		};
	},

	start: function () {
		Log.info(`Starting module: ${this.name}`);

		this.url = "";
		this.currentDateKey = "";
		this.timingsDateKey = "";
		this.MPT = {};
		this.hijriDate = null;
		this.loaded = false;

		this.playedAdhanToday = {};
		this.playedAdhkarToday = {
			morning: null,
			evening: null
		};

		this.adhanAudio = null;
		this.activeAdhanPauseReason = null;
		this.adhkarAudio = null;
		this.adhkarTracks = {
			morning: [],
			evening: []
		};
		this.adhkarPlayback = {
			isPlaying: false,
			period: null,
			index: -1,
			total: 0
		};

		this.audioInterruptionReasons = new Set();

		this.updateTimer = null;
		this.adhanCheckTimer = null;
		this.adhkarCheckTimer = null;

		this.scheduleUpdate();

		if (this.config.playAdhan) {
			this.scheduleAdhanCheck();
		}

		if (this.config.autoPlayAdhkar) {
			this.sendSocketNotification("GET_ADHKAR_TRACKS", {
				adhkarManifestFile: this.config.adhkarManifestFile,
				morningAdhkarTracks: this.config.morningAdhkarTracks,
				eveningAdhkarTracks: this.config.eveningAdhkarTracks
			});
			this.scheduleAdhkarCheck();
		}
	},

	getDateKey: function (date) {
		const safeDate = date || new Date();
		const year = safeDate.getFullYear();
		const month = String(safeDate.getMonth() + 1).padStart(2, "0");
		const day = String(safeDate.getDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	},

	buildMptUrlForDate: function (date) {
		const safeDate = date || new Date();
		const day = String(safeDate.getDate()).padStart(2, "0");
		const month = String(safeDate.getMonth() + 1).padStart(2, "0");
		const year = safeDate.getFullYear();
		const dateStr = `${day}-${month}-${year}`;

		return (
			`https://api.aladhan.com/v1/timings/${dateStr}` +
			`?latitude=${this.config.mptLat}` +
			`&longitude=${this.config.mptLon}` +
			`&method=${this.config.mptMethod}` +
			`&tune=${this.config.mptOffset}`
		);
	},

	refreshMptUrlIfNeeded: function () {
		const now = new Date();
		const dateKey = this.getDateKey(now);
		if (this.url && this.currentDateKey === dateKey) {
			return;
		}

		this.currentDateKey = dateKey;
		this.url = this.buildMptUrlForDate(now);
	},

	parseTime: function (value) {
		if (!value) {
			return null;
		}

		const str = String(value);
		const match = str.match(/(\d{1,2}):(\d{2})/);
		if (!match) {
			return null;
		}

		const hours = Number(match[1]);
		const minutes = Number(match[2]);
		if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
			return null;
		}

		return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
	},

	timeToMinutes: function (value) {
		const normalized = this.parseTime(value);
		if (!normalized) {
			return null;
		}
		const [hours, minutes] = normalized.split(":").map(Number);
		return hours * 60 + minutes;
	},

	getVolume: function (value, fallback) {
		const numeric = Number(value);
		if (Number.isNaN(numeric)) {
			return fallback;
		}
		return Math.min(1, Math.max(0, numeric));
	},

	requestQuranPause: function (reason, enabledByConfig) {
		if (!enabledByConfig) {
			return;
		}

		const reasonKey = String(reason || "unknown");
		if (this.audioInterruptionReasons.has(reasonKey)) {
			return;
		}

		const shouldNotifyPause = this.audioInterruptionReasons.size === 0;
		this.audioInterruptionReasons.add(reasonKey);

		if (shouldNotifyPause) {
			this.sendNotification(this.config.quranPauseNotification, {
				source: this.name,
				reason: reasonKey
			});
		}
	},

	releaseQuranPause: function (reason) {
		const reasonKey = String(reason || "unknown");
		if (this.audioInterruptionReasons.has(reasonKey)) {
			this.audioInterruptionReasons.delete(reasonKey);
		}

		if (this.audioInterruptionReasons.size === 0 && this.config.resumeQuranAfterInterruptions) {
			this.sendNotification(this.config.quranResumeNotification, {
				source: this.name,
				reason: reasonKey
			});
		}
	},

	scheduleAdhanCheck: function () {
		this.checkAdhanTime();
		this.adhanCheckTimer = setInterval(() => this.checkAdhanTime(), this.config.adhanCheckInterval);
	},

	ensureTimingsForToday: function () {
		const todayKey = this.getDateKey(new Date());
		this.refreshMptUrlIfNeeded();
		if (this.timingsDateKey !== todayKey) {
			this.getMPT();
			return false;
		}
		return true;
	},

	cleanupPlayedAdhanCache: function (todayKey) {
		Object.keys(this.playedAdhanToday).forEach((cacheKey) => {
			if (!cacheKey.startsWith(todayKey)) {
				delete this.playedAdhanToday[cacheKey];
			}
		});
	},

	checkAdhanTime: function () {
		if (!this.loaded || !this.config.playAdhan) {
			return;
		}
		if (!this.ensureTimingsForToday()) {
			return;
		}

		const now = new Date();
		const nowMinutes = now.getHours() * 60 + now.getMinutes();
		const dayKey = this.getDateKey(now);
		const triggerWindow = Math.max(0, Number(this.config.adhanTriggerWindowMinutes) || 1);

		this.cleanupPlayedAdhanCache(dayKey);

		for (const prayerKey of this.config.adhanPrayers) {
			const prayerMinutes = this.timeToMinutes(this.MPT[prayerKey]);
			if (prayerMinutes === null) {
				continue;
			}

			const playbackKey = `${dayKey}-${prayerKey}`;
			if (this.playedAdhanToday[playbackKey]) {
				continue;
			}

			const inWindow = nowMinutes >= prayerMinutes && nowMinutes <= prayerMinutes + triggerWindow;
			if (!inWindow) {
				continue;
			}

			if (this.adhkarPlayback.isPlaying) {
				this.finishAdhkarPlayback("adhan-preempt");
			}

			Log.info(`MMM-MyPrayerTimes: Playing Adhan for ${prayerKey}`);
			this.playAdhan(prayerKey);
			this.playedAdhanToday[playbackKey] = true;
		}
	},

	playAdhan: function (prayerKey) {
		if (this.adhanAudio) {
			this.adhanAudio.pause();
			this.adhanAudio = null;
		}

		if (this.activeAdhanPauseReason) {
			this.releaseQuranPause(this.activeAdhanPauseReason);
			this.activeAdhanPauseReason = null;
		}

		const pauseReason = `adhan:${String(prayerKey || "unknown").toLowerCase()}`;
		this.requestQuranPause(pauseReason, this.config.pauseQuranForAdhan);
		this.activeAdhanPauseReason = pauseReason;

		const audio = new Audio(this.config.adhanFile);
		let finalized = false;
		const finalize = () => {
			if (finalized) {
				return;
			}
			finalized = true;
			if (this.adhanAudio === audio) {
				this.adhanAudio = null;
			}
			if (this.activeAdhanPauseReason === pauseReason) {
				this.releaseQuranPause(pauseReason);
				this.activeAdhanPauseReason = null;
			}
			this.sendAdhanStatus({
				isPlaying: false,
				prayer: prayerKey || "",
				reason: "finished"
			});
		};

		audio.volume = this.getVolume(this.config.adhanVolume, 0.8);
		audio.onended = () => finalize();
		audio.onerror = () => {
			Log.error(`MMM-MyPrayerTimes: Error while playing Adhan for ${prayerKey}`);
			finalize();
		};

		this.adhanAudio = audio;
		this.sendAdhanStatus({
			isPlaying: true,
			prayer: prayerKey || "",
			reason: "started"
		});
		audio.play().catch((error) => {
			Log.error(`MMM-MyPrayerTimes: Error playing Adhan: ${error}`);
			finalize();
		});
	},

	scheduleAdhkarCheck: function () {
		this.checkAdhkarAutoPlay();
		this.adhkarCheckTimer = setInterval(() => this.checkAdhkarAutoPlay(), this.config.adhkarCheckInterval);
	},

	shouldPlayAdhkarForPeriod: function (period, dayKey) {
		const tracks = this.adhkarTracks[period];
		return Array.isArray(tracks) && tracks.length > 0 && this.playedAdhkarToday[period] !== dayKey;
	},

	isWithinWindow: function (nowMinutes, startMinutes, endMinutes) {
		if (startMinutes === null || endMinutes === null) {
			return false;
		}
		return nowMinutes >= startMinutes && nowMinutes < endMinutes;
	},

	checkAdhkarAutoPlay: function () {
		if (!this.loaded || !this.config.autoPlayAdhkar || this.adhkarPlayback.isPlaying || this.adhanAudio) {
			return;
		}
		if (!this.ensureTimingsForToday()) {
			return;
		}

		const now = new Date();
		const dayKey = this.getDateKey(now);
		const nowMinutes = now.getHours() * 60 + now.getMinutes();

		const fajrMinutes = this.timeToMinutes(this.MPT.Fajr);
		const sunriseMinutes = this.timeToMinutes(this.MPT.Sunrise);
		const asrMinutes = this.timeToMinutes(this.MPT.Asr);
		const sunsetMinutes = this.timeToMinutes(this.MPT.Sunset);

		const inMorningWindow = this.isWithinWindow(nowMinutes, fajrMinutes, sunriseMinutes);
		if (inMorningWindow && this.shouldPlayAdhkarForPeriod("morning", dayKey)) {
			this.startAdhkarPlaylist("morning", dayKey);
			return;
		}

		const inEveningWindow = this.isWithinWindow(nowMinutes, asrMinutes, sunsetMinutes);
		if (inEveningWindow && this.shouldPlayAdhkarForPeriod("evening", dayKey)) {
			this.startAdhkarPlaylist("evening", dayKey);
		}
	},

	startAdhkarPlaylist: function (period, dayKey) {
		const tracks = this.adhkarTracks[period];
		if (!Array.isArray(tracks) || tracks.length === 0) {
			return;
		}

		this.playedAdhkarToday[period] = dayKey || this.getDateKey(new Date());
		this.adhkarPlayback = {
			isPlaying: true,
			period,
			index: 0,
			total: tracks.length
		};

		this.requestQuranPause("adhkar", this.config.pauseQuranForAdhkar);
		this.playAdhkarTrack(period, 0);
	},

	playAdhkarTrack: function (period, index) {
		const tracks = this.adhkarTracks[period];
		if (!Array.isArray(tracks) || index >= tracks.length) {
			this.finishAdhkarPlayback("complete");
			return;
		}

		const track = tracks[index];
		if (!track || !track.url) {
			this.playAdhkarTrack(period, index + 1);
			return;
		}

		if (this.adhkarAudio) {
			this.adhkarAudio.pause();
			this.adhkarAudio = null;
		}

		const total = tracks.length;
		const audio = new Audio(track.url);
		audio.volume = this.getVolume(this.config.adhkarVolume, 0.85);
		audio.onended = () => {
			if (this.adhkarAudio !== audio) {
				return;
			}
			this.playAdhkarTrack(period, index + 1);
		};
		audio.onerror = () => {
			if (this.adhkarAudio !== audio) {
				return;
			}
			Log.error(`MMM-MyPrayerTimes: Failed to play Adhkar track ${index + 1} (${track.url})`);
			this.playAdhkarTrack(period, index + 1);
		};

		this.adhkarAudio = audio;
		this.adhkarPlayback = {
			isPlaying: true,
			period,
			index,
			total
		};
		this.sendAdhkarStatus({
			isPlaying: true,
			period,
			index: index + 1,
			total,
			title: track.title || `${period} adhkar ${index + 1}`,
			titleArabic: track.titleArabic || "",
			url: track.url
		});

		audio.play().catch((error) => {
			Log.error(`MMM-MyPrayerTimes: Error playing Adhkar track ${index + 1}: ${error}`);
			if (this.adhkarAudio === audio) {
				this.playAdhkarTrack(period, index + 1);
			}
		});
	},

	finishAdhkarPlayback: function (reason) {
		if (this.adhkarAudio) {
			this.adhkarAudio.pause();
			this.adhkarAudio = null;
		}

		const wasPlaying = this.adhkarPlayback.isPlaying;
		this.adhkarPlayback = {
			isPlaying: false,
			period: null,
			index: -1,
			total: 0
		};

		if (wasPlaying) {
			this.sendAdhkarStatus({
				isPlaying: false,
				period: null,
				index: 0,
				total: 0,
				title: "",
				titleArabic: "",
				url: "",
				reason: String(reason || "")
			});
		}

		this.releaseQuranPause("adhkar");
	},

	sendAdhkarStatus: function (payload) {
		this.sendNotification("ADHKAR_STATUS", payload);
	},

	sendAdhanStatus: function (payload) {
		this.sendNotification("ADHAN_STATUS", payload);
	},

	getDisplayTime: function (value) {
		const normalized = this.parseTime(value);
		return normalized || value || "--:--";
	},

	getDom: function () {
		const wrapper = document.createElement("div");
		wrapper.className = "wrapper";
		wrapper.style.maxWidth = this.config.maxWidth;

		if (!this.loaded) {
			wrapper.innerHTML = "Loading....";
			wrapper.classList.add("bright", "light", "small");
			return wrapper;
		}

		// Display Hijri Date
		if (this.config.showHijriDate && this.hijriDate) {
			const hijriDiv = document.createElement("div");
			hijriDiv.className = "hijri-date bright";
			const hijriText = `${this.hijriDate.day} ${this.hijriDate.month.en}, ${this.hijriDate.year} AH`;
			const hijriArabic = `${this.hijriDate.month.ar} ${this.hijriDate.day}\u060C ${this.hijriDate.year}`;
			hijriDiv.innerHTML = `<span class="hijri-en">${hijriText}</span><br><span class="hijri-ar dimmed">${hijriArabic}</span>`;
			wrapper.appendChild(hijriDiv);
		}

		const table = document.createElement("table");
		table.className = "small";

		let prayerTimes = [
			{
				key: "Imsak",
				label: "IMSAK",
				arabic: "\u0627\u0644\u0625\u0645\u0633\u0627\u0643",
				show: this.config.showImsak
			},
			{ key: "Fajr", label: "FAJR", arabic: "\u0627\u0644\u0641\u062c\u0631" },
			{
				key: "Sunrise",
				label: "SUNRISE",
				arabic: "\u0634\u0631\u0648\u0642 \u0627\u0644\u0634\u0645\u0633",
				show: this.config.showSunrise
			},
			{ key: "Dhuhr", label: "DHUHR", arabic: "\u0627\u0644\u0638\u0647\u0631" },
			{ key: "Asr", label: "ASR", arabic: "\u0627\u0644\u0639\u0635\u0631" },
			{
				key: "Sunset",
				label: "SUNSET",
				arabic: "\u063a\u0631\u0648\u0628 \u0627\u0644\u0634\u0645\u0633",
				show: this.config.showSunset
			},
			{ key: "Maghrib", label: "MAGHRIB", arabic: "\u0627\u0644\u0645\u063a\u0631\u0628" },
			{ key: "Isha", label: "ISHA", arabic: "\u0627\u0644\u0639\u0634\u0627\u0621" },
			{
				key: "Midnight",
				label: "MIDNIGHT",
				arabic: "\u0645\u0646\u062a\u0635\u0641 \u0627\u0644\u0644\u064a\u0644",
				show: this.config.showMidnight
			}
		];

		// Filter to show only next prayer if configured
		if (this.config.showOnlyNext) {
			const now = new Date();
			const currentMinutes = now.getHours() * 60 + now.getMinutes();

			let nextPrayer = null;
			for (const prayer of prayerTimes) {
				if (prayer.show === false) {
					continue;
				}
				const prayerMinutes = this.timeToMinutes(this.MPT[prayer.key]);
				if (prayerMinutes === null) {
					continue;
				}
				if (prayerMinutes > currentMinutes) {
					nextPrayer = prayer;
					break;
				}
			}

			// If no next prayer found today, show first prayer (Fajr tomorrow)
			if (!nextPrayer) {
				nextPrayer = prayerTimes.find((prayer) => prayer.key === "Fajr");
			}
			prayerTimes = nextPrayer ? [nextPrayer] : [];
		}

		prayerTimes.forEach((prayer) => {
			if (prayer.show === false) {
				return;
			}
			const row = this.createPrayerRow(prayer.label, this.getDisplayTime(this.MPT[prayer.key]), prayer.arabic);
			table.appendChild(row);
		});

		wrapper.appendChild(table);
		return wrapper;
	},

	createPrayerRow: function (label, time, arabicText) {
		const row = document.createElement("tr");

		const textCell = document.createElement("td");
		textCell.className = `${label.toLowerCase()}-text`;
		textCell.innerHTML = this.translate(label);
		row.appendChild(textCell);

		const timeCell = document.createElement("td");
		timeCell.className = `${label.toLowerCase()}-time bright`;
		timeCell.innerHTML = this.config.show24Clock ? time : this.convert24Time(time);
		row.appendChild(timeCell);

		const arabicCell = document.createElement("td");
		arabicCell.className = `${label.toLowerCase()}-arab`;
		arabicCell.innerHTML = arabicText;
		row.appendChild(arabicCell);

		return row;
	},

	convert24Time: function (time) {
		if (!time) {
			return "--:--";
		}

		const normalized = this.parseTime(time);
		if (!normalized) {
			return time;
		}

		let [hours, minutes] = normalized.split(":").map(Number);
		const suffix = hours < 12 ? " AM" : " PM";
		hours = hours % 12 || 12;

		return `${hours}:${String(minutes).padStart(2, "0")}${suffix}`;
	},

	processMPT: function (data) {
		const incomingTimings = (data && data.timings) || {};
		const normalizedTimings = {};
		Object.keys(incomingTimings).forEach((key) => {
			const normalized = this.parseTime(incomingTimings[key]);
			normalizedTimings[key] = normalized || incomingTimings[key];
		});

		this.MPT = normalizedTimings;
		this.hijriDate = data ? data.hijri : null;
		this.loaded = true;
		this.timingsDateKey = this.currentDateKey || this.getDateKey(new Date());
	},

	scheduleUpdate: function () {
		this.getMPT();
		this.updateTimer = setInterval(() => this.getMPT(), this.config.updateInterval);
	},

	getMPT: function () {
		this.refreshMptUrlIfNeeded();
		if (!this.url) {
			return;
		}
		this.sendSocketNotification("GET_MPT", this.url);
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "MPT_RESULT") {
			this.processMPT(payload);
			this.updateDom(this.config.animationSpeed);
		} else if (notification === "ADHKAR_TRACKS") {
			const safePayload = payload && typeof payload === "object" ? payload : {};
			this.adhkarTracks = {
				morning: Array.isArray(safePayload.morning) ? safePayload.morning : [],
				evening: Array.isArray(safePayload.evening) ? safePayload.evening : []
			};
			Log.info(
				`MMM-MyPrayerTimes: Loaded adhkar tracks - morning: ${this.adhkarTracks.morning.length}, evening: ${this.adhkarTracks.evening.length}`
			);
		}
	}
});
