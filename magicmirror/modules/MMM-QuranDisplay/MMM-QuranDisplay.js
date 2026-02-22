/* Magic Mirror
 * Module: MMM-QuranDisplay
 * Compact Quran playback display for Verse Chainer
 * Receives updates via socket notifications from quran_chainer.py
 * MIT Licensed.
 */

Module.register("MMM-QuranDisplay", {
	defaults: {
		showVerseNumber: true,
		showSurahName: true,
		showBismillah: true,
		hideBismillahForSurah9: true,
		bismillahText: "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ",
		ayahLabelFormat: "ayah", // "ayah" => "Ayah X / Y", "compact" => "X:Y"
		animationSpeed: 500,
		fontSize: {
			info: "1.1em"
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
		this.isProcessing = false;

		this.sendSocketNotification("MODULE_READY", {
			config: this.config
		});
	},

	formatAyahLabel: function () {
		const surahNum = this.currentVerse?.surah || "";
		const verseNum = this.currentVerse?.verse || "";
		const totalVerses = this.surahInfo ? this.surahInfo.totalVerses : "";
		const format = String(this.config.ayahLabelFormat || "ayah").toLowerCase();

		if (format === "compact") {
			return `${surahNum}:${verseNum}`;
		}
		return `Ayah ${verseNum}${totalVerses ? ` / ${totalVerses}` : ""}`;
	},

	shouldShowBismillah: function () {
		if (!this.config.showBismillah) {
			return false;
		}
		const currentSurah = Number(this.currentVerse?.surah || 0);
		if (this.config.hideBismillahForSurah9 && currentSurah === 9) {
			return false;
		}
		return true;
	},

	renderStatusIndicators: function (wrapper) {
		if (!this.isRecording && !this.isProcessing && !this.isListening) {
			return;
		}

		const statusContainer = document.createElement("div");
		statusContainer.className = "status-indicators";

		if (this.isRecording) {
			const recordingDiv = document.createElement("div");
			recordingDiv.className = "recording-indicator";
			recordingDiv.innerHTML = '<span class="recording-dot" aria-hidden="true"></span><span class="status-text">Recording</span>';
			statusContainer.appendChild(recordingDiv);
		}

		if (this.isProcessing) {
			const processingDiv = document.createElement("div");
			processingDiv.className = "processing-indicator";
			processingDiv.innerHTML = '<span class="processing-dot" aria-hidden="true"></span><span class="status-text">Thinking</span>';
			statusContainer.appendChild(processingDiv);
		}

		if (this.isListening) {
			const listeningDiv = document.createElement("div");
			listeningDiv.className = "listening-indicator";
			listeningDiv.innerHTML = '<span class="mic-icon" aria-hidden="true"></span><span class="status-text">Listening</span>';
			statusContainer.appendChild(listeningDiv);
		}

		wrapper.appendChild(statusContainer);
	},

	getDom: function () {
		const wrapper = document.createElement("div");
		wrapper.className = "mmm-quran-display";

		if (!this.currentVerse) {
			const waitingDiv = document.createElement("div");
			waitingDiv.className = "waiting";
			if (this.isProcessing) {
				waitingDiv.textContent = "Processing request...";
			} else if (this.isRecording) {
				waitingDiv.textContent = "Listening to your request...";
			} else {
				waitingDiv.textContent = 'Say "Mo, play Surah Fatiha"';
			}
			wrapper.appendChild(waitingDiv);
			this.renderStatusIndicators(wrapper);
			return wrapper;
		}

		if (this.shouldShowBismillah()) {
			const bismillahDiv = document.createElement("div");
			bismillahDiv.className = "bismillah-line";
			bismillahDiv.textContent = this.config.bismillahText;
			wrapper.appendChild(bismillahDiv);
		}

		if (this.config.showSurahName) {
			const header = document.createElement("div");
			header.className = "surah-header";

			const arabicName = document.createElement("div");
			arabicName.className = "surah-arabic";
			arabicName.textContent = this.surahInfo?.arabicName || "";

			const englishName = document.createElement("div");
			englishName.className = "surah-english";
			englishName.textContent = this.surahInfo?.englishName || `Surah ${this.currentVerse.surah || ""}`;

			header.appendChild(arabicName);
			header.appendChild(englishName);
			wrapper.appendChild(header);
		}

		if (this.config.showVerseNumber) {
			const infoDiv = document.createElement("div");
			infoDiv.className = "verse-info";
			infoDiv.style.fontSize = this.config.fontSize.info;
			infoDiv.textContent = this.formatAyahLabel();
			wrapper.appendChild(infoDiv);
		}

		if (this.isPlaying) {
			const playingDiv = document.createElement("div");
			playingDiv.className = "playing-indicator";
			playingDiv.textContent = "Reciting";
			wrapper.appendChild(playingDiv);
		}

		this.renderStatusIndicators(wrapper);

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
		} else if (notification === "PROCESSING_STATUS") {
			this.isProcessing = payload.isProcessing;
			this.updateDom(0);
		}
	},

	notificationReceived: function (notification, payload, sender) {
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
