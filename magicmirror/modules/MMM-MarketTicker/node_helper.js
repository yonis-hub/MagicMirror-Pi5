const https = require("https");
const NodeHelper = require("node_helper");

const YAHOO_HOST = "query1.finance.yahoo.com";
const FINNHUB_HOST = "finnhub.io";
const COINGECKO_HOST = "api.coingecko.com";
const REQUEST_TIMEOUT_MS = 6000;
const FETCH_INTERVAL_MS = 60 * 1000;

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
		console.log(`Starting node_helper for: ${this.name}`);
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

	async fetchAll(symbols, finnhubApiKey) {
		// Crypto goes to CoinGecko directly — Yahoo rate-limits them aggressively.
		const cryptoResults = await this.fetchCryptoBatch(symbols);

		// Everything else goes to Yahoo first.
		const nonCrypto = symbols.filter((s) => !isCryptoSymbol(s));
		const yahooResults = await Promise.all(nonCrypto.map((s) => this.fetchSymbol(s)));
		const byKey = new Map(yahooResults.map((r) => [r.symbol, r]));

		// Stitch back in the order the caller asked for.
		const primary = symbols.map((s) =>
			cryptoResults.has(s) ? cryptoResults.get(s) : byKey.get(s) || { symbol: s, error: "no source" }
		);

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

	async handleGetQuotes(payload) {
		const requested = Array.isArray(payload && payload.symbols) ? payload.symbols.filter(Boolean) : [];
		const finnhubApiKey = String((payload && payload.finnhubApiKey) || "").trim();
		if (requested.length === 0) {
			this.sendSocketNotification("MARKET_QUOTES_RESULT", []);
			return;
		}

		const now = Date.now();
		const fresh = now - this.lastFetchAt < FETCH_INTERVAL_MS;
		const cachedAll = fresh && requested.every((s) => this.cache.has(s));

		if (cachedAll) {
			this.sendSocketNotification(
				"MARKET_QUOTES_RESULT",
				requested.map((s) => this.cache.get(s))
			);
			return;
		}

		if (!this.inflight) {
			this.inflight = this.fetchAll(requested, finnhubApiKey)
				.then((results) => {
					results.forEach((r) => {
						if (r && r.symbol) this.cache.set(r.symbol, r);
					});
					this.lastFetchAt = Date.now();
					return results;
				})
				.finally(() => {
					this.inflight = null;
				});
		}

		try {
			const results = await this.inflight;
			const byKey = new Map(results.map((r) => [r.symbol, r]));
			this.sendSocketNotification(
				"MARKET_QUOTES_RESULT",
				requested.map((s) => byKey.get(s) || this.cache.get(s) || { symbol: s, error: "no data" })
			);
		} catch (err) {
			console.warn(`MMM-MarketTicker: fetch failed: ${err && err.message}`);
			this.sendSocketNotification(
				"MARKET_QUOTES_RESULT",
				requested.map((s) => this.cache.get(s) || { symbol: s, error: "fetch failed" })
			);
		}
	},

	socketNotificationReceived(notification, payload) {
		if (notification === "GET_MARKET_QUOTES") {
			this.handleGetQuotes(payload);
		}
	}
});
