/*
 * Dry-run test for MMM-MyPrayerTimes prayer-times disk cache.
 * Loads the real node_helper.js (stubbing MagicMirror's node_helper) and
 * verifies writeMptCache/readMptCache round-trip and serveMptFromCache emits a
 * stale-marked MPT_RESULT. No network. Cleans up its own cache file.
 *
 *   node test_mpt_cache.js
 */
"use strict";

const Module = require("module");
const fs = require("fs");
const path = require("path");

const originalLoad = Module._load;
Module._load = function (request) {
	if (request === "node_helper") {
		return { create: (def) => def };
	}
	return originalLoad.apply(this, arguments);
};
const helperDef = require("./node_helper.js");
Module._load = originalLoad;

const CACHE_FILE = path.join(__dirname, "cache", "prayer_times.json");

function freshHelper() {
	const h = Object.create(helperDef);
	h.sent = [];
	h.sendSocketNotification = function (n, p) {
		this.sent.push({ n, p });
	};
	return h;
}

let failed = 0;
function check(name, cond) {
	if (cond) {
		console.log(`PASS  ${name}`);
	} else {
		failed += 1;
		console.log(`FAIL  ${name}`);
	}
}

try {
	fs.unlinkSync(CACHE_FILE);
} catch (e) {
	/* ignore */
}

const URL = "https://api.aladhan.com/v1/timings/24-06-2026?latitude=43.6&longitude=-79.3&method=2&tune=0";
const TIMINGS = { Fajr: "04:15", Dhuhr: "13:25", Asr: "17:20", Maghrib: "20:55", Isha: "22:30" };
const HIJRI = { day: "8", month: { en: "Dhu al-Hijjah", ar: "ذو الحجة" }, year: "1447" };

const h = freshHelper();

// Key extraction from URL.
check("cache key from url", h.cacheKeyFromUrl(URL) === "24-06-2026");
check("cache key fallback", h.cacheKeyFromUrl("http://x/no-date") === "latest");

// Write then read back.
h.writeMptCache("24-06-2026", TIMINGS, HIJRI);
check("cache file created", fs.existsSync(CACHE_FILE));
const back = h.readMptCache("24-06-2026");
check("read returns timings", back && back.timings.Fajr === "04:15");
check("read returns hijri", back && back.hijri && back.hijri.year === "1447");
check("read carries savedAt", back && typeof back.savedAt === "number");
check("missing key returns null", h.readMptCache("01-01-2000") === null);

// serveMptFromCache emits a stale MPT_RESULT.
h.sent = [];
const served = h.serveMptFromCache(URL, "network error");
check("serve reports success", served === true);
check("serve emitted MPT_RESULT", h.sent.length === 1 && h.sent[0].n === "MPT_RESULT");
check("served payload marked stale", h.sent[0].p.stale === true);
check("served payload has timings", h.sent[0].p.timings.Maghrib === "20:55");

// serve with no cache for that key -> false, no emit.
h.sent = [];
const servedMiss = h.serveMptFromCache("http://x/timings/01-01-1999", "network error");
check("serve miss reports false", servedMiss === false);
check("serve miss emits nothing", h.sent.length === 0);

// Retention: writing >14 keys keeps only the newest 14.
const h2 = freshHelper();
for (let d = 1; d <= 20; d += 1) {
	const key = `${String(d).padStart(2, "0")}-06-2026`;
	h2.writeMptCache(key, TIMINGS, HIJRI);
}
const store = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
check("retention caps at 14 keys", Object.keys(store).length <= 14);

try {
	fs.unlinkSync(CACHE_FILE);
} catch (e) {
	/* ignore */
}

console.log(`\n${failed ? "FAILURES: " + failed : "all checks passed"}`);
process.exit(failed ? 1 : 0);
