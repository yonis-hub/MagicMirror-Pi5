const https = require("https");
const fs = require("fs");
const path = require("path");
const NodeHelper = require("node_helper");

// Persisted last-good quotes survive restarts and API outages. Served (clearly
// marked stale) when a fresh fetch fails so the mirror never goes blank.
const CACHE_FILE = path.join(__dirname, "cache", "quotes.json");
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // ignore cache older than a week

const YAHOO_HOST = "query1.finance.yahoo.com";
const FINNHUB_HOST = "finnhub.io";
const COINGECKO_HOST = "api.coingecko.com";
const STOOQ_HOST = "stooq.com";
const REQUEST_TIMEOUT_MS = 6000;
const FETCH_INTERVAL_MS = 60 * 1000;

// Yahoo futures symbols -> Stooq symbol (free, no key, CSV).
// Add more here when you find new ones that Yahoo throttles.
const STOOQ_SYMBOL_BY_YAHOO = {
	"GC=F": "xauusd",          // Gold spot per oz
	"CL=F": "wtiusd",          // WTI crude oil
	"SI=F": "xagusd",          // Silver
	"HG=F": "hgusd",           // Copper
	"NG=F": "ngusd"            // Natural gas
};

function isStooqFriendly(symbol) {
	return Object.prototype.hasOwnProperty.call(STOOQ_SYMBOL_BY_YAHOO, String(symbol || ""));
}

// Finnhub's free tier only covers US-listed stocks/ETFs.
// Skip the fallback for indices (^...), futures (...=F), and dashed symbols (crypto/FX).
function isFinnhubFriendly(symbol) {
	return /^[A-Z][A-Z.]{0,5}$/.test(String(symbol || ""));
}

// Yahoo crypto symbols ('BTC-USD', 'ETH-USD', ...) -> CoinGecko id.
// Add new pairs here as needed; only the listed ones get routed to CoinGecko.
const COINGECKO_ID_BY_SYMBOL = {
	"BTC-USD": "bitcoin",
	"ETH-USD": "ethereum",
	"SOL-USD": "solana",
	"ADA-USD": "cardano",
	"XRP-USD": "ripple",
	"DOGE-USD": "dogecoin",
	"BNB-USD": "binancecoin"
};

function isCryptoSymbol(symbol) {
	return Object.prototype.hasOwnProperty.call(COINGECKO_ID_BY_SYMBOL, String(symbol || ""));
}

