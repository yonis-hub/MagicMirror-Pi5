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
		bismillahText: "\u0628\u0650\u0633\u0652\u0645\u0650 \u0627\u0644\u0644\u064e\u0651\u0647\u0650 \u0627\u0644\u0631\u064e\u0651\u062d\u0652\u0645\u064e\u0646\u0650 \u0627\u0644\u0631\u064e\u0651\u062d\u0650\u064a\u0645\u0650",
		bismillahRenderMode: "image", // "text" or "image"
		bismillahImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Bismillah_Calligraphy6.svg",
		bismillahImageWidthPx: 250,
		bismillahImageFilter: "brightness(0) saturate(100%) invert(64%) sepia(55%) saturate(562%) hue-rotate(80deg) brightness(98%) contrast(90%)",
		bismillahImageBackgroundColor: "#000000",
		bismillahImagePaddingPx: 0,
		bismillahImageBorderRadiusPx: 0,
		arabicFontFamily: "\"Aref Ruqaa Ink\", \"Aref Ruqaa\", \"Scheherazade New\", Amiri, \"Traditional Arabic\", serif",
		arabicFontWeight: "700",
		showAdhkarNowPlaying: true,
		showVoiceTranscript: true,
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
		this.adhkarStatus = {
			isPlaying: false,
			period: null,
			index: 0,
			total: 0,
			title: "",
			titleArabic: ""
		};
		this.voiceTranscript = {
			text: "",
			phase: "idle",
			rawText: "",
			updatedAt: 0
		};

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

	createBismillahTextNode: function () {
		const bismillahDiv = document.createElement("div");
		bismillahDiv.className = "bismillah-line";
		bismillahDiv.textContent = this.config.bismillahText;
		return bismillahDiv;
	},

	createBismillahImageNode: function () {
		const imageWrap = document.createElement("div");
		imageWrap.className = "bismillah-image-wrap";

		const image = document.createElement("img");
		image.className = "bismillah-image";
		image.alt = "Bismillah calligraphy";
		image.src = this.config.bismillahImageUrl;
		image.addEventListener("error", () => {
			const fallback = this.createBismillahTextNode();
			imageWrap.replaceWith(fallback);
		});

		imageWrap.appendChild(image);
		return imageWrap;
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

	getAdhkarPeriodLabel: function () {
		if (!this.adhkarStatus || !this.adhkarStatus.period) {
			return "Adhkar";
		}
		const value = String(this.adhkarStatus.period).toLowerCase();
		if (value === "morning") {
			return "Morning Adhkar";
		}
		if (value === "evening") {
			return "Evening Adhkar";
		}
		return "Adhkar";
	},

	renderAdhkarNowPlaying: function (wrapper) {
		if (!this.config.showAdhkarNowPlaying || !this.adhkarStatus?.isPlaying) {
			return false;
		}

		const adhkarDiv = document.createElement("div");
		adhkarDiv.className = "adhkar-now-playing";

		const periodDiv = document.createElement("div");
		periodDiv.className = "adhkar-period";
		periodDiv.textContent = this.getAdhkarPeriodLabel();
		adhkarDiv.appendChild(periodDiv);

		const titleDiv = document.createElement("div");
		titleDiv.className = "adhkar-title";
		titleDiv.textContent = this.adhkarStatus.title || "Adhkar";
		adhkarDiv.appendChild(titleDiv);

		if (this.adhkarStatus.titleArabic) {
			const titleArabicDiv = document.createElement("div");
			titleArabicDiv.className = "adhkar-title-arabic";
			titleArabicDiv.textContent = this.adhkarStatus.titleArabic;
			adhkarDiv.appendChild(titleArabicDiv);
		}

		if (this.adhkarStatus.total > 0) {
			const trackDiv = document.createElement("div");
			trackDiv.className = "adhkar-track-number";
			trackDiv.textContent = `${this.adhkarStatus.index} / ${this.adhkarStatus.total}`;
			adhkarDiv.appendChild(trackDiv);
		}

		wrapper.appendChild(adhkarDiv);
		return true;
	},

	getWaitingText: function () {
		if (this.isProcessing) {
			return "Hold on... finding your request.";
		}
		if (this.isRecording) {
			return "Recording command...";
		}
		return 'Say "Mo, play Surah 1"';
	},

	getTranscriptPhaseLabel: function () {
		const phase = String(this.voiceTranscript?.phase || "").toLowerCase();
		if (phase === "processing") {
			return "Heard";
		}
		if (phase === "unrecognized") {
			return "Could not parse";
		}
		if (phase === "wake") {
			return "Wake word";
		}
		return "Recorded";
	},

	renderVoiceTranscript: function (wrapper) {
		if (!this.config.showVoiceTranscript || !this.voiceTranscript?.text) {
			return;
		}

		const transcriptDiv = document.createElement("div");
		transcriptDiv.className = "voice-transcript";

		const labelDiv = document.createElement("div");
		labelDiv.className = "voice-transcript-label";
		labelDiv.textContent = this.getTranscriptPhaseLabel();
		transcriptDiv.appendChild(labelDiv);

		const textDiv = document.createElement("div");
		textDiv.className = "voice-transcript-text";
		textDiv.textContent = `"${this.voiceTranscript.text}"`;
		transcriptDiv.appendChild(textDiv);

		wrapper.appendChild(transcriptDiv);
	},

	getDom: function () {
		const wrapper = document.createElement("div");
		wrapper.className = "mmm-quran-display";
		const imageWidth = Number.isFinite(Number(this.config.bismillahImageWidthPx)) ? Math.max(140, Number(this.config.bismillahImageWidthPx)) : 250;
		const imagePadding = Number.isFinite(Number(this.config.bismillahImagePaddingPx)) ? Math.max(0, Number(this.config.bismillahImagePaddingPx)) : 0;
		const imageRadius = Number.isFinite(Number(this.config.bismillahImageBorderRadiusPx)) ? Math.max(0, Number(this.config.bismillahImageBorderRadiusPx)) : 0;
		wrapper.style.setProperty("--quran-arabic-font-family", String(this.config.arabicFontFamily || "\"Aref Ruqaa Ink\", \"Aref Ruqaa\", \"Scheherazade New\", Amiri, \"Traditional Arabic\", serif"));
		wrapper.style.setProperty("--quran-arabic-font-weight", String(this.config.arabicFontWeight || "700"));
		wrapper.style.setProperty("--quran-bismillah-image-width", `${imageWidth}px`);
		wrapper.style.setProperty("--quran-bismillah-image-filter", String(this.config.bismillahImageFilter || ""));
		wrapper.style.setProperty("--quran-bismillah-image-bg", String(this.config.bismillahImageBackgroundColor || "#000000"));
		wrapper.style.setProperty("--quran-bismillah-image-padding", `${imagePadding}px`);
		wrapper.style.setProperty("--quran-bismillah-image-radius", `${imageRadius}px`);

		const hasAdhkarNowPlaying = this.renderAdhkarNowPlaying(wrapper);

		if (!this.currentVerse) {
			if (!hasAdhkarNowPlaying) {
				const waitingDiv = document.createElement("div");
				waitingDiv.className = "waiting";
				waitingDiv.textContent = this.getWaitingText();
				wrapper.appendChild(waitingDiv);
			}
			this.renderVoiceTranscript(wrapper);
			this.renderStatusIndicators(wrapper);
			return wrapper;
		}

		if (this.shouldShowBismillah()) {
			const renderMode = String(this.config.bismillahRenderMode || "text").toLowerCase();
			if (renderMode === "image" && this.config.bismillahImageUrl) {
				wrapper.appendChild(this.createBismillahImageNode());
			} else {
				wrapper.appendChild(this.createBismillahTextNode());
			}
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
		} else if (notification === "VOICE_TRANSCRIPT") {
			this.voiceTranscript = {
				text: payload && payload.text ? payload.text : "",
				phase: payload && payload.phase ? payload.phase : "idle",
				rawText: payload && payload.rawText ? payload.rawText : "",
				updatedAt: payload && payload.updatedAt ? payload.updatedAt : Date.now()
			};
			this.updateDom(0);
		}
	},

	notificationReceived: function (notification, payload) {
		if (notification === "ADHKAR_STATUS") {
			this.adhkarStatus = {
				isPlaying: Boolean(payload && payload.isPlaying),
				period: payload && payload.period ? payload.period : null,
				index: payload && payload.index ? payload.index : 0,
				total: payload && payload.total ? payload.total : 0,
				title: payload && payload.title ? payload.title : "",
				titleArabic: payload && payload.titleArabic ? payload.titleArabic : ""
			};
			this.updateDom(200);
		} else if (notification === "QURAN_PLAY_SURAH") {
			const safePayload = payload && typeof payload === "object" ? payload : {};
			if (!safePayload.surah) {
				return;
			}
			this.sendSocketNotification("PLAY_SURAH", {
				surah: safePayload.surah,
				startVerse: safePayload.startVerse || 1
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
