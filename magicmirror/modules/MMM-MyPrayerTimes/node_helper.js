/*
//-------------------------------------------
MMM-MyPrayerTimes
Copyright (C) 2024 - H. Tilburgs

v1.0 : Initial version
v2.0 : Update request to fetch (request package has been deprecated)
v2.1 : Optimized code

MIT License
//-------------------------------------------
*/

const https = require("https");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const NodeHelper = require("node_helper");

module.exports = NodeHelper.create({
	start() {
		console.log(`Starting node_helper for: ${this.name}`);
	},

	getDefaultTrackTitle(period, index) {
		const capitalized = period.charAt(0).toUpperCase() + period.slice(1);
		return `${capitalized} Adhkar ${index}`;
	},

	normalizeTrack(track, period, index) {
		if (!track || typeof track !== "object") {
			return null;
		}

		const urlRaw = String(track.url || "").trim();
		const sourceUrlRaw = String(track.sourceUrl || "").trim();
		if (!urlRaw) {
			return null;
		}

		let normalizedUrl = urlRaw;
		if (!/^https?:\/\//i.test(urlRaw) && !urlRaw.startsWith("modules/")) {
			normalizedUrl = `modules/MMM-MyPrayerTimes/${urlRaw.replace(/^[\\/]+/, "")}`;
		}

		const normalizedSourceUrl = /^https?:\/\//i.test(sourceUrlRaw) ? sourceUrlRaw : "";

		return {
			url: normalizedUrl,
			title: String(track.title || "").trim() || this.getDefaultTrackTitle(period, index),
			titleArabic: String(track.titleArabic || "").trim(),
			sourceUrl: normalizedSourceUrl
		};
	},

	loadTracksFromManifest(period, manifestData) {
		const entries = manifestData && Array.isArray(manifestData[period]) ? manifestData[period] : [];
		const tracks = [];
		entries.forEach((entry, idx) => {
			const normalized = this.normalizeTrack(entry, period, idx + 1);
			if (normalized) {
				tracks.push(normalized);
			}
		});
		return tracks;
	},

	loadTracksFromLocalDirectory(period) {
		const dirPath = path.join(__dirname, "adhkar", period);
		if (!fs.existsSync(dirPath)) {
			return [];
		}

		const files = fs
			.readdirSync(dirPath)
			.filter((name) => name.toLowerCase().endsWith(".mp3"))
			.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

		return files.map((fileName, idx) => ({
			url: `modules/MMM-MyPrayerTimes/adhkar/${period}/${fileName}`,
			title: this.getDefaultTrackTitle(period, idx + 1),
			titleArabic: "",
			sourceUrl: ""
		}));
	},

	resolveLocalModulePathFromUrl(url) {
		const normalizedUrl = String(url || "").trim();
		const modulePrefix = "modules/MMM-MyPrayerTimes/";
		if (!normalizedUrl.startsWith(modulePrefix)) {
			return "";
		}

		const relative = normalizedUrl.slice(modulePrefix.length).replace(/[\\/]+/g, path.sep);
		return path.join(__dirname, relative);
	},

	auditTrackFiles(period, tracks) {
		if (!Array.isArray(tracks) || tracks.length === 0) {
			console.warn(`MMM-MyPrayerTimes: No ${period} adhkar tracks available.`);
			return;
		}

		let localTrackCount = 0;
		let missingCount = 0;
		let zeroByteCount = 0;

		tracks.forEach((track) => {
			const localPath = this.resolveLocalModulePathFromUrl(track && track.url);
			if (!localPath) {
				return;
			}

			localTrackCount += 1;

			try {
				const stats = fs.statSync(localPath);
				if (!stats.isFile() || stats.size <= 0) {
					zeroByteCount += 1;
				}
			} catch (error) {
				missingCount += 1;
			}
		});

		if (missingCount > 0 || zeroByteCount > 0) {
			console.warn(
				`MMM-MyPrayerTimes: ${period} adhkar audit found issues (missing: ${missingCount}, empty: ${zeroByteCount}, local tracks: ${localTrackCount}).`
			);
			return;
		}

		console.log(`MMM-MyPrayerTimes: ${period} adhkar audit passed (${localTrackCount} local tracks).`);
	},

	getAdhkarTracks(payload) {
		const safePayload = payload && typeof payload === "object" ? payload : {};
		const manifestFileName = String(safePayload.adhkarManifestFile || "adhkar_manifest.json");
		const manifestPath = path.join(__dirname, manifestFileName);

		let manifestData = {};
		if (fs.existsSync(manifestPath)) {
			try {
				const raw = fs.readFileSync(manifestPath, "utf-8");
				manifestData = JSON.parse(raw);
			} catch (error) {
				console.error(`MMM-MyPrayerTimes: Failed to parse ${manifestFileName}`, error);
			}
		}

		const resolveTracks = (period, explicitTracks) => {
			if (Array.isArray(explicitTracks) && explicitTracks.length > 0) {
				const fromConfig = [];
				explicitTracks.forEach((track, idx) => {
					const normalized = this.normalizeTrack(track, period, idx + 1);
					if (normalized) {
						fromConfig.push(normalized);
					}
				});
				return fromConfig;
			}

			const fromManifest = this.loadTracksFromManifest(period, manifestData);
			if (fromManifest.length > 0) {
				return fromManifest;
			}

			return this.loadTracksFromLocalDirectory(period);
		};

		const morning = resolveTracks("morning", safePayload.morningAdhkarTracks);
		const evening = resolveTracks("evening", safePayload.eveningAdhkarTracks);
		this.auditTrackFiles("morning", morning);
		this.auditTrackFiles("evening", evening);

		this.sendSocketNotification("ADHKAR_TRACKS", { morning, evening });
	},

	getMPT(url) {
		https
			.get(url, (res) => {
				let data = "";
				res.on("data", (chunk) => {
					data += chunk;
				});
				res.on("end", () => {
					try {
						const result = JSON.parse(data);
						if (result && result.data && result.data.timings) {
							this.sendSocketNotification("MPT_RESULT", {
								timings: result.data.timings,
								hijri: result.data.date && result.data.date.hijri ? result.data.date.hijri : null
							});
						} else {
							console.error("MMM-MyPrayerTimes: Invalid data format received");
						}
					} catch (error) {
						console.error("MMM-MyPrayerTimes: Error parsing JSON", error);
					}
				});
			})
			.on("error", (error) => {
				console.error("MMM-MyPrayerTimes: Error fetching data", error);
			});
	},

	getPulseEnv() {
		const env = { ...process.env };
		const runtimeFromEnv = String(env.XDG_RUNTIME_DIR || "").trim();
		const uid = typeof process.getuid === "function" ? process.getuid() : null;
		const runtimeFallback = uid !== null ? `/run/user/${uid}` : "";
		const runtimeDir = runtimeFromEnv || runtimeFallback;

		if (!runtimeFromEnv && runtimeDir && fs.existsSync(runtimeDir)) {
			env.XDG_RUNTIME_DIR = runtimeDir;
		}

		const pulseNativePath = runtimeDir ? path.join(runtimeDir, "pulse", "native") : "";
		if (!env.PULSE_SERVER && pulseNativePath && fs.existsSync(pulseNativePath)) {
			env.PULSE_SERVER = `unix:${pulseNativePath}`;
		}

		return env;
	},

	runPactl(args, timeoutMs = 3000) {
		return new Promise((resolve) => {
			execFile("pactl", args, { timeout: timeoutMs, env: this.getPulseEnv() }, (error, stdout, stderr) => {
				resolve({
					ok: !error,
					stdout: stdout || "",
					stderr: stderr || "",
					code: error && typeof error.code !== "undefined" ? error.code : 0
				});
			});
		});
	},

	parseNamesFromShortList(output, nameColumnIndex = 1) {
		const names = [];
		String(output || "")
			.split(/\r?\n/)
			.forEach((line) => {
				const columns = line.trim().split(/\s+/);
				if (columns.length > nameColumnIndex) {
					names.push(columns[nameColumnIndex]);
				}
			});
		return names;
	},

	parseIdsFromShortList(output, idColumnIndex = 0) {
		const ids = [];
		String(output || "")
			.split(/\r?\n/)
			.forEach((line) => {
				const columns = line.trim().split(/\s+/);
				if (columns.length > idColumnIndex && /^\d+$/.test(columns[idColumnIndex])) {
					ids.push(columns[idColumnIndex]);
				}
			});
		return ids;
	},

	resolveSinkName(targetSink, sinkNames) {
		if (!Array.isArray(sinkNames) || sinkNames.length === 0) {
			return "";
		}
		if (targetSink && sinkNames.includes(targetSink)) {
			return targetSink;
		}

		const bluetoothSink = sinkNames.find((name) => /^bluez_output\./.test(name));
		if (bluetoothSink) {
			return bluetoothSink;
		}

		return targetSink || sinkNames[0];
	},

	async ensureAudioOutput(payload) {
		const safePayload = payload && typeof payload === "object" ? payload : {};
		const requestId = String(safePayload.requestId || "");
		const targetSink = String(safePayload.sink || "").trim();
		const sinkVolume = String(safePayload.sinkVolume || "100%").trim() || "100%";
		const card = String(safePayload.card || "").trim();
		const profile = String(safePayload.profile || "").trim();
		const preferredSource = String(safePayload.preferredSource || "").trim();
		const muteBluetoothInput = safePayload.muteBluetoothInput !== false;
		let ok = true;
		let message = "ok";
		let sinkFound = true;
		let effectiveSink = targetSink;
		let sourcePinned = false;
		let bluetoothInputMuted = false;

		try {
			const infoResult = await this.runPactl(["info"], 2500);
			if (!infoResult.ok) {
				ok = false;
				message = `pactl unavailable (${String(infoResult.code || "")}) ${String(infoResult.stderr || "").trim()}`.trim();
				console.warn(`MMM-MyPrayerTimes: ${message}`);
			}

			if (ok && card && profile) {
				const profileResult = await this.runPactl(["set-card-profile", card, profile], 3000);
				if (!profileResult.ok) {
					console.warn(
						`MMM-MyPrayerTimes: set-card-profile failed (${card} -> ${profile}): ${String(profileResult.stderr || "").trim()}`
					);
				}
			}

			if (ok) {
				const sinksResult = await this.runPactl(["list", "sinks", "short"], 3000);
				if (!sinksResult.ok) {
					ok = false;
					message = `unable to list sinks: ${String(sinksResult.stderr || "").trim()}`.trim();
					console.warn(`MMM-MyPrayerTimes: ${message}`);
				} else {
					const sinkNames = this.parseNamesFromShortList(sinksResult.stdout, 1);
					effectiveSink = this.resolveSinkName(targetSink, sinkNames);
					sinkFound = effectiveSink ? sinkNames.includes(effectiveSink) : false;

					if (!sinkFound || !effectiveSink) {
						ok = false;
						message = targetSink ? `sink not found: ${targetSink}` : "no sinks available";
						console.warn(`MMM-MyPrayerTimes: ${message}`);
					} else {
						if (targetSink && effectiveSink !== targetSink) {
							message = `requested sink unavailable; using ${effectiveSink}`;
							console.warn(`MMM-MyPrayerTimes: ${message}`);
						}

						await this.runPactl(["set-default-sink", effectiveSink], 3000);
						await this.runPactl(["set-sink-mute", effectiveSink, "0"], 3000);
						await this.runPactl(["set-sink-volume", effectiveSink, sinkVolume], 3000);

						const sinkInputsResult = await this.runPactl(["list", "sink-inputs", "short"], 3000);
						if (sinkInputsResult.ok) {
							const inputIds = this.parseIdsFromShortList(sinkInputsResult.stdout, 0);
							for (const inputId of inputIds) {
								await this.runPactl(["move-sink-input", inputId, effectiveSink], 3000);
							}
						}

						const sourcesResult = await this.runPactl(["list", "sources", "short"], 3000);
						if (sourcesResult.ok) {
							const sourceLines = String(sourcesResult.stdout || "")
								.split(/\r?\n/)
								.filter((line) => line.trim().length > 0);
							const sourceNames = this.parseNamesFromShortList(sourcesResult.stdout, 1);

							if (preferredSource && sourceNames.includes(preferredSource)) {
								await this.runPactl(["set-default-source", preferredSource], 3000);
								await this.runPactl(["set-source-mute", preferredSource, "0"], 3000);
								sourcePinned = true;
							}

							if (muteBluetoothInput) {
								for (const line of sourceLines) {
									const columns = line.trim().split(/\s+/);
									if (columns.length < 2) {
										continue;
									}
									const sourceName = columns[1];
									if (/^bluez_input\./.test(sourceName)) {
										await this.runPactl(["set-source-mute", sourceName, "1"], 3000);
										bluetoothInputMuted = true;
									}
								}
							}
						}
					}
				}
			}
		} catch (error) {
			ok = false;
			message = error && error.message ? error.message : "audio ensure exception";
		}

		if (ok) {
			console.log(`MMM-MyPrayerTimes: Audio output ensured on sink ${effectiveSink || targetSink}`);
		}

		this.sendSocketNotification("ENSURE_AUDIO_OUTPUT_DONE", {
			requestId,
			ok,
			sink: effectiveSink || targetSink,
			sinkFound,
			message,
			sourcePinned,
			bluetoothInputMuted
		});
	},

	socketNotificationReceived(notification, payload) {
		if (notification === "GET_MPT") {
			this.getMPT(payload);
		} else if (notification === "GET_ADHKAR_TRACKS") {
			this.getAdhkarTracks(payload);
		} else if (notification === "ENSURE_AUDIO_OUTPUT") {
			this.ensureAudioOutput(payload);
		}
	}
});
