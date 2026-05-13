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
		showAdhanIndicator: true,
		adhanIndicatorLabel: "Adhan",
		adhanIndicatorIcon: "https://cdn-icons-png.flaticon.com/512/2918/2918161.png",
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
		this.adhanStatus = {
			isPlaying: false,
			prayer: "",
			reason: ""
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
		if (!this.isRecording && !this.isProcessing && !this.isListening && !this.adhanStatus?.isPlaying) {
			return;
		}

		const statusContainer = document.createElement("div");
		statusContainer.className = "status-indicators";

		if (this.config.showAdhanIndicator && this.adhanStatus?.isPlaying) {
			const adhanDiv = document.createElement("div");
			adhanDiv.className = "adhan-indicator";

			const iconSrc = String(this.config.adhanIndicatorIcon || "").trim();
			if (iconSrc) {
				const icon = document.createElement("img");
				icon.className = "adhan-icon";
				icon.src = iconSrc;
				icon.alt = "Adhan";
				adhanDiv.appendChild(icon);
			} else {
				const fallback = document.createElement("span");
				fallback.className = "adhan-icon-fallback";
				fallback.textContent = "🕌";
				adhanDiv.appendChild(fallback);
			}

			const statusText = document.createElement("span");
			statusText.className = "status-text";
			statusText.textContent = this.config.adhanIndicatorLabel || "Adhan";
			adhanDiv.appendChild(statusText);
			statusContainer.appendChild(adhanDiv);
		}

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

		if (this.isListening && !this.adhanStatus?.isPlaying) {
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
		return 'Say "Hey Jarvis, play Surah 1"';
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

		// Consolidated media-player widget: arc progress, time, BT, Arabic +
		// English surah names, reciter, controls.
		wrapper.appendChild(this.renderMediaWidget());

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
			const wasPlaying = this.isPlaying;
			this.isPlaying = payload.isPlaying;
			if (!this.isPlaying && wasPlaying) {
				// Captured the elapsed time so the arc/text don't reset on pause
				this.playbackPausedAtElapsedSec = this.computePlaybackProgress().elapsedSec;
			} else if (this.isPlaying && !wasPlaying && this.playbackPausedAtElapsedSec) {
				// Resumed: shift the start so elapsed continues from where we paused
				this.playbackStartMs = Date.now() - (this.playbackPausedAtElapsedSec * 1000);
				this.playbackPausedAtElapsedSec = 0;
			}
			this.updateDom(200);
		} else if (notification === "PLAYBACK_INFO") {
			// Sent by chainer at the start of a new surah: total duration + start time.
			// totalSec = 0 means "reset" (no active playback) — used by the
			// listener's stop_playback so the arc collapses cleanly.
			const total = Number(payload.totalSec) || 0;
			this.playbackTotalSec = total;
			if (total > 0) {
				this.playbackStartMs = Number(payload.startedAt) || Date.now();
			} else {
				this.playbackStartMs = 0;
				this.isPlaying = false;
			}
			this.playbackPausedAtElapsedSec = 0;
			this.updateDom(0);
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
		} else if (notification === "ADHAN_STATUS") {
			this.adhanStatus = {
				isPlaying: Boolean(payload && payload.isPlaying),
				prayer: payload && payload.prayer ? String(payload.prayer) : "",
				reason: payload && payload.reason ? String(payload.reason) : ""
			};
			this.updateDom(0);
			// Mute the voice listener for the duration of the adhan so wake
			// triggers don't get processed during prayer call.
			this.setVoiceMute(this.adhanStatus.isPlaying, `adhan:${this.adhanStatus.prayer || "unknown"}`);
		}
	},

	renderMediaWidget: function () {
		const widget = document.createElement("div");
		widget.className = "media-widget";

		// ---- Half-circle progress arc + time at the top ----
		const arcWrap = document.createElement("div");
		arcWrap.className = "media-arc-wrap";

		// SVG arc: 260x140 viewBox. Padding around the arc so rounded caps
		// don't get clipped or look uneven against the viewBox edges.
		const svgNS = "http://www.w3.org/2000/svg";
		const svg = document.createElementNS(svgNS, "svg");
		svg.setAttribute("viewBox", "0 0 260 140");
		svg.setAttribute("class", "media-arc");
		// Semicircle from (20,130) to (240,130), radius 110, bulging upward.
		const ARC_PATH_D = "M 20 130 A 110 110 0 0 1 240 130";
		const ARC_LEN = Math.PI * 110; // arc length for r=110

		const bg = document.createElementNS(svgNS, "path");
		bg.setAttribute("d", ARC_PATH_D);
		bg.setAttribute("class", "media-arc-bg");
		svg.appendChild(bg);

		const fg = document.createElementNS(svgNS, "path");
		fg.setAttribute("d", ARC_PATH_D);
		fg.setAttribute("class", "media-arc-fg");
		fg.setAttribute("stroke-dasharray", `${ARC_LEN}`);
		// Start fully hidden; computed below.
		fg.setAttribute("stroke-dashoffset", `${ARC_LEN}`);
		svg.appendChild(fg);

		const timeText = document.createElement("div");
		timeText.className = "media-time";
		arcWrap.appendChild(svg);
		arcWrap.appendChild(timeText);
		widget.appendChild(arcWrap);

		// Compute + apply current progress.
		const { elapsedSec, totalSec, ratio } = this.computePlaybackProgress();
		fg.setAttribute("stroke-dashoffset", `${ARC_LEN * (1 - ratio)}`);
		timeText.textContent = `${this.formatClock(elapsedSec)} / ${this.formatClock(totalSec)}`;

		// Keep refs for setInterval updates.
		this._arcFg = fg;
		this._arcLen = ARC_LEN;
		this._timeText = timeText;
		this.ensureProgressTimer();

		// ---- Bluetooth indicator (inline SVG so we don't depend on emoji fonts) ----
		const bt = document.createElement("div");
		bt.className = "media-bt-indicator";
		bt.innerHTML =
			'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
			'<path d="M6.5 6.5l11 11-5.5 5.5V1l5.5 5.5-11 11" ' +
			'fill="none" stroke="currentColor" stroke-width="2" ' +
			'stroke-linecap="round" stroke-linejoin="round"/>' +
			"</svg>";
		widget.appendChild(bt);

		// ---- Arabic + English names + reciter ----
		const arabicName = document.createElement("div");
		arabicName.className = "media-arabic";
		arabicName.textContent = this.surahInfo?.arabicName || "";
		widget.appendChild(arabicName);

		const englishName = document.createElement("div");
		englishName.className = "media-english";
		const surahNum = this.currentVerse?.surah;
		englishName.textContent = this.surahInfo?.englishName
			|| (surahNum ? `Surah ${surahNum}` : "");
		widget.appendChild(englishName);

		if (this.surahInfo?.reciter) {
			const reciterDiv = document.createElement("div");
			reciterDiv.className = "media-reciter";
			reciterDiv.textContent = `Recited by ${this.surahInfo.reciter}`;
			widget.appendChild(reciterDiv);
		}

		// Optional small verse counter
		if (this.config.showVerseNumber && this.currentVerse?.verse && this.surahInfo?.totalVerses) {
			const verseDiv = document.createElement("div");
			verseDiv.className = "media-verse-counter";
			verseDiv.textContent = this.formatAyahLabel();
			widget.appendChild(verseDiv);
		}

		// ---- Buttons row (inline SVG, crisp at any size) ----
		const SVG_HEAD = '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">';
		const SVG_TAIL = "</svg>";
		const ICON_PREV = SVG_HEAD +
			'<path d="M10 6v20M28 6L14 16l14 10z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
			SVG_TAIL;
		const ICON_NEXT = SVG_HEAD +
			'<path d="M22 6v20M4 6l14 10L4 26z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
			SVG_TAIL;
		const ICON_PLAY = SVG_HEAD +
			'<path d="M8 5l20 11L8 27z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
			SVG_TAIL;
		const ICON_PAUSE = SVG_HEAD +
			'<rect x="8" y="6" width="6" height="20" rx="1.5" fill="currentColor"/>' +
			'<rect x="18" y="6" width="6" height="20" rx="1.5" fill="currentColor"/>' +
			SVG_TAIL;
		// Replay: two arrows circling each other (Material 'autorenew' style).
		// Drawn in a 24x24 viewBox of its own so the geometry stays clean
		// regardless of the row's 32x32 button frame.
		const ICON_REPLAY =
			'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
			'<path d="M12 6V3L8 7l4 4V8c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 17.03 20 15.57 20 14c0-4.42-3.58-8-8-8z" fill="currentColor"/>' +
			'<path d="M12 20c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 9.74C4.46 10.97 4 12.43 4 14c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" fill="currentColor"/>' +
			"</svg>";

		const row = document.createElement("div");
		row.className = "media-buttons";
		const makeBtn = (id, label, svg, action) => {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = `media-btn media-btn-${id}`;
			btn.setAttribute("aria-label", label);
			btn.innerHTML = svg;
			btn.addEventListener("click", () => this.sendControlAction(action));
			return btn;
		};
		row.appendChild(makeBtn("prev", "Previous surah", ICON_PREV, "previous"));
		row.appendChild(makeBtn("replay", "Replay from start", ICON_REPLAY, "replay"));
		row.appendChild(makeBtn("play", this.isPlaying ? "Pause" : "Play",
			this.isPlaying ? ICON_PAUSE : ICON_PLAY, "toggle"));
		row.appendChild(makeBtn("next", "Next surah", ICON_NEXT, "next"));
		widget.appendChild(row);

		return widget;
	},

	computePlaybackProgress: function () {
		// Prefer real duration reported by the chainer; otherwise estimate.
		const totalSec = Number(this.playbackTotalSec) || 0;
		let elapsedSec = 0;
		if (this.isPlaying && this.playbackStartMs) {
			elapsedSec = (Date.now() - this.playbackStartMs) / 1000 - (this.playbackPausedAccumSec || 0);
		} else if (this.playbackPausedAtElapsedSec) {
			elapsedSec = this.playbackPausedAtElapsedSec;
		}
		if (elapsedSec < 0) elapsedSec = 0;
		if (totalSec > 0 && elapsedSec > totalSec) elapsedSec = totalSec;
		const ratio = totalSec > 0 ? elapsedSec / totalSec : 0;
		return { elapsedSec, totalSec, ratio };
	},

	formatClock: function (seconds) {
		seconds = Math.max(0, Math.floor(Number(seconds) || 0));
		const m = Math.floor(seconds / 60);
		const s = seconds % 60;
		return `${m}:${s.toString().padStart(2, "0")}`;
	},

	ensureProgressTimer: function () {
		if (this._progressTimer) return;
		this._progressTimer = setInterval(() => {
			if (!this._arcFg || !this._timeText) return;
			const { elapsedSec, totalSec, ratio } = this.computePlaybackProgress();
			this._arcFg.setAttribute("stroke-dashoffset", `${this._arcLen * (1 - ratio)}`);
			this._timeText.textContent = `${this.formatClock(elapsedSec)} / ${this.formatClock(totalSec)}`;
		}, 500);
	},

	sendControlAction: function (action) {
		try {
			fetch("/api/quran/control", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action })
			}).catch(() => { /* ignore */ });
		} catch (e) { /* ignore */ }
	},

	setVoiceMute: function (muted, reason) {
		try {
			fetch("/api/quran/voice-mute", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ muted: !!muted, reason: reason || "external" })
			}).catch(() => { /* ignore network errors */ });
		} catch (e) {
			// Browser may not have fetch in older builds; silently ignore.
		}
	}
});
