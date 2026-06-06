Module.register("MMM-MarketTicker", {
	defaults: {
		symbols: [
			{ symbol: "^GSPC", label: "S&P 500" },
			{ symbol: "SPY", label: "SPY" },
			{ symbol: "^DJI", label: "DOW" },
			{ symbol: "^IXIC", label: "NASDAQ" },
			{ symbol: "QQQ", label: "QQQ" },
			{ symbol: "^GSPTSE", label: "TSX" },
			{ symbol: "^FTSE", label: "FTSE" },
			{ symbol: "^GDAXI", label: "DAX" },
			{ symbol: "^N225", label: "NIKKEI" },
			{ symbol: "GC=F", label: "GOLD" },
			{ symbol: "CL=F", label: "OIL" },
			{ symbol: "BTC-USD", label: "BTC" },
			{ symbol: "ETH-USD", label: "ETH" }
		],
		updateInterval: 5 * 60 * 1000,
		displayMode: "cycle", // "cycle" = one at a time with fade; "scroll" = marquee
		cycleIntervalMs: 5000,
		scrollSecondsPerItem: 6,
		decimals: 2,
		showCurrency: false,
		initialLoadDelay: 1000,
		// Optional fallback when Yahoo fails. Free tier covers US stocks/ETFs only
		// (not indices, futures, or crypto). Set in your local config.js, never commit.
		finnhubApiKey: ""
	},

	getStyles: function () {
		return ["MMM-MarketTicker.css"];
	},

	start: function () {
		this.quotes = [];
		this.loaded = false;
		this.cycleIndex = 0;
		this.cycleTimer = null;
		setTimeout(() => this.requestQuotes(), this.config.initialLoadDelay);
		setInterval(() => this.requestQuotes(), this.config.updateInterval);
	},

	startCycleTimer: function () {
		if (this.cycleTimer) {
			clearInterval(this.cycleTimer);
		}
		const interval = Math.max(1500, Number(this.config.cycleIntervalMs) || 5000);
		this.cycleTimer = setInterval(() => {
			if (!this.quotes.length) return;
			this.cycleIndex = (this.cycleIndex + 1) % this.quotes.length;
			this.updateDom(400);
		}, interval);
	},

	requestQuotes: function () {
		this.sendSocketNotification("GET_MARKET_QUOTES", {
			symbols: this.config.symbols.map((s) => (typeof s === "string" ? s : s.symbol)),
			finnhubApiKey: String(this.config.finnhubApiKey || "").trim()
		});
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification !== "MARKET_QUOTES_RESULT") return;
		const labels = {};
		this.config.symbols.forEach((s) => {
			if (s && typeof s === "object" && s.symbol) labels[s.symbol] = s.label || s.symbol;
		});
		this.quotes = (Array.isArray(payload) ? payload : []).map((q) => ({
			...q,
			label: labels[q.symbol] || q.label || q.symbol
		}));
		this.loaded = true;
		if (this.cycleIndex >= this.quotes.length) {
			this.cycleIndex = 0;
		}
		this.updateDom();
		if (this.config.displayMode === "cycle" && !this.cycleTimer) {
			this.startCycleTimer();
		}
	},

	// Pick a sane number of decimals based on magnitude — bigger numbers don't
	// need cents, sub-dollar numbers usually need extra precision.
	pickDecimals: function (n) {
		const abs = Math.abs(Number(n) || 0);
		if (abs >= 1000) return 0;        // 60,612 (no decimals)
		if (abs >= 1) return 2;           // 1,554.15
		if (abs >= 0.01) return 4;        // 0.4321
		return 6;                          // 0.000123 (memecoin territory)
	},

	formatPrice: function (n) {
		if (!Number.isFinite(n)) return "--";
		const dp = this.pickDecimals(n);
		return n.toLocaleString(undefined, {
			minimumFractionDigits: dp,
			maximumFractionDigits: dp
		});
	},

	formatChange: function (change, pct) {
		if (!Number.isFinite(change) || !Number.isFinite(pct)) return "";
		const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "•";
		const sign = change > 0 ? "+" : change < 0 ? "" : "";
		const pctSign = pct > 0 ? "+" : "";
		const dp = this.pickDecimals(change);
		// toLocaleString puts the thousand separator in for big moves
		// (e.g. ▲ +1,243.21 instead of +1243.21).
		const absChange = Math.abs(change).toLocaleString(undefined, {
			minimumFractionDigits: dp,
			maximumFractionDigits: dp
		});
		return `${arrow} ${sign}${absChange} (${pctSign}${pct.toFixed(2)}%)`;
	},

	renderItem: function (q) {
		const item = document.createElement("span");
		item.className = "mt-item";

		const label = document.createElement("span");
		label.className = "mt-label";
		label.textContent = q.label;
		item.appendChild(label);

		const price = document.createElement("span");
		price.className = "mt-price";
		price.textContent = this.formatPrice(q.price);
		item.appendChild(price);

		if (Number.isFinite(q.change)) {
			const delta = document.createElement("span");
			delta.className = "mt-delta " + (q.change > 0 ? "mt-up" : q.change < 0 ? "mt-down" : "mt-flat");
			delta.textContent = this.formatChange(q.change, q.changePct);
			item.appendChild(delta);
		} else if (q.error) {
			const err = document.createElement("span");
			err.className = "mt-delta mt-flat";
			err.textContent = "—";
			item.appendChild(err);
		}

		return item;
	},

	getDom: function () {
		const wrapper = document.createElement("div");
		wrapper.className = "mt-wrapper";

		if (!this.loaded) {
			wrapper.innerHTML = "Loading markets…";
			wrapper.classList.add("dimmed", "small");
			return wrapper;
		}
		if (!this.quotes.length) {
			wrapper.innerHTML = "No market data";
			wrapper.classList.add("dimmed", "small");
			return wrapper;
		}

		if (this.config.displayMode === "cycle") {
			wrapper.classList.add("mt-cycle");
			const current = this.quotes[this.cycleIndex % this.quotes.length];
			wrapper.appendChild(this.renderItem(current));
			return wrapper;
		}

		// Static row — all items side-by-side, no motion. Good for a
		// short symbol list (2-4 items) where scrolling looks silly.
		if (this.config.displayMode === "static") {
			wrapper.classList.add("mt-static");
			this.quotes.forEach((q) => wrapper.appendChild(this.renderItem(q)));
			return wrapper;
		}

		const track = document.createElement("div");
		track.className = "mt-track";
		// Duplicate the content so the marquee can loop seamlessly when -50% slides.
		const buildRun = () => {
			const run = document.createElement("span");
			run.className = "mt-run";
			this.quotes.forEach((q) => run.appendChild(this.renderItem(q)));
			return run;
		};
		track.appendChild(buildRun());
		track.appendChild(buildRun());

		const seconds = Math.max(20, this.quotes.length * (Number(this.config.scrollSecondsPerItem) || 6));
		track.style.animationDuration = `${seconds}s`;

		wrapper.appendChild(track);
		return wrapper;
	}
});
