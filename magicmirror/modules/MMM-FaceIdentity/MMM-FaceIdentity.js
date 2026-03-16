/* MagicMirror
 * Module: MMM-FaceIdentity
 * Local-only face identity publisher for personalized compliments.
 * MIT Licensed.
 */

Module.register("MMM-FaceIdentity", {
	defaults: {
		broadcastNotification: "FACE_IDENTITY_UPDATE",
		identityFallback: "unknown",
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
			updatedAt: Date.now()
		};
		this.lastBroadcastSignature = "";

		this.sendSocketNotification("MODULE_READY", {
			config: this.config
		});
	},

	getDom: function () {
		const wrapper = document.createElement("div");
		wrapper.className = "mmm-face-identity hidden";
		wrapper.style.display = "none";
		wrapper.setAttribute("aria-hidden", "true");
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
				updatedAt: payload && Number.isFinite(Number(payload.updatedAt)) ? Number(payload.updatedAt) : Date.now()
			};
			this.broadcastIdentityState();
		} else if (notification === "FACE_IDENTITY_LOG" && this.config.debug && payload && payload.message) {
			Log.info(`${this.name}: ${payload.message}`);
		}
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