module.exports = NodeHelper.create({
	start() {
		this.cache = new Map();
		this.lastFetchAt = 0;
		this.inflight = null;
		// Per-symbol epoch ms of the last successful (non-error) value, so we can
		// mark how stale each served quote is.
		this.cachedAt = new Map();
		this.loadCacheFromDisk();
		console.log(`Starting node_helper for: ${this.name}`);
	},

	// Load the persisted quotes so the very first render after a restart can show
	// last-good (stale-marked) data even before the first successful fetch.
	loadCacheFromDisk() {
		try {
			if (!fs.existsSync(CACHE_FILE)) return;
			const raw = fs.readFileSync(CACHE_FILE, "utf8");
			const parsed = JSON.parse(raw);
			const savedAt = Number(parsed && parsed.savedAt) || 0;
			if (!savedAt || Date.now() - savedAt > CACHE_MAX_AGE_MS) return;
			const quotes = Array.isArray(parsed && parsed.quotes) ? parsed.quotes : [];
			for (const q of quotes) {
				if (q && q.symbol && !q.error) {
					this.cache.set(q.symbol, q);
					this.cachedAt.set(q.symbol, Number(q.cachedAt) || savedAt);
				}
			}
			console.log(`[MMM-MarketTicker] Loaded ${this.cache.size} cached quotes from disk`);
		} catch (err) {
			console.warn(`[MMM-MarketTicker] Failed to load cache: ${err && err.message}`);
		}
	},

	// Persist current good quotes atomically (temp file + rename) so a crash
	// mid-write can never corrupt the cache that playback/render depends on.
	saveCacheToDisk() {
		try {
			const dir = path.dirname(CACHE_FILE);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			const quotes = [];
			for (const [symbol, q] of this.cache.entries()) {
				if (q && !q.error) {
					quotes.push({ ...q, cachedAt: this.cachedAt.get(symbol) || Date.now() });
				}
			}
			const payload = JSON.stringify({ savedAt: Date.now(), quotes });
			const tmp = `${CACHE_FILE}.tmp`;
			fs.writeFileSync(tmp, payload);
			fs.renameSync(tmp, CACHE_FILE);
		} catch (err) {
			console.warn(`[MMM-MarketTicker] Failed to write cache: ${err && err.message}`);
		}
	},

	// Build the response for one requested symbol, attaching staleness metadata.
	// `fresh` = the value came from the fetch that just completed this tick.
	buildServedQuote(symbol, freshByKey) {
		const fresh = freshByKey.get(symbol);
		if (fresh && !fresh.error) {
			return { ...fresh, stale: false };
		}
		const cached = this.cache.get(symbol);
		if (cached && !cached.error) {
			return {
				...cached,
				stale: true,
				cachedAt: this.cachedAt.get(symbol) || this.lastFetchAt || null
			};
		}
		// No good value ever seen for this symbol.
		return fresh || { symbol, error: "no data" };
	},

	fetchSymbol(symbol) {
		return new Promise((resolve) => {
			const encoded = encodeURIComponent(symbol);
			const path = `/v8/finance/chart/${encoded}?interval=1d&range=2d`;
			const options = {
				hostname: YAHOO_HOST,
				path,
				method: "GET",
				headers: {
					"User-Agent":
						"Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
					Accept: "application/json"
				},
				timeout: REQUEST_TIMEOUT_MS
			};

			const req = https.request(options, (res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => (body += chunk));
				res.on("end", () => {
					if (res.statusCode < 200 || res.statusCode >= 300) {
						resolve({ symbol, error: `http ${res.statusCode}` });
						return;
					}
					try {
						const parsed = JSON.parse(body);
						const result = parsed && parsed.chart && Array.isArray(parsed.chart.result) ? parsed.chart.result[0] : null;
						if (!result || !result.meta) {
							resolve({ symbol, error: "no result" });
							return;
						}
						const meta = result.meta;
						const price = Number(meta.regularMarketPrice);
						const prevClose = Number(
							Number.isFinite(meta.chartPreviousClose) ? meta.chartPreviousClose : meta.previousClose
						);
						const change = Number.isFinite(price) && Number.isFinite(prevClose) ? price - prevClose : NaN;
						const changePct = Number.isFinite(change) && prevClose ? (change / prevClose) * 100 : NaN;
						resolve({
							symbol,
							price,
							previousClose: prevClose,
							change,
							changePct,
							currency: String(meta.currency || ""),
							exchange: String(meta.exchangeName || "")
						});
					} catch (err) {
						resolve({ symbol, error: `parse: ${err.message}` });
					}
				});
			});

			req.on("timeout", () => {
				req.destroy(new Error("timeout"));
			});
			req.on("error", (err) => {
				resolve({ symbol, error: err.message || "request error" });
			});
			req.end();
		});
	},

	fetchSymbolFinnhub(symbol, apiKey) {
		return new Promise((resolve) => {
			if (!apiKey) {
				resolve({ symbol, error: "no fallback key" });
				return;
			}
			const encoded = encodeURIComponent(symbol);
			const path = `/api/v1/quote?symbol=${encoded}&token=${encodeURIComponent(apiKey)}`;
			const req = https.request(
				{
					hostname: FINNHUB_HOST,
					path,
					method: "GET",
					headers: { Accept: "application/json" },
					timeout: REQUEST_TIMEOUT_MS
				},
				(res) => {
					let body = "";
					res.setEncoding("utf8");
					res.on("data", (chunk) => (body += chunk));
					res.on("end", () => {
						if (res.statusCode < 200 || res.statusCode >= 300) {
							resolve({ symbol, error: `finnhub http ${res.statusCode}` });
							return;
						}
						try {
							const parsed = JSON.parse(body);
							const price = Number(parsed.c);
							const prevClose = Number(parsed.pc);
							const change = Number.isFinite(parsed.d) ? Number(parsed.d) : NaN;
							const changePct = Number.isFinite(parsed.dp) ? Number(parsed.dp) : NaN;
							if (!Number.isFinite(price) || price === 0) {
								resolve({ symbol, error: "finnhub no price" });
								return;
							}
							resolve({
								symbol,
								price,
								previousClose: prevClose,
								change,
								changePct,
								source: "finnhub"
							});
						} catch (err) {
							resolve({ symbol, error: `finnhub parse: ${err.message}` });
						}
					});
				}
			);
			req.on("timeout", () => req.destroy(new Error("timeout")));
			req.on("error", (err) => resolve({ symbol, error: err.message || "finnhub request error" }));
			req.end();
		});
	},

	fetchCryptoBatch(symbols) {
		// CoinGecko's /simple/price supports comma-separated ids in one request.
		const cryptoSymbols = symbols.filter(isCryptoSymbol);
		if (cryptoSymbols.length === 0) return Promise.resolve(new Map());
		const ids = cryptoSymbols.map((s) => COINGECKO_ID_BY_SYMBOL[s]).join(",");
		const path = `/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
		return new Promise((resolve) => {
			const req = https.request(
				{
					hostname: COINGECKO_HOST,
					path,
					method: "GET",
					headers: {
						"User-Agent":
							"Mozilla/5.0 (X11; Linux aarch64) MMM-MarketTicker/1.0",
						Accept: "application/json"
					},
					timeout: REQUEST_TIMEOUT_MS
				},
				(res) => {
					let body = "";
					res.setEncoding("utf8");
					res.on("data", (chunk) => (body += chunk));
					res.on("end", () => {
						const results = new Map();
						if (res.statusCode < 200 || res.statusCode >= 300) {
							console.warn(`[MMM-MarketTicker] CoinGecko http ${res.statusCode}`);
							resolve(results);
							return;
						}
						try {
							const parsed = JSON.parse(body);
							for (const sym of cryptoSymbols) {
								const id = COINGECKO_ID_BY_SYMBOL[sym];
								const entry = parsed && parsed[id];
								if (!entry || typeof entry.usd !== "number") continue;
								const price = Number(entry.usd);
								const changePct = Number(entry.usd_24h_change) || 0;
								const prevClose = price / (1 + changePct / 100);
								const change = price - prevClose;
								results.set(sym, {
									symbol: sym,
									price,
									previousClose: prevClose,
									change,
									changePct,
									currency: "USD",
									source: "coingecko"
								});
							}
						} catch (err) {
							console.warn(`[MMM-MarketTicker] CoinGecko parse: ${err.message}`);
						}
						resolve(results);
					});
				}
			);
			req.on("timeout", () => {
				console.warn("[MMM-MarketTicker] CoinGecko timeout");
				req.destroy(new Error("timeout"));
			});
			req.on("error", (err) => {
				console.warn(`[MMM-MarketTicker] CoinGecko error: ${err.message || "request error"}`);
				resolve(new Map());
			});
			req.end();
		});
	},

	fetchStooqBatch(symbols) {
		// Stooq's CSV endpoint: /q/l/?s=xauusd,wtiusd&f=sd2t2ohlcv&h&e=csv
		const futures = symbols.filter(isStooqFriendly);
		if (futures.length === 0) return Promise.resolve(new Map());
		const stooqList = futures.map((s) => STOOQ_SYMBOL_BY_YAHOO[s]).join(",");
		const path = `/q/l/?s=${stooqList}&f=sd2t2ohlcv&h&e=csv`;
		return new Promise((resolve) => {
			const req = https.request(
				{
					hostname: STOOQ_HOST,
					path,
					method: "GET",
					headers: {
						"User-Agent":
							"Mozilla/5.0 (X11; Linux aarch64) MMM-MarketTicker/1.0",
						Accept: "text/csv,application/csv,text/plain"
					},
					timeout: REQUEST_TIMEOUT_MS
				},
				(res) => {
					let body = "";
					res.setEncoding("utf8");
					res.on("data", (chunk) => (body += chunk));
					res.on("end", () => {
						const results = new Map();
						if (res.statusCode < 200 || res.statusCode >= 300) {
							console.warn(`[MMM-MarketTicker] Stooq http ${res.statusCode}`);
							resolve(results);
							return;
						}
						// CSV: Symbol,Date,Time,Open,High,Low,Close,Volume
						const lines = body.split(/\r?\n/).filter((l) => l && !/^Symbol,/i.test(l));
						const byStooq = new Map();
						for (const line of lines) {
							const parts = line.split(",");
							if (parts.length < 7) continue;
							const sym = parts[0].toLowerCase();
							const open = Number(parts[3]);
							const close = Number(parts[6]);
							if (!Number.isFinite(close) || close === 0) continue;
							byStooq.set(sym, { open, close });
						}
						for (const yahooSym of futures) {
							const stooqSym = STOOQ_SYMBOL_BY_YAHOO[yahooSym];
							const row = byStooq.get(stooqSym);
							if (!row) continue;
							// Use intraday open as the change reference — not a true 24h
							// move but close enough for a marquee. Stooq doesn't expose
							// previous-day close in the simple endpoint.
							const change = row.close - row.open;
							const changePct = row.open ? (change / row.open) * 100 : 0;
							results.set(yahooSym, {
								symbol: yahooSym,
								price: row.close,
								previousClose: row.open,
								change,
								changePct,
								currency: "USD",
								source: "stooq"
							});
						}
						resolve(results);
					});
				}
			);
			req.on("timeout", () => {
				console.warn("[MMM-MarketTicker] Stooq timeout");
				req.destroy(new Error("timeout"));
			});
			req.on("error", (err) => {
				console.warn(`[MMM-MarketTicker] Stooq error: ${err.message || "request error"}`);
				resolve(new Map());
			});
			req.end();
		});
	},

	async fetchAll(symbols, finnhubApiKey) {
		// Crypto goes to CoinGecko, commodity futures go to Stooq — both bypass
		// Yahoo entirely since Yahoo's IP-based throttling silently nukes them
		// from a Pi.
		const [cryptoResults, stooqResults] = await Promise.all([
			this.fetchCryptoBatch(symbols),
			this.fetchStooqBatch(symbols)
		]);

		// Everything else goes to Yahoo.
		const yahooBound = symbols.filter((s) => !isCryptoSymbol(s) && !isStooqFriendly(s));
		const yahooResults = await Promise.all(yahooBound.map((s) => this.fetchSymbol(s)));
		const byKey = new Map(yahooResults.map((r) => [r.symbol, r]));

		// Stitch back in the order the caller asked for.
		const primary = symbols.map((s) => {
			if (cryptoResults.has(s)) return cryptoResults.get(s);
			if (stooqResults.has(s)) return stooqResults.get(s);
			return byKey.get(s) || { symbol: s, error: "no source" };
		});

		// Log any failures so we can see them in mm-server's journal.
		for (const r of primary) {
			if (r && r.error) {
				console.warn(`[MMM-MarketTicker] ${r.symbol} failed: ${r.error}`);
			}
		}

		if (!finnhubApiKey) return primary;

		const failedIndices = primary
			.map((r, i) => (r && r.error && isFinnhubFriendly(r.symbol) ? i : -1))
			.filter((i) => i !== -1);

		if (failedIndices.length === 0) return primary;

		const fallback = await Promise.all(failedIndices.map((i) => this.fetchSymbolFinnhub(primary[i].symbol, finnhubApiKey)));
		failedIndices.forEach((idx, j) => {
			const fb = fallback[j];
			if (fb && !fb.error) primary[idx] = fb;
		});
		return primary;
	},

	sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	},

	// Retry the batch with exponential backoff, but only as long as the whole
	// batch produced nothing usable. A partial success returns immediately —
	// per-symbol failures already fall back to cache downstream.
	async fetchAllWithRetry(symbols, finnhubApiKey, attempts = 3, baseDelayMs = 800) {
		let last = [];
		for (let attempt = 0; attempt < attempts; attempt += 1) {
			try {
				last = await this.fetchAll(symbols, finnhubApiKey);
			} catch (err) {
				console.warn(`[MMM-MarketTicker] fetch attempt ${attempt + 1} threw: ${err && err.message}`);
				last = [];
			}
			const anyGood = Array.isArray(last) && last.some((r) => r && !r.error);
			if (anyGood || attempt === attempts - 1) {
				return last;
			}
			const delay = baseDelayMs * Math.pow(2, attempt);
			console.warn(`[MMM-MarketTicker] all symbols failed; retrying in ${delay}ms`);
			await this.sleep(delay);
		}
		return last;
	},

	async handleGetQuotes(payload) {
		const requested = Array.isArray(payload && payload.symbols) ? payload.symbols.filter(Boolean) : [];
		const finnhubApiKey = String((payload && payload.finnhubApiKey) || "").trim();
		if (requested.length === 0) {
			this.sendSocketNotification("MARKET_QUOTES_RESULT", []);
			return;
		}

		const now = Date.now();
		// Only treat the in-memory cache as a fast-path hit when EVERY requested
		// symbol was last fetched successfully within the interval. lastFetchAt is
		// global, but a failing symbol's cachedAt stops advancing, so per-symbol
		// cachedAt is the correct freshness test — a failed fetch can't masquerade
		// as fresh here.
		const allFresh = requested.every((s) => {
			const at = this.cachedAt.get(s);
			return this.cache.has(s) && at && now - at < FETCH_INTERVAL_MS;
		});

		if (allFresh) {
			this.sendSocketNotification(
				"MARKET_QUOTES_RESULT",
				requested.map((s) => ({ ...this.cache.get(s), stale: false }))
			);
			return;
		}

		if (!this.inflight) {
			this.inflight = this.fetchAllWithRetry(requested, finnhubApiKey)
				.then((results) => {
					let updated = false;
					results.forEach((r) => {
						// Only overwrite cache with good values — never let a fresh
						// error clobber a last-good price.
						if (r && r.symbol && !r.error) {
							this.cache.set(r.symbol, r);
							this.cachedAt.set(r.symbol, Date.now());
							updated = true;
						}
					});
					// Advance the global fetch clock only when at least one symbol
					// actually refreshed, so an all-failed batch doesn't suppress the
					// next retry or make stale data look fresh.
					if (updated) {
						this.lastFetchAt = Date.now();
						this.saveCacheToDisk();
					}
					return results;
				})
				.finally(() => {
					this.inflight = null;
				});
		}

		try {
			const results = await this.inflight;
			const byKey = new Map((results || []).map((r) => [r.symbol, r]));
			this.sendSocketNotification(
				"MARKET_QUOTES_RESULT",
				requested.map((s) => this.buildServedQuote(s, byKey))
			);
		} catch (err) {
			console.warn(`MMM-MarketTicker: fetch failed: ${err && err.message}`);
			const empty = new Map();
			this.sendSocketNotification(
				"MARKET_QUOTES_RESULT",
				requested.map((s) => this.buildServedQuote(s, empty))
			);
		}
	},

	socketNotificationReceived(notification, payload) {
		if (notification === "GET_MARKET_QUOTES") {
			this.handleGetQuotes(payload);
		}
	}
});
