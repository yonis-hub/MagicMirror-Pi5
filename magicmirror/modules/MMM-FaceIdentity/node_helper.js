/* MagicMirror
 * Node Helper: MMM-FaceIdentity
 * Runs local-only webcam face recognition and publishes identity state.
 * MIT Licensed.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const NodeHelper = require("node_helper");

module.exports = NodeHelper.create({
	start() {
		console.log(`Starting node_helper for: ${this.name}`);
		this.config = {};
		this.worker = null;
		this.stdoutBuffer = "";
		this.restartTimer = null;
		this.stopping = false;
	},

	socketNotificationReceived(notification, payload) {
		if (notification !== "MODULE_READY") {
			return;
		}

		this.config = payload && payload.config ? payload.config : {};
		this.startWorker();
	},

	stop() {
		this.stopWorker(false);
	},

	resolvePath(targetPath, fallbackRelativePath = "") {
		const raw = String(targetPath || fallbackRelativePath || "").trim();
		if (!raw) {
			return "";
		}
		return path.isAbsolute(raw) ? raw : path.join(__dirname, raw);
	},

	resolvePythonBinary() {
		const preferredVenv = this.resolvePath(this.config.venvBinary);
		if (preferredVenv && fs.existsSync(preferredVenv)) {
			return preferredVenv;
		}

		const preferredPython = String(this.config.pythonBinary || "python3").trim();
		if (preferredPython && fs.existsSync(preferredPython)) {
			return preferredPython;
		}

		return preferredPython || "python3";
	},

	buildWorkerArgs() {
		const scriptPath = path.join(__dirname, "face_identity.py");
		const dataFile = this.resolvePath(this.config.dataFile, "data/encodings.json");
		const args = [
			scriptPath,
			"--data-file",
			dataFile,
			"--scan-interval-ms",
			String(Number(this.config.scanIntervalMs) || 2500),
			"--required-matches",
			String(Number(this.config.requiredMatches) || 2),
			"--recall-hold-ms",
			String(Number(this.config.recallHoldMs) || 25000),
			"--unknown-hold-ms",
			String(Number(this.config.unknownHoldMs) || 8000),
			"--match-threshold",
			String(Number(this.config.matchThreshold) || 0.46),
			"--frame-width",
			String(Number(this.config.frameWidth) || 320),
			"--frame-height",
			String(Number(this.config.frameHeight) || 240),
			"--detector-model",
			String(this.config.detectorModel || "hog")
		];

		if (String(this.config.cameraDevice || "").trim()) {
			args.push("--camera-device", String(this.config.cameraDevice).trim());
		} else {
			args.push("--camera-index", String(Number(this.config.cameraIndex) || 0));
		}

		if (Array.isArray(this.config.labels) && this.config.labels.length > 0) {
			args.push("--labels", this.config.labels.map((label) => String(label).trim()).filter(Boolean).join(","));
		}

		if (this.config.debug) {
			args.push("--debug");
		}

		return args;
	},

	startWorker() {
		this.stopWorker(false);
		this.stopping = false;

		const pythonBinary = this.resolvePythonBinary();
		const args = this.buildWorkerArgs();

		console.log(`MMM-FaceIdentity: starting local worker with ${pythonBinary}`);
		this.worker = spawn(pythonBinary, args, {
			cwd: __dirname,
			stdio: ["ignore", "pipe", "pipe"]
		});

		this.stdoutBuffer = "";
		this.worker.stdout.on("data", (chunk) => this.handleStdoutChunk(chunk));
		this.worker.stderr.on("data", (chunk) => {
			const text = String(chunk || "").trim();
			if (text) {
				console.error(`MMM-FaceIdentity worker stderr: ${text}`);
			}
		});
		this.worker.on("close", (code) => {
			console.warn(`MMM-FaceIdentity worker exited with code ${code}`);
			this.worker = null;
			if (!this.stopping) {
				this.scheduleRestart();
			}
		});
	},

	stopWorker(allowRestart) {
		this.stopping = !allowRestart;
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = null;
		}

		if (!this.worker) {
			return;
		}

		this.worker.kill("SIGTERM");
		this.worker = null;
	},

	scheduleRestart() {
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
		}

		this.restartTimer = setTimeout(() => {
			this.restartTimer = null;
			this.startWorker();
		}, 10000);
	},

	handleStdoutChunk(chunk) {
		this.stdoutBuffer += String(chunk || "");
		let newlineIndex = this.stdoutBuffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
			this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
			if (line) {
				this.handleWorkerLine(line);
			}
			newlineIndex = this.stdoutBuffer.indexOf("\n");
		}
	},

	handleWorkerLine(line) {
		let parsed;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			if (this.config.debug) {
				console.log(`MMM-FaceIdentity worker: ${line}`);
			}
			return;
		}

		if (parsed.event === "identity") {
			this.sendSocketNotification("FACE_IDENTITY_STATE", parsed);
			return;
		}

		if (parsed.event === "log") {
			this.sendSocketNotification("FACE_IDENTITY_LOG", parsed);
		}
	}
});
