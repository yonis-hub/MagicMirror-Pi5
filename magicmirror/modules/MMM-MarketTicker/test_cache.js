/*
 * Dry-run test for MMM-MarketTicker disk cache + stale marking.
 * Loads the real node_helper.js (stubbing MagicMirror's node_helper module),
 * then exercises saveCacheToDisk/loadCacheFromDisk/buildServedQuote without any
 * network. Writes the cache into a temp dir via __dirname-relative path, so it
 * touches the module's own ./cache/quotes.json — cleaned up afterwards.
 *
 *   node test_cache.js
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

const CACHE_FILE = path.join(__dirname, "cache", "quotes.json");

function freshHelper() {
	const h = Object.create(helperDef);
	h.name = "MMM-MarketTicker";
	h.cache = new Map();
	h.cachedAt = new Map();
	h.lastFetchAt = 0;
	h.inflight = null;
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

// Clean slate.
try {
	fs.unlinkSync(CACHE_FILE);
} catch (e) {
	/* ignore */
}

// 1. Save good quotes, then load into a fresh helper.
const h1 = freshHelper();
h1.cache.set("BTC-USD", { symbol: "BTC-USD", price: 65000, change: 100, changePct: 0.15 });
h1.cachedAt.set("BTC-USD", Date.now() - 5 * 60 * 1000); // 5 min ago
h1.cache.set("^GSPC", { symbol: "^GSPC", price: 5500, change: -10, changePct: -0.18 });
h1.cachedAt.set("^GSPC", Date.now());
h1.saveCacheToDisk();
check("cache file written", fs.existsSync(CACHE_FILE));

const h2 = freshHelper();
h2.loadCacheFromDisk();
check("loaded BTC from disk", h2.cache.get("BTC-USD") && h2.cache.get("BTC-USD").price === 65000);
check("loaded GSPC from disk", h2.cache.has("^GSPC"));

// 2. buildServedQuote: fresh value -> stale:false.
const freshByKey = new Map([["BTC-USD", { symbol: "BTC-USD", price: 66000, change: 1000, changePct: 1.5 }]]);
const served = h2.buildServedQuote("BTC-USD", freshByKey);
check("fresh value served not stale", served.stale === false && served.price === 66000);

// 3. buildServedQuote: fetch errored -> fall back to cache, stale:true + cachedAt.
const errByKey = new Map([["BTC-USD", { symbol: "BTC-USD", error: "http 429" }]]);
const stale = h2.buildServedQuote("BTC-USD", errByKey);
check("errored fetch falls back to cached", stale.price === 65000);
check("fallback marked stale", stale.stale === true);
check("fallback carries cachedAt", typeof stale.cachedAt === "number" && stale.cachedAt > 0);

// 4. buildServedQuote: no fresh + no cache -> error passthrough.
const unknown = h2.buildServedQuote("NOPE-USD", new Map());
check("unknown symbol returns error", unknown.error === "no data" && unknown.symbol === "NOPE-USD");

// 5. saveCacheToDisk never persists error entries.
const h3 = freshHelper();
h3.cache.set("X", { symbol: "X", error: "boom" });
h3.cache.set("Y", { symbol: "Y", price: 1 });
h3.cachedAt.set("Y", Date.now());
h3.saveCacheToDisk();
const onDisk = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
check(
	"error entries excluded from disk",
	onDisk.quotes.every((q) => q.symbol !== "X")
);
check(
	"good entries persisted",
	onDisk.quotes.some((q) => q.symbol === "Y")
);

// 6. handleGetQuotes: a symbol whose live fetch keeps failing must stay marked
//    stale within the fetch interval (regression for the allFresh fast-path).
async function partialFailureRegression() {
	const h = freshHelper();
	h.sent = [];
	h.sendSocketNotification = function (n, p) {
		this.sent.push({ n, p });
	};
	// Seed cached last-good values, but mark them OLD (outside the fetch
	// interval) so a fetch is actually triggered rather than the fast path.
	const stale_ms = 10 * 60 * 1000; // 10 min ago (interval is 60s)
	const old = Date.now() - stale_ms;
	h.cache.set("A", { symbol: "A", price: 10 });
	h.cachedAt.set("A", old);
	h.cache.set("B", { symbol: "B", price: 20 });
	h.cachedAt.set("B", old);
	h.lastFetchAt = old;
	h.saveCacheToDisk = function () {}; // don't touch disk in this case

	// This poll: A succeeds, B errors. Stub the network layer.
	h.fetchAllWithRetry = async function () {
		return [
			{ symbol: "A", price: 11 },
			{ symbol: "B", error: "http 503" }
		];
	};
	await h.handleGetQuotes({ symbols: ["A", "B"] });
	const result = h.sent[h.sent.length - 1].p;
	const byKey = new Map(result.map((q) => [q.symbol, q]));
	check("partial-fail: A served fresh", byKey.get("A").price === 11 && byKey.get("A").stale === false);
	check("partial-fail: B served stale from cache", byKey.get("B").price === 20 && byKey.get("B").stale === true);

	// A refreshed so its cachedAt advanced; B's did not. An immediate re-poll
	// must therefore NOT take the allFresh fast path (B is still stale) and must
	// keep serving B with the stale marker, never masquerading it as fresh.
	h.sent = [];
	h.fetchAllWithRetry = async function () {
		return [{ symbol: "B", error: "http 503" }];
	};
	await h.handleGetQuotes({ symbols: ["A", "B"] });
	const r2 = new Map(h.sent[h.sent.length - 1].p.map((q) => [q.symbol, q]));
	check("re-poll: B stays stale (not masquerading as fresh)", r2.get("B").stale === true);
}

partialFailureRegression()
	.then(() => {
		try {
			fs.unlinkSync(CACHE_FILE);
		} catch (e) {
			/* ignore */
		}
		console.log(`\n${failed ? "FAILURES: " + failed : "all checks passed"}`);
		process.exit(failed ? 1 : 0);
	})
	.catch((err) => {
		console.log(`ERROR ${err && err.stack}`);
		process.exit(1);
	});
