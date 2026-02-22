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
		if (!urlRaw) {
			return null;
		}

		let normalizedUrl = urlRaw;
		if (!/^https?:\/\//i.test(urlRaw) && !urlRaw.startsWith("modules/")) {
			normalizedUrl = `modules/MMM-MyPrayerTimes/${urlRaw.replace(/^[\\/]+/, "")}`;
		}

		return {
			url: normalizedUrl,
			title: String(track.title || "").trim() || this.getDefaultTrackTitle(period, index),
			titleArabic: String(track.titleArabic || "").trim()
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
			titleArabic: ""
		}));
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

	socketNotificationReceived(notification, payload) {
		if (notification === "GET_MPT") {
			this.getMPT(payload);
		} else if (notification === "GET_ADHKAR_TRACKS") {
			this.getAdhkarTracks(payload);
		}
	}
});
