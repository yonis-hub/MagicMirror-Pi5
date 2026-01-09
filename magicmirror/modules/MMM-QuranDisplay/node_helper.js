/* Magic Mirror
 * Node Helper: MMM-QuranDisplay
 * Handles communication with quran_chainer.py
 * MIT Licensed.
 */

const { spawn } = require("child_process");
const path = require("path");
const express = require("express");
const NodeHelper = require("node_helper");

module.exports = NodeHelper.create({
	start: function () {
		console.log(`Starting node helper for: ${this.name}`);
		this.pythonProcess = null;
		this.config = {};

		// Enable JSON body parsing for our endpoints
		this.expressApp.use("/api/quran", express.json());

		// API endpoint for receiving verse updates from Python script
		this.expressApp.post("/api/quran/verse", (req, res) => {
			console.log("MMM-QuranDisplay: Received verse update", req.body);
			const { arabic, translation, surah, verse, surahInfo, isPlaying } = req.body || {};

			this.sendSocketNotification("VERSE_UPDATE", {
				arabic,
				translation,
				surah,
				verse,
				surahInfo,
				isPlaying
			});

			console.log("MMM-QuranDisplay: Sent VERSE_UPDATE socket notification");
			res.status(200).json({ status: "success" });
		});

		// API endpoint for playback status updates
		this.expressApp.post("/api/quran/status", (req, res) => {
			const { isPlaying } = req.body;
			this.sendSocketNotification("PLAYBACK_STATUS", { isPlaying });
			res.status(200).json({ status: "success" });
		});

		// API endpoint to clear display
		this.expressApp.post("/api/quran/clear", (req, res) => {
			this.sendSocketNotification("CLEAR_DISPLAY", {});
			res.status(200).json({ status: "success" });
		});

		// API endpoint for listening status updates
		this.expressApp.post("/api/quran/listening", (req, res) => {
			const { isListening } = req.body;
			this.sendSocketNotification("LISTENING_STATUS", { isListening });
			res.status(200).json({ status: "success" });
		});

		// API endpoint for recording status updates
		this.expressApp.post("/api/quran/recording", (req, res) => {
			const { isRecording } = req.body;
			this.sendSocketNotification("RECORDING_STATUS", { isRecording });
			res.status(200).json({ status: "success" });
		});
	},

	socketNotificationReceived: function (notification, payload) {
		console.log("MMM-QuranDisplay received:", notification);

		if (notification === "MODULE_READY") {
			this.config = payload.config || {};
			console.log("MMM-QuranDisplay: Module ready");
		} else if (notification === "PLAY_SURAH") {
			this.startPythonChainer(payload.surah, payload.startVerse);
		} else if (notification === "STOP_PLAYBACK") {
			this.stopPythonChainer();
		} else if (notification === "PAUSE_PLAYBACK") {
			// Send pause signal to Python process
			if (this.pythonProcess) {
				this.pythonProcess.stdin.write("PAUSE\n");
			}
		} else if (notification === "RESUME_PLAYBACK") {
			if (this.pythonProcess) {
				this.pythonProcess.stdin.write("RESUME\n");
			}
		}
	},

	startPythonChainer: function (surah, startVerse) {
		// Kill any existing process
		this.stopPythonChainer();

		const scriptPath = path.join(__dirname, "quran_chainer.py");

		console.log(`Starting quran_chainer.py for Surah ${surah}, starting at verse ${startVerse}`);

		this.pythonProcess = spawn("python3", [scriptPath, "--surah", String(surah), "--start-verse", String(startVerse || 1), "--mirror-url", "http://localhost:8080"]);

		this.pythonProcess.stdout.on("data", (data) => {
			console.log(`quran_chainer: ${data}`);
		});

		this.pythonProcess.stderr.on("data", (data) => {
			console.error(`quran_chainer error: ${data}`);
		});

		this.pythonProcess.on("close", (code) => {
			console.log(`quran_chainer exited with code ${code}`);
			this.pythonProcess = null;
			this.sendSocketNotification("PLAYBACK_STATUS", { isPlaying: false });
		});
	},

	stopPythonChainer: function () {
		if (this.pythonProcess) {
			this.pythonProcess.kill("SIGTERM");
			this.pythonProcess = null;
		}
		this.sendSocketNotification("CLEAR_DISPLAY", {});
	}
});
