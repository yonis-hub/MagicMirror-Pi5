/* MagicMirror
 * Module: MMM-FaceIdentity
 * Local-only face identity publisher for personalized compliments.
 * MIT Licensed.
 */

Module.register("MMM-FaceIdentity", {
	defaults: {
		broadcastNotification: "FACE_IDENTITY_UPDATE",
		identityFallback: "unknown",
		showPreview: false,
		previewWidth: 220,
		previewHeight: 124,
		previewIntervalMs: 2500,
		previewQuality: 60,
		previewMirror: false,
		previewLabel: "Camera",
		showPreviewIdentity: true,
		identityDisplayNames: {},
		hidePreviewWhenCovered: true,
		coverBrightnessThreshold: 18,
		coverStddevThreshold: 12,
		cameraIndex: 0,
		cameraDevice: "",
		frameWidth: 320,
		frameHeight: 240,
		scanIntervalMs: 2500,
		requiredMatches: 2,
		recallHoldMs: 25000,
		unknownHoldMs: 8000,
		matchThreshold: 0.46,
		labels: ["yonis", "hodan"],
		dataFile: "data/encodings.json",
		pythonBinary: "python3",
		venvBinary: "venv/bin/python3",
		detectorModel: "hog",
		debug: false
	},

	getStyles: function () {
		return [this.file("MMM-FaceIdentity.css")];
	},

	start: function () {
		Log.info(`Starting module: ${this.name}`);
		this.identityState = {
			identity: this.config.identityFallback,
			detectedIdentity: this.config.identityFallback,
			labels: [],
			faceCount: 0,
			confidence: 0,
			available: false,
			configured: false,
			secureLocalOnly: true,
			error: "",
			cameraCovered: false,
			updatedAt: Date.now()
		};
		this.previewState = {
			src: "",
			format: "image/jpeg",
			width: this.config.previewWidth,
			height: this.config.previewHeight,
			updatedAt: 0
		};
		this.lastBroadcastSignature = "";

		this.sendSocketNotification("MODULE_READY", {
			config: this.config
		});
	},

	getDom: function () {
		const wrapper = document.createElement("div");
		wrapper.className = "mmm-face-identity";

		if (!this.config.showPreview) {
			wrapper.style.display = "none";
			wrapper.setAttribute("aria-hidden", "true");
			return wrapper;
		}

		if (this.config.hidePreviewWhenCovered && this.identityState.cameraCovered) {
			wrapper.style.display = "none";
			wrapper.setAttribute("aria-hidden", "true");
			return wrapper;
		}

		const card = document.createElement("div");
		card.className = "face-preview-card";
		card.style.setProperty("--face-preview-width", `${Number(this.config.previewWidth) || 220}px`);

		const header = document.createElement("div");
		header.className = "face-preview-header";

		const label = document.createElement("div");
		label.className = "face-preview-label";
		label.textContent = this.config.previewLabel || "Camera";
		header.appendChild(label);

		if (this.config.showPreviewIdentity) {
			const identity = document.createElement("div");
			identity.className = "face-preview-identity";
			identity.textContent = this.getIdentityLabel();
			header.appendChild(identity);
		}

		card.appendChild(header);

		const viewport = document.createElement("div");
		viewport.className = "face-preview-viewport";
		if (this.config.previewMirror) {
			viewport.classList.add("face-preview-mirror");
		}

		if (this.previewState.src) {
			const image = document.createElement("img");
			image.className = "face-preview-image";
			image.src = this.previewState.src;
			image.alt = "Local webcam preview";
			card.appendChild(viewport);
			viewport.appendChild(image);
		} else {
			const placeholder = document.createElement("div");
			placeholder.className = "face-preview-placeholder";
			placeholder.textContent = this.identityState.error || "Waiting for local camera preview...";
			card.appendChild(viewport);
			viewport.appendChild(placeholder);
		}

		const hud = document.createElement("div");
		hud.className = "face-preview-hud";
		hud.setAttribute("aria-hidden", "true");
		viewport.appendChild(hud);

		wrapper.appendChild(card);
		return wrapper;
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "FACE_IDENTITY_STATE") {
			this.identityState = {
				identity: payload && payload.identity ? String(payload.identity) : this.config.identityFallback,
				detectedIdentity: payload && payload.detectedIdentity ? String(payload.detectedIdentity) : this.config.identityFallback,
				labels: payload && Array.isArray(payload.labels) ? payload.labels : [],
				faceCount: payload && Number.isFinite(Number(payload.faceCount)) ? Number(payload.faceCount) : 0,
				confidence: payload && Number.isFinite(Number(payload.confidence)) ? Number(payload.confidence) : 0,
				available: Boolean(payload && payload.available),
				configured: Boolean(payload && payload.configured),
				secureLocalOnly: payload && payload.secureLocalOnly !== false,
				error: payload && payload.error ? String(payload.error) : "",
				cameraCovered: Boolean(payload && payload.cameraCovered),
				updatedAt: payload && Number.isFinite(Number(payload.updatedAt)) ? Number(payload.updatedAt) : Date.now()
			};
			this.broadcastIdentityState();
			if (this.config.showPreview) {
				this.updateDom(200);
			}
		} else if (notification === "FACE_IDENTITY_PREVIEW") {
			if (!this.config.showPreview) {
				return;
			}
			const data = payload && payload.image ? String(payload.image) : "";
			const mimeType = payload && payload.mimeType ? String(payload.mimeType) : "image/jpeg";
			this.previewState = {
				src: data ? `data:${mimeType};base64,${data}` : "",
				format: mimeType,
				width: payload && Number.isFinite(Number(payload.width)) ? Number(payload.width) : this.config.previewWidth,
				height: payload && Number.isFinite(Number(payload.height)) ? Number(payload.height) : this.config.previewHeight,
				updatedAt: payload && Number.isFinite(Number(payload.updatedAt)) ? Number(payload.updatedAt) : Date.now()
			};
			this.updateDom(0);
		} else if (notification === "FACE_IDENTITY_LOG" && this.config.debug && payload && payload.message) {
			Log.info(`${this.name}: ${payload.message}`);
		}
	},

	getIdentityLabel: function () {
		const identity = String(this.identityState.identity || this.config.identityFallback || "unknown");
		const displayNames = this.config.identityDisplayNames && typeof this.config.identityDisplayNames === "object"
			? this.config.identityDisplayNames
			: {};
		if (displayNames[identity]) {
			return displayNames[identity];
		}
		if (identity === "both") {
			return "Both";
		}
		if (identity === "unknown") {
			return "Unknown";
		}
		return identity.charAt(0).toUpperCase() + identity.slice(1);
	},

	broadcastIdentityState: function () {
		const safeState = {
			identity: this.identityState.identity || this.config.identityFallback,
			detectedIdentity: this.identityState.detectedIdentity || this.config.identityFallback,
			labels: Array.isArray(this.identityState.labels) ? [...this.identityState.labels] : [],
			faceCount: this.identityState.faceCount || 0,
			confidence: this.identityState.confidence || 0,
			available: Boolean(this.identityState.available),
			configured: Boolean(this.identityState.configured),
			secureLocalOnly: this.identityState.secureLocalOnly !== false,
			error: this.identityState.error || "",
			updatedAt: this.identityState.updatedAt || Date.now()
		};

		const signature = JSON.stringify([
			safeState.identity,
			safeState.detectedIdentity,
			safeState.labels,
			safeState.available,
			safeState.configured,
			safeState.error
		]);

		if (signature === this.lastBroadcastSignature) {
			return;
		}

		this.lastBroadcastSignature = signature;
		this.sendNotification(this.config.broadcastNotification, safeState);
	}
});
