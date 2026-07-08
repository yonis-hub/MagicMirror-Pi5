// Standalone test for the report builder (does not require MagicMirror).
const fs = require("fs");
const path = require("path");

function readJson(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
        console.error("failed to read " + filePath + ": " + err.message);
        return null;
    }
}

function buildReport(spyTrackerPath) {
    const root = spyTrackerPath;
    const plan = readJson(path.join(root, "data_external", "daily_plan.json")) || {};
    const state = readJson(path.join(root, "data_external", "daily_state.json")) || {};
    const history = readJson(path.join(root, "data_external", "trade_history.json")) || [];
    const cfg = readJson(path.join(root, "my_positions.json")) || { account_size: 50000 };

    const accountSize = parseFloat(cfg.account_size) || 50000;
    const totalRealized = history.reduce((sum, h) => sum + (parseFloat(h.realized_pnl) || 0), 0);
    const totalAccount = accountSize + totalRealized;

    let wins = 0;
    let losses = 0;
    let currentStreak = 0;
    let streakType = "none";
    const sorted = [...history].sort((a, b) => new Date(a.date) - new Date(b.date));
    for (const h of sorted) {
        const pnl = parseFloat(h.realized_pnl) || 0;
        if (pnl > 0) {
            wins++;
            if (streakType === "win") currentStreak++;
            else { streakType = "win"; currentStreak = 1; }
        } else if (pnl < 0) {
            losses++;
            if (streakType === "loss") currentStreak++;
            else { streakType = "loss"; currentStreak = 1; }
        }
    }

    let streakText = "—";
    if (streakType === "win") streakText = currentStreak + "W";
    else if (streakType === "loss") streakText = currentStreak + "L";

    const executed = state.executed || [];
    const primary = plan.primary || {};
    const todayTicker = executed.length > 0 ? executed[0].ticker : primary.ticker || null;
    const todayShares = executed.length > 0 ? executed[0].shares : primary.shares || null;
    const todayEntry = executed.length > 0 && executed[0].entry_price
        ? executed[0].entry_price
        : primary.entry_price || null;
    const todayPnl = (state.close_summary && state.close_summary.realized_pnl !== undefined)
        ? parseFloat(state.close_summary.realized_pnl) : 0;
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
        today_pnl: todayPnl,
        today_ticker: todayTicker,
        today_shares: todayShares,
        today_entry: todayEntry,
        today_exit: todayExit,
        wins: wins,
        losses: losses,
        streak_text: streakText,
        history_count: history.length
    };
}

const report = buildReport("/mnt/c/Users/hyoni/Documents/Dev_Apps/spy_tracker");
console.log(JSON.stringify(report, null, 2));
