const NodeHelper = require("node_helper");
const fs = require("fs");
const path = require("path");

module.exports = NodeHelper.create({
    start: function() {
        console.log("Starting node_helper for: " + this.name);
    },

    socketNotificationReceived: function(notification, payload) {
        if (notification === "SPYTRACKER_GET_REPORT") {
            const report = this.buildReport(payload.spyTrackerPath);
            this.sendSocketNotification("SPYTRACKER_REPORT", report);
        }
    },

    buildReport: function(spyTrackerPath) {
        try {
            const root = spyTrackerPath;
            const planPath = path.join(root, "data_external", "daily_plan.json");
            const statePath = path.join(root, "data_external", "daily_state.json");
            const historyPath = path.join(root, "data_external", "trade_history.json");
            const cfgPath = path.join(root, "my_positions.json");

            const plan = this._readJson(planPath) || {};
            const state = this._readJson(statePath) || {};
            const history = this._readJson(historyPath) || [];
            const cfg = this._readJson(cfgPath) || { account_size: 50000 };

            const accountSize = parseFloat(cfg.account_size) || 50000;
            const totalRealized = history.reduce((sum, h) => sum + (parseFloat(h.realized_pnl) || 0), 0);
            const totalAccount = accountSize + totalRealized;

            // Streak calculation
            let wins = 0;
            let losses = 0;
            let currentStreak = 0;
            let streakType = "none"; // 'win', 'loss', 'none'

            // Sort by date ascending
            const sorted = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));
            for (const h of sorted) {
                const pnl = parseFloat(h.realized_pnl) || 0;
                if (pnl > 0) {
                    wins++;
                    if (streakType === "win") {
                        currentStreak++;
                    } else {
                        streakType = "win";
                        currentStreak = 1;
                    }
                } else if (pnl < 0) {
                    losses++;
                    if (streakType === "loss") {
                        currentStreak++;
                    } else {
                        streakType = "loss";
                        currentStreak = 1;
                    }
                }
            }

            let streakText = "—";
            let streakClass = "";
            if (streakType === "win") {
                streakText = currentStreak + "W";
                streakClass = "spy-pos";
            } else if (streakType === "loss") {
                streakText = currentStreak + "L";
                streakClass = "spy-neg";
            }

            // Today's trade
            const executed = state.executed || [];
            const primary = plan.primary || {};
            const todayTicker = executed.length > 0 ? executed[0].ticker : primary.ticker || null;
            const todayShares = executed.length > 0 ? executed[0].shares : primary.shares || null;
            const todayEntry = executed.length > 0 && executed[0].entry_price
                ? executed[0].entry_price
                : primary.entry_price || null;
            let todayPnl = (state.close_summary && state.close_summary.realized_pnl !== undefined)
                ? parseFloat(state.close_summary.realized_pnl)
                : 0;
            // Derive exit from realized P&L and shares so we show the actual fill price.
            let todayExit = null;
            if (todayEntry !== null && todayShares && todayPnl !== 0) {
                todayExit = todayEntry + (todayPnl / todayShares);
            }

            return {
                date: plan.date || new Date().toISOString().slice(0, 10),
                status: plan.status || "unknown",
                target: parseFloat(plan.target_profit) || 200,
                max_loss: parseFloat(plan.max_daily_loss) || 500,
                total_account: totalAccount,
                total_pnl: totalRealized,
                today_pnl: todayPnl,
                today_ticker: todayTicker,
                today_shares: todayShares,
                today_entry: todayEntry,
                today_exit: todayExit,
                wins: wins,
                losses: losses,
                streak_text: streakText,
                streak_class: streakClass,
                history_count: history.length
            };
        } catch (err) {
            console.error("[MMM-SpyTrackerReport] error:", err);
            return { error: err.message };
        }
    },

    _readJson: function(filePath) {
        try {
            if (!fs.existsSync(filePath)) return null;
            return JSON.parse(fs.readFileSync(filePath, "utf8"));
        } catch (err) {
            console.error("[MMM-SpyTrackerReport] failed to read " + filePath + ": " + err.message);
            return null;
        }
    }
});
