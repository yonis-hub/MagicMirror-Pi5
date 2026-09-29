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
		// Module-relative so the calligraphy never depends on a live network
		// fetch; an absolute http(s) or / URL is still honoured if configured.
		bismillahImageUrl: "assets/bismillah.svg",
		bismillahImageRetryCount: 4,
		bismillahImageRetryDelayMs: 3000,
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
		this.isStarting = false;
		this.isSpeaking = false;
		this.stageRailHoldUntil = 0;
		this.stageRailTimer = null;
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

	// Absolute URLs (remote or server-root) are used as-is; anything else is
	// treated as a path inside this module folder and served by MagicMirror.
	resolveBismillahImageUrl: function () {
		const raw = String(this.config.bismillahImageUrl || "").trim();
		if (!raw) {
			return "";
		}
		if (/^(https?:)?\/\//i.test(raw) || raw.startsWith("/")) {
			return raw;
		}
		return this.file(raw);
	},

	createBismillahImageNode: function () {
		const imageWrap = document.createElement("div");
		imageWrap.className = "bismillah-image-wrap";

		const image = document.createElement("img");
		image.className = "bismillah-image";
		image.alt = "Bismillah calligraphy";

		const imageUrl = this.resolveBismillahImageUrl();
		const maxRetries = Math.max(0, Number(this.config.bismillahImageRetryCount) || 0);
		const retryDelay = Math.max(250, Number(this.config.bismillahImageRetryDelayMs) || 3000);
		let attempt = 0;

		// Retry before degrading to the plain text line: a single transient
		// failure used to strand the calligraphy until the next browser restart.
		image.addEventListener("error", () => {
			if (attempt < maxRetries) {
				attempt += 1;
				Log.warn(`MMM-QuranDisplay: bismillah image failed, retry ${attempt}/${maxRetries}`);
				setTimeout(() => {
					image.src = `${imageUrl}${imageUrl.includes("?") ? "&" : "?"}retry=${attempt}`;
				}, retryDelay * attempt);
				return;
			}
			Log.error("MMM-QuranDisplay: bismillah image unavailable, falling back to text");
			const fallback = this.createBismillahTextNode();
			imageWrap.replaceWith(fallback);
		});

		image.src = imageUrl;
		imageWrap.appendChild(image);
		return imageWrap;
	},

	// The stages of one voice turn, in order. The rail draws all of them at
	// once: a single changing label tells you what is happening now, but not
	// whether anything is still coming — which is what makes a 4-second wait
	// feel like a hang. Seeing "Thinking" sit between a finished "Hearing you"
	// and a pending "Playing" reads as progress.
	voiceStages: [
		{ key: "hearing", label: "Hearing you" },
		{ key: "thinking", label: "Thinking" },
		{ key: "starting", label: "Starting" },
		{ key: "playing", label: "Playing" }
	],

	getVoiceStage: function () {
		if (this.isRecording) {
			return "hearing";
		}
		if (this.isProcessing) {
			return "thinking";
		}
		if (this.isStarting) {
			return "starting";
		}
		if (this.stageRailHoldUntil && Date.now() < this.stageRailHoldUntil) {
			return "playing";
		}
		return null;
	},

	holdStageRail: function () {
		const holdMs = 2500;
		this.stageRailHoldUntil = Date.now() + holdMs;
		clearTimeout(this.stageRailTimer);
		this.stageRailTimer = setTimeout(() => {
			this.stageRailHoldUntil = 0;
			this.updateDom(400);
		}, holdMs + 100);
	},

	buildStageRail: function (activeStage) {
		const rail = document.createElement("div");
		rail.className = "voice-stage-rail";
		const activeIndex = this.voiceStages.findIndex((stage) => stage.key === activeStage);

		this.voiceStages.forEach((stage, index) => {
			if (index > 0) {
				const link = document.createElement("span");
				link.className = "stage-link";
				link.dataset.state = index <= activeIndex ? "done" : "pending";
				rail.appendChild(link);
			}

			const step = document.createElement("div");
			step.className = "voice-stage";
			step.dataset.stage = stage.key;
			step.dataset.state = index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";

			const dot = document.createElement("span");
			dot.className = "stage-dot";
			dot.setAttribute("aria-hidden", "true");
			step.appendChild(dot);

			const label = document.createElement("span");
			label.className = "stage-label";
			label.textContent = stage.label;
			step.appendChild(label);

			rail.appendChild(step);
		});

		return rail;
	},

	renderAmbientGlow: function () {
		// A full-screen edge glow keyed to the current stage. The rail is only
		// legible up close; on a wall mirror this is the part you can read from
		// across the room. Mounted on <body> so it isn't clipped by the
		// module's own region.
		const stage = this.getVoiceStage();
		let glow = document.getElementById("mm-voice-ambient-glow");
		if (!stage) {
			if (glow) {
				glow.remove();
			}
			return;
		}
		if (!glow) {
			glow = document.createElement("div");
			glow.id = "mm-voice-ambient-glow";
			document.body.appendChild(glow);
		}
		glow.dataset.stage = stage;
	},

	renderStatusIndicators: function (wrapper) {
		const stage = this.getVoiceStage();
		const showAdhan = Boolean(this.config.showAdhanIndicator && this.adhanStatus?.isPlaying);
		// "Listening" is the resting state, so it only shows when no turn is in
		// flight — stacking it under the rail would contradict it.
		const showListening = Boolean(
			this.isListening && !stage && !showAdhan && !this.isSpeaking
		);

		if (!stage && !showListening && !showAdhan) {
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

		if (stage) {
			statusContainer.appendChild(this.buildStageRail(stage));
		} else if (showListening) {
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

	/**
	 * Whether there is a recitation worth showing the player for.
	 *
	 * `currentVerse` on its own is not enough to decide this. It outlives the
	 * audio: when the chainer exits, node_helper sends PLAYBACK_STATUS with
	 * isPlaying false but no CLEAR_DISPLAY, and a stop that zeroes the clock
	 * leaves it set too. The player then sat at 0:00 indefinitely instead of
	 * going back to the wake-word prompt.
	 *
	 * A genuinely paused track still counts — it has elapsed time on the clock
	 * and it is worth seeing where you left off. Only a track that is stopped
	 * *and* at zero is treated as idle.
	 *
	 * @returns {boolean} true when the media widget should be shown
	 */
	hasActivePlayback: function () {
		if (!this.currentVerse) {
			return false;
		}
		if (this.isPlaying) {
			return true;
		}
		return this.computePlaybackProgress().elapsedSec > 0;
	},

	getWaitingText: function () {
		if (this.isStarting) {
			return "Got it — cueing up the recitation.";
		}
		if (this.isProcessing) {
			return "Got that. Working out what you asked for...";
		}
		if (this.isRecording) {
			return "Listening — go ahead.";
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

		const phase = String(this.voiceTranscript?.phase || "").toLowerCase();
		const processed = String(this.voiceTranscript.text || "").trim();
		const raw = String(this.voiceTranscript.rawText || "").trim();
		const differsFromRaw = raw && raw.toLowerCase() !== processed.toLowerCase();

		const labelDiv = document.createElement("div");
		labelDiv.className = "voice-transcript-label";
		labelDiv.textContent = this.getTranscriptPhaseLabel();
		transcriptDiv.appendChild(labelDiv);

		// On a failed parse, show BOTH what Whisper heard and what the
		// normalizer turned it into — so the user can see the mistranslation
		// and add the mishear to the normalizer if it's a common one.
		if (phase === "unrecognized" && differsFromRaw) {
			const heardLabel = document.createElement("div");
			heardLabel.className = "voice-transcript-sub";
			heardLabel.textContent = "Heard";
			transcriptDiv.appendChild(heardLabel);

			const heardText = document.createElement("div");
			heardText.className = "voice-transcript-text voice-transcript-raw";
			heardText.textContent = `"${raw}"`;
			transcriptDiv.appendChild(heardText);

			const understoodLabel = document.createElement("div");
			understoodLabel.className = "voice-transcript-sub";
			understoodLabel.textContent = "Interpreted as";
			transcriptDiv.appendChild(understoodLabel);

			const understoodText = document.createElement("div");
			understoodText.className = "voice-transcript-text";
			understoodText.textContent = `"${processed}"`;
			transcriptDiv.appendChild(understoodText);
		} else {
			const textDiv = document.createElement("div");
			textDiv.className = "voice-transcript-text";
			textDiv.textContent = `"${processed}"`;
			transcriptDiv.appendChild(textDiv);
		}

		wrapper.appendChild(transcriptDiv);
	},

	getDom: function () {
		this.renderAmbientGlow();
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

		if (!this.hasActivePlayback()) {
			// The widget is not in the tree any more, so drop the refs the
			// half-second timer writes through rather than leaving it updating
			// detached nodes until something plays again.
			this._barFill = null;
			this._timeText = null;

			if (!hasAdhkarNowPlaying) {
				const waitingDiv = document.createElement("div");
				waitingDiv.className = "waiting";
				waitingDiv.textContent = this.getWaitingText();
				wrapper.appendChild(waitingDiv);
			}
			this.renderVoiceTranscript(wrapper);
		} else {
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
		}

		// Single status indicators render path, applied to both modes.
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
			// Every other status handler repaints; this one didn't, so the
			// "Thinking" indicator was set but never drawn — the UI went quiet
			// for exactly the seconds the user most needs to see it working.
			this.isProcessing = Boolean(payload && payload.isProcessing);
			this.updateDom(0);
		} else if (notification === "STARTING_STATUS") {
			const wasStarting = this.isStarting;
			this.isStarting = Boolean(payload && payload.isStarting);
			// Hold the rail on "Playing" for a beat after startup finishes, so
			// the turn visibly completes instead of the indicator just
			// vanishing mid-thought.
			if (wasStarting && !this.isStarting) {
				this.holdStageRail();
			}
			this.updateDom(0);
		} else if (notification === "VOICE_SPEAKING") {
			this.isSpeaking = Boolean(payload && payload.isSpeaking);
			this.renderSpeakingOverlay();
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
			const wasPlaying = !!this.adhkarStatus?.isPlaying;
			this.adhkarStatus = {
				isPlaying: Boolean(payload && payload.isPlaying),
				period: payload && payload.period ? payload.period : null,
				index: payload && payload.index ? payload.index : 0,
				total: payload && payload.total ? payload.total : 0,
				title: payload && payload.title ? payload.title : "",
				titleArabic: payload && payload.titleArabic ? payload.titleArabic : ""
			};
			this.updateDom(200);
			// Adhkar takes priority — mute voice while it plays and stop any
			// current recitation/TTS on the first transition to playing so the
			// two audio sources don't overlap.
			this.setVoiceMute(this.adhkarStatus.isPlaying, `adhkar:${this.adhkarStatus.period || "session"}`);
			if (this.adhkarStatus.isPlaying && !wasPlaying) {
				this.sendControlAction("stop");
			}
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
			const wasPlaying = !!this.adhanStatus?.isPlaying;
			this.adhanStatus = {
				isPlaying: Boolean(payload && payload.isPlaying),
				prayer: payload && payload.prayer ? String(payload.prayer) : "",
				reason: payload && payload.reason ? String(payload.reason) : ""
			};
			this.updateDom(0);
			// Adhan takes priority — mute voice + stop any current recitation
			// the first time we transition into playing so the adhan plays
			// cleanly without anything underneath it.
			this.setVoiceMute(this.adhanStatus.isPlaying, `adhan:${this.adhanStatus.prayer || "unknown"}`);
			if (this.adhanStatus.isPlaying && !wasPlaying) {
				this.sendControlAction("stop");
			}
		}
	},

	renderMediaWidget: function () {
		const widget = document.createElement("div");
		widget.className = "media-widget";

		// Hide the entire widget when there is no surah to display —
		// e.g. immediately after natural playback completion (the chainer
		// posts /api/quran/clear, which nulls surahInfo + currentVerse).
		if (!this.surahInfo && !this.currentVerse) {
			widget.style.display = "none";
			widget.setAttribute("aria-hidden", "true");
			return widget;
		}

		// Laid out like MMM-WordOfTheDay: a small letter-spaced title, a
		// two-tone main line, a dimmed supporting line, then the meta row.
		const span = (className, text) => {
			const el = document.createElement("span");
			el.className = className;
			el.textContent = text;
			return el;
		};

		// ---- Title ----
		const head = document.createElement("div");
		head.className = "media-head";
		const label = document.createElement("span");
		label.className = "media-label";
		label.appendChild(span("media-label-so", "Akhriska Hadda"));
		label.appendChild(span("media-mid", "·"));
		label.appendChild(span("media-label-en", "Now Playing"));
		head.appendChild(label);
		widget.appendChild(head);

		// ---- Arabic · English, with the verse counter as a quiet aside ----
		const surahNum = this.currentVerse?.surah;
		const englishTitle = this.surahInfo?.englishName || (surahNum ? `Surah ${surahNum}` : "");
		const arabicTitle = this.surahInfo?.arabicName || "";

		const main = document.createElement("div");
		main.className = "media-main";
		if (arabicTitle) {
			main.appendChild(span("media-arabic", arabicTitle));
		}
		if (arabicTitle && englishTitle) {
			main.appendChild(span("media-mid", "·"));
		}
		if (englishTitle) {
			main.appendChild(span("media-english", englishTitle));
		}
		if (this.config.showVerseNumber && this.currentVerse?.verse && this.surahInfo?.totalVerses) {
			main.appendChild(span("media-verse", `[${this.formatAyahLabel()}]`));
		}
		widget.appendChild(main);

		if (this.surahInfo?.reciter) {
			const reciter = document.createElement("div");
			reciter.className = "media-reciter";
			reciter.appendChild(span("media-reciter-label", "Qaariga"));
			reciter.appendChild(span("media-mid", "—"));
			reciter.appendChild(span("media-reciter-name", this.surahInfo.reciter));
			widget.appendChild(reciter);
		}

		// ---- Linear progress, in place of the old half-circle arc ----
		const { elapsedSec, totalSec, ratio } = this.computePlaybackProgress();

		const progress = document.createElement("div");
		progress.className = "media-progress";

		const bar = document.createElement("span");
		bar.className = "media-bar";
		const fill = document.createElement("span");
		fill.className = "media-bar-fill";
		fill.style.width = `${Math.round(ratio * 1000) / 10}%`;
		bar.appendChild(fill);
		progress.appendChild(bar);

		const timeText = span("media-time", `${this.formatClock(elapsedSec)} / ${this.formatClock(totalSec)}`);
		progress.appendChild(timeText);
		widget.appendChild(progress);

		// Refs the half-second timer ticks.
		this._barFill = fill;
		this._timeText = timeText;
		this.ensureProgressTimer();

		// ---- Output pill ----
		// No transport controls: playback is driven by voice ("Hey Jarvis, play
		// Surah 1"), so buttons on a mirror nobody touches were only noise.
		// sendControlAction() stays — the adhan handler still calls it to stop
		// recitation when the call to prayer starts.
		const ICON_BT =
			'<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
			'<path d="M6.5 6.5l11 11-5.5 5.5V1l5.5 5.5-11 11" fill="none" stroke="currentColor" ' +
			'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
			"</svg>";

		const footer = document.createElement("div");
		footer.className = "media-footer";

		// Same pill treatment as the word-of-the-day category tag.
		const tag = document.createElement("span");
		tag.className = "media-tag";
		const btIcon = document.createElement("span");
		btIcon.className = "media-tag-icon";
		btIcon.innerHTML = ICON_BT;
		tag.appendChild(btIcon);
		tag.appendChild(span("media-tag-text", "Bluetooth"));
		footer.appendChild(tag);

		widget.appendChild(footer);

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
			if (!this._barFill || !this._timeText) return;
			const { elapsedSec, totalSec, ratio } = this.computePlaybackProgress();
			this._barFill.style.width = `${Math.round(ratio * 1000) / 10}%`;
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

	renderSpeakingOverlay: function () {
		// Mounted directly on <body> so it isn't bound to this module's
		// region — sits as a fixed-position overlay just above the
		// compliments area (which lives in lower_third / bottom_bar).
		let overlay = document.getElementById("mm-voice-speaking-overlay");
		if (!overlay) {
			overlay = document.createElement("div");
			overlay.id = "mm-voice-speaking-overlay";
			overlay.className = "mm-voice-speaking-overlay";
			for (let i = 0; i < 5; i++) {
				const bar = document.createElement("span");
				bar.className = "mm-voice-bar";
				overlay.appendChild(bar);
			}
			document.body.appendChild(overlay);
		}
		overlay.classList.toggle("is-active", !!this.isSpeaking);
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
