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
const { execFile, spawn } = require("child_process");
const NodeHelper = require("node_helper");

const ADHAN_PLAYER_CANDIDATES = [
	{ cmd: "mpg123", args: ["-q", "-o", "pulse"] },
	{ cmd: "ffplay", args: ["-nodisp", "-autoexit", "-loglevel", "error"] },
	{ cmd: "cvlc", args: ["--play-and-exit", "--quiet"] }
];

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

	// --- Prayer-times offline cache -------------------------------------------
	// Persist the last good timings (keyed by the DD-MM-YYYY in the request URL)
	// so a network/API outage still shows correct times for that day. Best-effort:
	// all fs ops are wrapped so cache I/O can never break the fetch path.
	getMptCacheFile() {
		return path.join(__dirname, "cache", "prayer_times.json");
	},

	cacheKeyFromUrl(url) {
		const match = String(url || "").match(/\/timings\/(\d{2}-\d{2}-\d{4})/);
		return match ? match[1] : "latest";
	},

	readMptCache(key) {
		try {
			const file = this.getMptCacheFile();
			if (!fs.existsSync(file)) return null;
			const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
			const entry = parsed && parsed[key];
			if (entry && entry.timings) {
				return entry;
			}
		} catch (error) {
			console.warn(`MMM-MyPrayerTimes: failed to read prayer-times cache: ${error}`);
		}
		return null;
	},

	writeMptCache(key, timings, hijri) {
		try {
			const file = this.getMptCacheFile();
			const dir = path.dirname(file);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			let store = {};
			if (fs.existsSync(file)) {
				try {
					store = JSON.parse(fs.readFileSync(file, "utf8")) || {};
				} catch (parseErr) {
					store = {};
				}
			}
			store[key] = { timings, hijri: hijri || null, savedAt: Date.now() };
			// Keep the file small: retain only the most recent ~14 day-keys.
			const keys = Object.keys(store);
			if (keys.length > 14) {
				keys
					.sort((a, b) => (store[a].savedAt || 0) - (store[b].savedAt || 0))
					.slice(0, keys.length - 14)
					.forEach((old) => delete store[old]);
			}
			const tmp = `${file}.tmp`;
			fs.writeFileSync(tmp, JSON.stringify(store));
			fs.renameSync(tmp, file);
		} catch (error) {
			console.warn(`MMM-MyPrayerTimes: failed to write prayer-times cache: ${error}`);
		}
	},

	serveMptFromCache(url, reason) {
		const key = this.cacheKeyFromUrl(url);
		const cached = this.readMptCache(key);
		if (cached) {
			console.warn(`MMM-MyPrayerTimes: ${reason}; serving cached prayer times for ${key}`);
			this.sendSocketNotification("MPT_RESULT", {
				timings: cached.timings,
				hijri: cached.hijri || null,
				stale: true,
				cachedAt: cached.savedAt || null
			});
			return true;
		}
		console.error(`MMM-MyPrayerTimes: ${reason} and no cached prayer times available`);
		return false;
	},

	getMPT(url, attempt = 0) {
		const maxAttempts = 3;
		let settled = false;
		const req = https.get(url, (res) => {
			let data = "";
			res.on("data", (chunk) => {
				data += chunk;
			});
			res.on("end", () => {
				if (settled) return;
				settled = true;
				try {
					const result = JSON.parse(data);
					if (result && result.data && result.data.timings) {
						const timings = result.data.timings;
						const hijri = result.data.date && result.data.date.hijri ? result.data.date.hijri : null;
						this.writeMptCache(this.cacheKeyFromUrl(url), timings, hijri);
						this.sendSocketNotification("MPT_RESULT", { timings, hijri, stale: false });
					} else {
						console.error("MMM-MyPrayerTimes: Invalid data format received");
						this.serveMptFromCache(url, "invalid API response");
					}
				} catch (error) {
					console.error("MMM-MyPrayerTimes: Error parsing JSON", error);
					this.retryOrServeCachedMpt(url, attempt, maxAttempts, "JSON parse error");
				}
			});
		});
		// A hung TCP connection (connect, then no data, no RST) would otherwise
		// never fire 'end' or 'error', so the retry/cache fallback would never
		// run. Abort after 15s and treat it as a network error.
		req.setTimeout(15000, () => {
			req.destroy(new Error("request timeout"));
		});
		req.on("error", (error) => {
			if (settled) return;
			settled = true;
			console.error("MMM-MyPrayerTimes: Error fetching data", error);
			this.retryOrServeCachedMpt(url, attempt, maxAttempts, "network error");
		});
	},

	retryOrServeCachedMpt(url, attempt, maxAttempts, reason) {
		if (attempt + 1 < maxAttempts) {
			const delay = 2000 * Math.pow(2, attempt); // 2s, 4s
			console.warn(`MMM-MyPrayerTimes: ${reason}; retry ${attempt + 1}/${maxAttempts - 1} in ${delay}ms`);
			setTimeout(() => this.getMPT(url, attempt + 1), delay);
			return;
		}
		this.serveMptFromCache(url, `${reason} after ${maxAttempts} attempts`);
	},

	getPulseEnv() {
		const env = { ...process.env };
		const runtimeFromEnv = String(env.XDG_RUNTIME_DIR || "").trim();
		const uid = typeof process.getuid === "function" ? process.getuid() : null;
		const runtimeFallback = uid !== null ? `/run/user/${uid}` : "";
		const hasPulseSocket = (runtimeDir) =>
			Boolean(runtimeDir && fs.existsSync(path.join(runtimeDir, "pulse", "native")));

		let runtimeDir = runtimeFromEnv;
		if (!hasPulseSocket(runtimeDir) && hasPulseSocket(runtimeFallback)) {
			runtimeDir = runtimeFallback;
		}

		// Under some systemd contexts, the helper can inherit root-centric defaults
		// even though user audio is available under /run/user/<uid>/pulse/native.
		if (!hasPulseSocket(runtimeDir)) {
			try {
				const runUserDir = "/run/user";
				if (fs.existsSync(runUserDir)) {
					const entries = fs
						.readdirSync(runUserDir, { withFileTypes: true })
						.filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
						.map((entry) => entry.name)
						.sort((a, b) => Number(a) - Number(b));

					// Prefer non-root user runtime first.
					const preferred = entries.find((name) => name !== "0" && hasPulseSocket(path.join(runUserDir, name)));
					const fallback = entries.find((name) => hasPulseSocket(path.join(runUserDir, name)));
					const selected = preferred || fallback || "";
					if (selected) {
						runtimeDir = path.join(runUserDir, selected);
					}
				}
			} catch (error) {
				console.warn(`MMM-MyPrayerTimes: Failed to probe /run/user for Pulse runtime: ${error}`);
			}
		}

		if (runtimeDir && fs.existsSync(runtimeDir)) {
			env.XDG_RUNTIME_DIR = runtimeDir;
		}

		const pulseNativePath = runtimeDir ? path.join(runtimeDir, "pulse", "native") : "";
		if (pulseNativePath && fs.existsSync(pulseNativePath)) {
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

	// Hardware-agnostic sink selection. Mirrors the tier order in the canonical
	// Python resolver (MMM-QuranDisplay/audio_sink.py):
	//   1. explicit override (if present in the live sink list)
	//   2. bluetooth (bluez_output.*)
	//   3. HDMI
	//   4. analog / 3.5mm
	//   5. system default sink (if listed)
	//   6. first available
	// "auto"/"default"/empty target means "no override; pick by tier".
	isAutoSink(targetSink) {
		return ["", "auto", "default"].includes(
			String(targetSink || "")
				.trim()
				.toLowerCase()
		);
	},

	resolveSinkName(targetSink, sinkNames, defaultSink = "") {
		if (!Array.isArray(sinkNames) || sinkNames.length === 0) {
			return "";
		}

		const target = String(targetSink || "").trim();
		// Tier 1: explicit override, only when it actually exists right now.
		if (target && !this.isAutoSink(target) && sinkNames.includes(target)) {
			return target;
		}

		// Tier 2: Bluetooth.
		const bluetoothSink = sinkNames.find((name) => /^bluez_output\./.test(name));
		if (bluetoothSink) {
			return bluetoothSink;
		}

		// Tier 3: HDMI.
		const hdmiSink = sinkNames.find((name) => /hdmi/i.test(name));
		if (hdmiSink) {
			return hdmiSink;
		}

		// Tier 4: analog / 3.5mm.
		const analogSink = sinkNames.find((name) => /analog/i.test(name));
		if (analogSink) {
			return analogSink;
		}

		// Tier 5: system default sink.
		const dflt = String(defaultSink || "").trim();
		if (dflt && sinkNames.includes(dflt)) {
			return dflt;
		}

		// Tier 6: first available.
		return sinkNames[0];
	},

	async queryDefaultSink() {
		const getResult = await this.runPactl(["get-default-sink"], 2500);
		if (getResult.ok) {
			const name = String(getResult.stdout || "").trim();
			if (name && !/\s/.test(name) && !/^failure/i.test(name)) {
				return name;
			}
		}
		const infoResult = await this.runPactl(["info"], 2500);
		if (infoResult.ok) {
			const line = String(infoResult.stdout || "")
				.split(/\r?\n/)
				.find((row) => /^default sink:/i.test(row.trim()));
			if (line) {
				return line.split(":").slice(1).join(":").trim();
			}
		}
		return "";
	},

	async ensureAudioOutput(payload) {
		const safePayload = payload && typeof payload === "object" ? payload : {};
		const requestId = String(safePayload.requestId || "");
		const targetSink = String(safePayload.sink || "").trim();
		const sinkVolume = String(safePayload.sinkVolume || "50%").trim() || "50%";
		const enforceSinkVolume = safePayload.enforceSinkVolume === true;
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
					const defaultSink = await this.queryDefaultSink();
					effectiveSink = this.resolveSinkName(targetSink, sinkNames, defaultSink);
					sinkFound = effectiveSink ? sinkNames.includes(effectiveSink) : false;

					if (!sinkFound || !effectiveSink) {
						ok = false;
						message = "no sinks available";
						console.warn(`MMM-MyPrayerTimes: ${message}`);
					} else {
						// Only treat it as a "requested but unavailable" fallback when an
						// explicit (non-auto) sink was asked for and we picked a different one.
						if (targetSink && !this.isAutoSink(targetSink) && effectiveSink !== targetSink) {
							message = `requested sink unavailable; using ${effectiveSink}`;
							console.warn(`MMM-MyPrayerTimes: ${message}`);
						}

						await this.runPactl(["set-default-sink", effectiveSink], 3000);
						await this.runPactl(["set-sink-mute", effectiveSink, "0"], 3000);
						if (enforceSinkVolume) {
							await this.runPactl(["set-sink-volume", effectiveSink, sinkVolume], 3000);
						}

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

	playAdhanServerSide(payload) {
		const safePayload = payload && typeof payload === "object" ? payload : {};
		const requestId = String(safePayload.requestId || "");
		const sink = String(safePayload.sink || "").trim();
		const filePath = path.join(__dirname, "adaan.mp3");

		if (!fs.existsSync(filePath)) {
			console.error(`MMM-MyPrayerTimes: Adhan file missing at ${filePath}`);
			this.sendSocketNotification("ADHAN_PLAYBACK_STATUS", {
				requestId,
				ok: false,
				stage: "init",
				reason: "file_missing"
			});
			return;
		}

		if (this.adhanChild && !this.adhanChild.killed) {
			try {
				this.adhanChild.kill("SIGTERM");
			} catch (err) {
				// noop
			}
		}

		const env = this.getPulseEnv();
		if (sink) env.PULSE_SINK = sink;

		const tryCandidate = (idx) => {
			if (idx >= ADHAN_PLAYER_CANDIDATES.length) {
				console.error(
					"MMM-MyPrayerTimes: No adhan player found. Install one of: mpg123, ffplay (ffmpeg), cvlc (vlc)."
				);
				this.sendSocketNotification("ADHAN_PLAYBACK_STATUS", {
					requestId,
					ok: false,
					stage: "init",
					reason: "no_player_installed"
				});
				return;
			}

			const candidate = ADHAN_PLAYER_CANDIDATES[idx];
			let started = false;
			const child = spawn(candidate.cmd, [...candidate.args, filePath], { env });

			child.on("error", (err) => {
				if (started) return;
				if (err && err.code === "ENOENT") {
					tryCandidate(idx + 1);
					return;
				}
				console.warn(`MMM-MyPrayerTimes: ${candidate.cmd} error: ${err && err.message}`);
				tryCandidate(idx + 1);
			});

			child.on("exit", (code, signal) => {
				if (this.adhanChild === child) this.adhanChild = null;
				if (!started) {
					// Exited before we treated it as started — try the next player.
					tryCandidate(idx + 1);
					return;
				}
				const ok = code === 0 || signal === "SIGTERM";
				this.sendSocketNotification("ADHAN_PLAYBACK_STATUS", {
					requestId,
					ok,
					stage: "ended",
					reason: signal ? `signal_${signal}` : `exit_${code}`,
					player: candidate.cmd
				});
			});

			// Treat the process as "actually playing" if it survives 250ms.
			setTimeout(() => {
				if (child.exitCode !== null || child.killed) return;
				started = true;
				this.adhanChild = child;
				console.log(`MMM-MyPrayerTimes: Adhan playing via ${candidate.cmd} (sink=${sink || "default"})`);
				this.sendSocketNotification("ADHAN_PLAYBACK_STATUS", {
					requestId,
					ok: true,
					stage: "started",
					player: candidate.cmd
				});
			}, 250);
		};

		tryCandidate(0);
	},

	stopAdhanServerSide() {
		if (this.adhanChild && !this.adhanChild.killed) {
			try {
				this.adhanChild.kill("SIGTERM");
			} catch (err) {
				// noop
			}
		}
		this.adhanChild = null;
	},

	socketNotificationReceived(notification, payload) {
		if (notification === "GET_MPT") {
			this.getMPT(payload);
		} else if (notification === "GET_ADHKAR_TRACKS") {
			this.getAdhkarTracks(payload);
		} else if (notification === "ENSURE_AUDIO_OUTPUT") {
			this.ensureAudioOutput(payload);
		} else if (notification === "PLAY_ADHAN_SERVER") {
			this.playAdhanServerSide(payload);
		} else if (notification === "STOP_ADHAN_SERVER") {
			this.stopAdhanServerSide();
		}
	}
});
