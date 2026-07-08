/* global Module, Log, moment */

Module.register("MMM-SpyTrackerReport", {
    defaults: {
        spyTrackerPath: "/home/hyonis/spy_tracker",
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

    // One compact ticker line, styled to sit alongside MMM-MarketTicker in
    // the bottom bar: LABEL  $account  [▲ +$pnl]  trade detail  streak/record
    getDom: function() {
        var wrapper = document.createElement("div");
        wrapper.className = "spytracker-report";

        if (!this.loaded) {
            wrapper.innerHTML = "<span class=\"dimmed\">SPY_TRACKER loading…</span>";
            return wrapper;
        }

        if (!this.report || this.report.error) {
            wrapper.innerHTML = "<span class=\"dimmed\">SPY_TRACKER: " + (this.report ? this.report.error : "no data") + "</span>";
            return wrapper;
        }

        var r = this.report;
        var cur = this.config.currency;

        var label = document.createElement("span");
        label.className = "spy-tick-label";
        label.textContent = "SPY_TRACKER";
        wrapper.appendChild(label);

        var acct = document.createElement("span");
        acct.className = "spy-tick-price";
        acct.textContent = cur + this._fmtMoney(r.total_account);
        wrapper.appendChild(acct);

        var pnl = parseFloat(r.today_pnl) || 0;
        var delta = document.createElement("span");
        delta.className = "spy-tick-delta " + (pnl > 0 ? "spy-tick-up" : pnl < 0 ? "spy-tick-down" : "spy-tick-flat");
        var arrow = pnl > 0 ? "▲" : pnl < 0 ? "▼" : "•";
        var sign = pnl > 0 ? "+" : pnl < 0 ? "-" : "";
        delta.textContent = arrow + " " + sign + cur + this._fmtMoney(Math.abs(pnl)) + " today";
        wrapper.appendChild(delta);

        var detail = document.createElement("span");
        detail.className = "spy-tick-detail";
        if (r.today_ticker) {
            var txt = r.today_ticker + " · " + (r.today_shares || "?") + " sh @ " + cur + this._fmtMoney(r.today_entry);
            if (r.today_exit) {
                txt += " → " + cur + this._fmtMoney(r.today_exit);
            }
            detail.textContent = txt;
        } else {
            detail.textContent = "no trade yet";
        }
        wrapper.appendChild(detail);

        if (r.wins + r.losses > 0) {
            var record = document.createElement("span");
            record.className = "spy-tick-detail";
            record.textContent = r.streak_text + " · " + r.wins + "W-" + r.losses + "L";
            wrapper.appendChild(record);
        }

        return wrapper;
    },

    _fmtMoney: function(n) {
        if (n === undefined || n === null) return "0.00";
        return parseFloat(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
});
