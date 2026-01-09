/* Magic Mirror
 * Module: MMM-QuranDisplay
 * Minimalist verse display for Verse Chainer
 * Receives updates via socket notifications from quran_chainer.py
 * MIT Licensed.
 */

Module.register("MMM-QuranDisplay", {
	defaults: {
		showArabic: true,
		showTranslation: true,
		showVerseNumber: true,
		showSurahName: true,
		animationSpeed: 500,
		fontSize: {
			arabic: "2.5em",
			translation: "1.2em",
			info: "0.9em"
		}
	},

	getStyles: function () {
		return [this.file("MMM-QuranDisplay.css")];
	},

	start: function () {
		Log.info(`Starting module: ${this.name}`);
		this.currentVerse = null;
		this.isPlaying = false;
		this.surahInfo = null;
		this.isListening = false;
		this.isRecording = false;

		this.sendSocketNotification("MODULE_READY", {
			config: this.config
		});
	},

	getDom: function () {
		const wrapper = document.createElement("div");
		wrapper.className = "mmm-quran-display";

		if (!this.currentVerse) {
			wrapper.innerHTML = '<div class="waiting">Say "Play Surah Fatiha" to begin</div>';
			return wrapper;
		}

		// Surah header
		if (this.config.showSurahName && this.surahInfo) {
			const header = document.createElement("div");
			header.className = "surah-header";
			header.innerHTML = `<span class="surah-arabic">${this.surahInfo.arabicName}</span> <span class="surah-english">${this.surahInfo.englishName}</span>`;
			wrapper.appendChild(header);
		}

		// Arabic text
		if (this.config.showArabic && this.currentVerse.arabic) {
			const arabicDiv = document.createElement("div");
			arabicDiv.className = "verse-arabic";
			arabicDiv.style.fontSize = this.config.fontSize.arabic;
			arabicDiv.innerHTML = this.currentVerse.arabic;
			wrapper.appendChild(arabicDiv);
		}

		// Translation
		if (this.config.showTranslation && this.currentVerse.translation) {
			const translationDiv = document.createElement("div");
			translationDiv.className = "verse-translation";
			translationDiv.style.fontSize = this.config.fontSize.translation;
			translationDiv.textContent = this.currentVerse.translation;
			wrapper.appendChild(translationDiv);
		}

		// Verse info
		if (this.config.showVerseNumber) {
			const infoDiv = document.createElement("div");
			infoDiv.className = "verse-info";
			infoDiv.style.fontSize = this.config.fontSize.info;
			const surahNum = this.currentVerse.surah || "";
			const verseNum = this.currentVerse.verse || "";
			const totalVerses = this.surahInfo ? this.surahInfo.totalVerses : "";
			infoDiv.textContent = `Verse ${verseNum}${totalVerses ? ` of ${totalVerses}` : ""}`;
			wrapper.appendChild(infoDiv);
		}

		// Playing indicator
		if (this.isPlaying) {
			const playingDiv = document.createElement("div");
			playingDiv.className = "playing-indicator";
			playingDiv.innerHTML = "🔊 Playing...";
			wrapper.appendChild(playingDiv);
		}

		// Listening indicator
		if (this.isListening) {
			const listeningDiv = document.createElement("div");
			listeningDiv.className = "listening-indicator";
			listeningDiv.innerHTML = "🎤 Listening...";
			wrapper.appendChild(listeningDiv);
		}

		// Recording indicator
		if (this.isRecording) {
			const recordingDiv = document.createElement("div");
			recordingDiv.className = "recording-indicator";
			recordingDiv.innerHTML = `<span class="recording-dot"></span> Recording`;
			wrapper.appendChild(recordingDiv);
		}

		return wrapper;
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "VERSE_UPDATE") {
			this.currentVerse = {
				arabic: payload.arabic,
				translation: payload.translation,
				surah: payload.surah,
				verse: payload.verse
			};
			this.surahInfo = payload.surahInfo || this.surahInfo;
			this.isPlaying = payload.isPlaying || false;
			this.updateDom(this.config.animationSpeed);
			Log.info(`MMM-QuranDisplay: Updated verse ${payload.surah}:${payload.verse}`);
		} else if (notification === "PLAYBACK_STATUS") {
			this.isPlaying = payload.isPlaying;
			this.updateDom(200);
		} else if (notification === "CLEAR_DISPLAY") {
			this.currentVerse = null;
			this.surahInfo = null;
			this.isPlaying = false;
			this.updateDom(this.config.animationSpeed);
		} else if (notification === "LISTENING_STATUS") {
			this.isListening = payload.isListening;
			this.updateDom(200);
		} else if (notification === "RECORDING_STATUS") {
			this.isRecording = payload.isRecording;
			this.updateDom(0);
		}
	},

	notificationReceived: function (notification, payload, sender) {
		// Handle voice commands from Google Assistant or other modules
		if (notification === "QURAN_PLAY_SURAH") {
			this.sendSocketNotification("PLAY_SURAH", {
				surah: payload.surah,
				startVerse: payload.startVerse || 1
			});
		} else if (notification === "QURAN_STOP") {
			this.sendSocketNotification("STOP_PLAYBACK", {});
		} else if (notification === "QURAN_PAUSE") {
			this.sendSocketNotification("PAUSE_PLAYBACK", {});
		} else if (notification === "QURAN_RESUME") {
			this.sendSocketNotification("RESUME_PLAYBACK", {});
		}
	}
});
