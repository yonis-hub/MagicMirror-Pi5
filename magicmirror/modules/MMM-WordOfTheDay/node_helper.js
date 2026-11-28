/* MagicMirror²
 * Node Helper: MMM-WordOfTheDay
 *
 * Owns the word list and the memory of what has been shown. The browser asks
 * for a day's words; this draws them (see draw.js), records them in
 * state/history.json, and sends them back. The state file is what makes a word
 * wait for every other word before it comes round again, across restarts.
 *
 * GET /api/wotd/status returns a readable summary: cycle, how many words are
 * left in it, today's words and the last seven days.
 *
 * MIT Licensed.
 */
const fs = require("fs");
const path = require("path");
const NodeHelper = require("node_helper");
const draw = require("./draw");

module.exports = NodeHelper.create({
	start: function () {
		this.stateFile = process.env.WOTD_STATE_FILE || path.join(__dirname, "state", "history.json");
		this.lastRequest = null;

		this.expressApp.get("/api/wotd/status", (req, res) => {
			try {
				const request = this.lastRequest || { wordsFile: "words.json", levels: null, wordsPerDay: 10 };
				const { pool } = this.loadPool(request);
				const state = this.loadState() || draw.normalizeState(null);
				res.json({ stateFile: this.stateFile, ...draw.summarize(pool, state, request.wordsPerDay) });
			} catch (err) {
				res.status(500).json({ error: err.message });
			}
		});

		console.log(`Starting node helper for: ${this.name} (state: ${this.stateFile})`);
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "WOTD_GET_DAY") {
			this.sendDay(payload || {});
		}
	},

	/**
	 * Read words.json fresh on every request, so an edited list is picked up at
	 * the next day's draw without restarting the mirror.
	 */
	loadPool: function (request) {
		const file = path.join(__dirname, path.basename(String(request.wordsFile || "words.json")));
		const data = JSON.parse(fs.readFileSync(file, "utf8"));
		const words = (Array.isArray(data.words) ? data.words : []).filter((w) => w && w.so && w.en);
		if (words.length === 0) {
			throw new Error("no usable entries");
		}
		const categories = data.categories && typeof data.categories === "object" ? data.categories : {};
		const pool = draw.filterLevels(words, request.levels);
		// The old date-seeded draw used the original entries in file order;
		// anything carrying an "added" date arrived after it.
		const legacyPool = draw.filterLevels(words.filter((w) => !w.added), request.levels);
		return { pool, legacyPool, categories };
	},

	loadState: function () {
		if (!fs.existsSync(this.stateFile)) {
			return null;
		}
		try {
			return JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
		} catch (err) {
			// Keep the damaged file for inspection and start over rather than
			// leaving the bottom bar empty.
			const aside = `${this.stateFile}.corrupt-${Date.now()}`;
			console.error(`[MMM-WordOfTheDay] unreadable state (${err.message}); moved to ${aside}`);
			try {
				fs.renameSync(this.stateFile, aside);
			} catch (renameErr) {
				console.error(`[MMM-WordOfTheDay] could not move it aside: ${renameErr.message}`);
			}
			return null;
		}
	},

	// Temp file + rename, so a power cut mid-write can never leave half a file.
	saveState: function (state) {
		try {
			fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
			const tmp = `${this.stateFile}.tmp`;
			fs.writeFileSync(tmp, `${JSON.stringify(state, null, 1)}\n`);
			fs.renameSync(tmp, this.stateFile);
		} catch (err) {
			// Still show today's words; only the memory is lost.
			console.error(`[MMM-WordOfTheDay] could not save state: ${err.message}`);
		}
	},

	sendDay: function (payload) {
		const request = {
			dayKey: String(payload.dayKey || ""),
			wordsFile: payload.wordsFile || "words.json",
			levels: Array.isArray(payload.levels) ? payload.levels : null,
			wordsPerDay: Number(payload.wordsPerDay) || 10
		};
		this.lastRequest = request;

		try {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(request.dayKey)) {
				throw new Error(`bad day key "${request.dayKey}"`);
			}
			const { pool, legacyPool, categories } = this.loadPool(request);

			let state = this.loadState();
			if (!state) {
				state = draw.seedFromLegacy(pool, legacyPool, request.dayKey, request.wordsPerDay);
				console.log(`[MMM-WordOfTheDay] no history yet; seeded ${state.used.length} words from the old schedule`);
			}

			const result = draw.drawDay(pool, state, request.dayKey, request.wordsPerDay);
			if (result.changed) {
				this.saveState(result.state);
				const s = draw.summarize(pool, result.state, request.wordsPerDay);
				console.log(
					`[MMM-WordOfTheDay] ${request.dayKey}: cycle ${s.cycle}, ` +
						`${s.usedThisCycle}/${s.poolSize} shown, ${s.remainingThisCycle} to go`
				);
			}

			this.sendSocketNotification("WOTD_DAY", {
				dayKey: request.dayKey,
				words: result.words,
				categories
			});
		} catch (err) {
			console.error(`[MMM-WordOfTheDay] ${err.message}`);
			this.sendSocketNotification("WOTD_ERROR", { message: err.message });
		}
	}
});
