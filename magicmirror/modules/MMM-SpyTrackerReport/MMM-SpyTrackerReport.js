/* global Module, Log, moment */

Module.register("MMM-SpyTrackerReport", {
    defaults: {
        spyTrackerPath: "/mnt/c/Users/hyoni/Documents/Dev_Apps/spy_tracker",
        updateInterval: 5 * 60 * 1000, // 5 minutes
        fadeSpeed: 500,
        currency: "$"
    },

    getStyles: function() {
        return ["MMM-SpyTrackerReport.css"];
    },

    start: function() {
        Log.info("Starting module: " + this.name);
        this.report = null;
        this.loaded = false;
        this.sendSocketNotification("SPYTRACKER_GET_REPORT", {
            spyTrackerPath: this.config.spyTrackerPath
        });
        var self = this;
        setInterval(function() {
            self.sendSocketNotification("SPYTRACKER_GET_REPORT", {
                spyTrackerPath: self.config.spyTrackerPath
            });
        }, this.config.updateInterval);
    },

    socketNotificationReceived: function(notification, payload) {
        if (notification === "SPYTRACKER_REPORT") {
            this.report = payload;
            this.loaded = true;
            this.updateDom(this.config.fadeSpeed);
        }
    },

    getDom: function() {
        var wrapper = document.createElement("div");
        wrapper.className = "spytracker-report";

        if (!this.loaded) {
            wrapper.innerHTML = "<span class=\"dimmed\">Loading SPY_TRACKER report...</span>";
            return wrapper;
        }

        if (!this.report || this.report.error) {
            wrapper.innerHTML = "<span class=\"dimmed\">SPY_TRACKER: " + (this.report ? this.report.error : "no data") + "</span>";
            return wrapper;
        }

        var r = this.report;
        var cur = this.config.currency;

        // Header
        var header = document.createElement("div");
        header.className = "spy-header";
        header.innerHTML = "SPY_TRACKER DAILY REPORT";
        wrapper.appendChild(header);

        // Date line
        var dateLine = document.createElement("div");
        dateLine.className = "spy-date";
        dateLine.innerHTML = r.date ? moment(r.date).format("dddd, MMMM D") : "";
        wrapper.appendChild(dateLine);

        // KPI grid
        var kpiRow = document.createElement("div");
        kpiRow.className = "spy-kpi-row";

        var total = this._kpi("Account", cur + this._fmtMoney(r.total_account));
        var pnl = this._kpi("Today", (r.today_pnl >= 0 ? "+" : "") + cur + this._fmtMoney(r.today_pnl),
                              r.today_pnl >= 0 ? "spy-pos" : "spy-neg");
        var streak = this._kpi("Streak", r.streak_text, r.streak_class);
        var wins = this._kpi("Win / Loss", r.wins + " / " + r.losses);

        kpiRow.appendChild(total);
        kpiRow.appendChild(pnl);
        kpiRow.appendChild(streak);
        kpiRow.appendChild(wins);
        wrapper.appendChild(kpiRow);

        // Today's trade
        if (r.today_ticker) {
            var trade = document.createElement("div");
            trade.className = "spy-trade";
            var tradeHtml = "<span class=\"spy-label\">Today's Trade:</span> ";
            tradeHtml += "<b>" + r.today_ticker + "</b> — ";
            tradeHtml += r.today_shares + " sh @ " + cur + this._fmtMoney(r.today_entry);
            tradeHtml += " &rarr; " + cur + this._fmtMoney(r.today_exit);
            tradeHtml += " <span class=\"" + (r.today_pnl >= 0 ? "spy-pos" : "spy-neg") + "\">";
            tradeHtml += (r.today_pnl >= 0 ? "+" : "") + cur + this._fmtMoney(r.today_pnl) + "</span>";
            trade.innerHTML = tradeHtml;
            wrapper.appendChild(trade);
        }

        // Status line
        var status = document.createElement("div");
        status.className = "spy-status";
        status.innerHTML = "Status: <b>" + r.status + "</b> · Target: " + cur + r.target + " · Loss limit: " + cur + r.max_loss;
        wrapper.appendChild(status);

        return wrapper;
    },

    _kpi: function(label, value, valueClass) {
        var box = document.createElement("div");
        box.className = "spy-kpi";
        var lbl = document.createElement("div");
        lbl.className = "spy-kpi-label";
        lbl.innerHTML = label;
        var val = document.createElement("div");
        val.className = "spy-kpi-value" + (valueClass ? " " + valueClass : "");
        val.innerHTML = value;
        box.appendChild(lbl);
        box.appendChild(val);
        return box;
    },

    _fmtMoney: function(n) {
        if (n === undefined || n === null) return "0.00";
        return parseFloat(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
});
