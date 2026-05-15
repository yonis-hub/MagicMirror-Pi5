const https = require("https");
const NodeHelper = require("node_helper");

const YAHOO_HOST = "query1.finance.yahoo.com";
const REQUEST_TIMEOUT_MS = 6000;
const FETCH_INTERVAL_MS = 60 * 1000;

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

	async fetchAll(symbols) {
		const results = await Promise.all(symbols.map((s) => this.fetchSymbol(s)));
		return results;
	},

	async handleGetQuotes(payload) {
		const requested = Array.isArray(payload && payload.symbols) ? payload.symbols.filter(Boolean) : [];
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
			this.inflight = this.fetchAll(requested)
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
