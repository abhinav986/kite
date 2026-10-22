// Backtests the gap-reversal opening-range strategy and closingTwoEngulfe on 5-minute candles
// downloaded by fetchData.js. Results are printed and written to server/backtest/results.json.
//
//   node server/backtest/run.js [--risk 1000] [--slippage 0.02]
//
// Fill assumptions (deliberately conservative):
//  - if stop and target are both inside one candle, the stop is assumed to hit first
//  - on the candle where an entry triggers, only the stop is checked (no target credit)
//  - stop/market fills pay slippage; target (limit) fills do not
//  - every position is closed by 15:20 at the latest
//  - Zerodha equity-intraday charges are deducted from every trade

import fs from "fs";
import path from "path";
import { closingTwoEngulfe } from "../strategies.js";

const DATA_DIR = path.join(process.cwd(), "server", "backtest", "data");
const IST_OFFSET_MS = 330 * 60000;

function getArg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : fallback;
}

const RISK_PER_TRADE = Number(getArg("risk", 1000));
const MAX_NOTIONAL = Number(getArg("maxNotional", 500000));
const SLIPPAGE = Number(getArg("slippage", 0.02)) / 100;
const SQUARE_OFF_MINUTE = 15 * 60 + 15; // exit at close of the 15:15 candle

// ---------- data ----------

function loadDays(file) {
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  const days = new Map();
  for (const [ts, open, high, low, close, volume] of rows) {
    const ist = new Date(ts + IST_OFFSET_MS);
    const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    if (minute < 9 * 60 + 15 || minute > 15 * 60 + 25) continue;
    const key = ist.toISOString().slice(0, 10);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push({ date: new Date(ts), minute, open, high, low, close, volume });
  }
  // only full regular sessions (skips muhurat/special sessions and data gaps)
  return [...days.entries()]
    .filter(([, candles]) => candles.length >= 70 && candles[0].minute === 9 * 60 + 15)
    .map(([day, candles]) => ({ day, candles }));
}

// ---------- costs ----------

function charges(side, qty, entry, exit) {
  const buyValue = qty * (side === "long" ? entry : exit);
  const sellValue = qty * (side === "long" ? exit : entry);
  const turnover = buyValue + sellValue;
  const brokerage = Math.min(20, buyValue * 0.0003) + Math.min(20, sellValue * 0.0003);
  const stt = sellValue * 0.00025;
  const exchange = turnover * 0.0000297;
  const sebi = turnover * 0.000001;
  const stamp = buyValue * 0.00003;
  const gst = 0.18 * (brokerage + exchange + sebi);
  return brokerage + stt + exchange + sebi + stamp + gst;
}

function slip(price, side, isEntry) {
  // adverse slippage: buying costs more, selling gets less
  const buying = (side === "long") === isEntry;
  return buying ? price * (1 + SLIPPAGE) : price * (1 - SLIPPAGE);
}

// ---------- trade simulation ----------

// Walks candles from startIdx managing one position. entryIdx candle only checks the stop.
function simulate({ candles, entryIdx, side, entry, stop, target }) {
  const long = side === "long";
  for (let k = entryIdx; k < candles.length; k += 1) {
    const c = candles[k];
    const isEntryBar = k === entryIdx;
    if (stop != null) {
      if (!isEntryBar && (long ? c.open <= stop : c.open >= stop)) {
        return { exit: c.open, reason: "stop", exitIdx: k };
      }
      if (long ? c.low <= stop : c.high >= stop) {
        return { exit: stop, reason: "stop", exitIdx: k };
      }
    }
    if (!isEntryBar && target != null) {
      if (long ? c.open >= target : c.open <= target) return { exit: c.open, reason: "target", exitIdx: k, limit: true };
      if (long ? c.high >= target : c.low <= target) return { exit: target, reason: "target", exitIdx: k, limit: true };
    }
    if (c.minute >= SQUARE_OFF_MINUTE) {
      return { exit: c.close, reason: "time", exitIdx: k };
    }
  }
  const last = candles[candles.length - 1];
  return { exit: last.close, reason: "time", exitIdx: candles.length - 1 };
}

// sizingRisk: per-share risk used for position size and R when the trade has no stop
function buildTrade({ symbol, day, candles, entryIdx, side, entry, stop, target, sizingRisk }) {
  const riskPerShare = stop == null ? sizingRisk : Math.abs(entry - stop);
  if (!(riskPerShare > 0)) return null;
  const qty = Math.floor(Math.min(RISK_PER_TRADE / riskPerShare, MAX_NOTIONAL / entry));
  if (qty < 1) return null;

  const result = simulate({ candles, entryIdx, side, entry, stop, target });
  const fillEntry = slip(entry, side, true);
  const fillExit = result.limit ? result.exit : slip(result.exit, side, false);
  const gross = (side === "long" ? fillExit - fillEntry : fillEntry - fillExit) * qty;
  const cost = charges(side, qty, fillEntry, fillExit);
  return {
    symbol,
    day,
    time: candles[entryIdx].date.toISOString(),
    side,
    qty,
    entry: +fillEntry.toFixed(2),
    stop: stop == null ? null : +stop.toFixed(2),
    target: target == null ? null : +target.toFixed(2),
    exit: +fillExit.toFixed(2),
    reason: result.reason,
    gross: +gross.toFixed(2),
    cost: +cost.toFixed(2),
    net: +(gross - cost).toFixed(2),
    r: +((gross - cost) / (riskPerShare * qty)).toFixed(3),
  };
}

// ---------- strategy 1: gap reversal on first-candle break ----------

function orbTrades({ symbol, day, candles, prevClose }, opts) {
  const c1 = candles[0];
  const c2 = candles[1];
  const gapPct = ((c1.open - prevClose) / prevClose) * 100;
  const absGap = Math.abs(gapPct);
  if (absGap < opts.minGap || absGap >= opts.maxGap) return null;

  const side = gapPct > 0 ? "short" : "long";
  const level = side === "short" ? c1.low : c1.high;
  const stop = side === "short" ? c1.high : c1.low;
  let entry;
  let entryIdx;

  if (opts.entry === "break") {
    const broke = side === "short" ? c2.low < level : c2.high > level;
    if (!broke) return null;
    // a candle that opens beyond the level fills at its open
    entry = side === "short" ? Math.min(level, c2.open) : Math.max(level, c2.open);
    entryIdx = 1;
  } else {
    const closedBeyond = side === "short" ? c2.close < level : c2.close > level;
    if (!closedBeyond) return null;
    entry = c2.close;
    entryIdx = 2; // in the market from the 9:25 candle
  }

  const risk = Math.abs(entry - stop);
  const target = opts.rr == null ? null : side === "short" ? entry - risk * opts.rr : entry + risk * opts.rr;
  const trade = buildTrade({ symbol, day, candles, entryIdx, side, entry, stop, target });
  if (trade) trade.gapPct = +gapPct.toFixed(2);
  return trade;
}

// ---------- strategy 2: closingTwoEngulfe ----------

// Replays the day candle by candle the way the live scanner sees it and returns the first hit.
function findEngulfeSignal(candles) {
  for (let k = 8; k < candles.length - 1; k += 1) {
    if (candles[k].minute >= SQUARE_OFF_MINUTE) return null;
    const result = closingTwoEngulfe(candles.slice(0, k + 1));
    if (result.hit && Number.isFinite(Number(result.buyOrSellPrice))) {
      return { idx: k, price: Number(result.buyOrSellPrice), direction: result.direction, scannerPnl: result.profitOrLoss };
    }
  }
  return null;
}

function engulfeTrade({ symbol, day, candles, signal }, opts) {
  const side = signal.direction === "up" ? "long" : "short";
  let entry;
  let entryIdx;
  if (opts.entry === "ideal") {
    // resting stop order exactly at the signal price, as the scanner reports it
    entry = signal.price;
    entryIdx = signal.idx;
  } else {
    // signal noticed after the candle closes; market order at next candle open
    entryIdx = signal.idx + 1;
    entry = candles[entryIdx].open;
  }

  if (opts.stopPct == null) {
    // strategy as written: no stop, held until 15:20 (sized as if risking 1%)
    return buildTrade({ symbol, day, candles, entryIdx, side, entry, stop: null, target: null, sizingRisk: entry * 0.01 });
  }

  const riskPerShare = entry * (opts.stopPct / 100);
  const stop = side === "long" ? entry - riskPerShare : entry + riskPerShare;
  const target = opts.rr == null ? null : side === "long" ? entry + riskPerShare * opts.rr : entry - riskPerShare * opts.rr;
  return buildTrade({ symbol, day, candles, entryIdx, side, entry, stop, target });
}

// ---------- metrics ----------

function summarise(trades) {
  const sorted = [...trades].sort((a, b) => a.time.localeCompare(b.time));
  const n = sorted.length;
  if (!n) return { trades: 0 };
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of sorted) {
    equity += t.net;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  const wins = sorted.filter((t) => t.net > 0);
  const losses = sorted.filter((t) => t.net <= 0);
  const grossWin = wins.reduce((s, t) => s + t.net, 0);
  const grossLoss = -losses.reduce((s, t) => s + t.net, 0);
  const days = new Set(sorted.map((t) => t.day));
  const byYear = {};
  for (const t of sorted) {
    const y = t.day.slice(0, 4);
    byYear[y] = (byYear[y] || 0) + t.net;
  }
  const longs = sorted.filter((t) => t.side === "long");
  const shorts = sorted.filter((t) => t.side === "short");
  const sum = (arr, f) => arr.reduce((s, t) => s + f(t), 0);
  return {
    trades: n,
    tradingDays: days.size,
    tradesPerDay: +(n / days.size).toFixed(1),
    winRate: +((wins.length / n) * 100).toFixed(1),
    avgR: +(sum(sorted, (t) => t.r) / n).toFixed(3),
    netPnl: Math.round(equity),
    grossPnl: Math.round(sum(sorted, (t) => t.gross)),
    totalCharges: Math.round(sum(sorted, (t) => t.cost)),
    profitFactor: grossLoss ? +(grossWin / grossLoss).toFixed(2) : null,
    maxDrawdown: Math.round(maxDd),
    longs: { trades: longs.length, net: Math.round(sum(longs, (t) => t.net)), winRate: longs.length ? +((longs.filter((t) => t.net > 0).length / longs.length) * 100).toFixed(1) : null },
    shorts: { trades: shorts.length, net: Math.round(sum(shorts, (t) => t.net)), winRate: shorts.length ? +((shorts.filter((t) => t.net > 0).length / shorts.length) * 100).toFixed(1) : null },
    netByYear: Object.fromEntries(Object.entries(byYear).map(([y, v]) => [y, Math.round(v)])),
  };
}

// ---------- main ----------

function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error("No data found. Run: node server/backtest/fetchData.js");
    process.exit(1);
  }
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));

  const orbVariants = [];
  for (const entry of ["break", "close"]) {
    for (const rr of [1, 1.5, 2, null]) {
      orbVariants.push({ name: `ORB ${entry} RR=${rr ?? "EOD"} gap 0.5-2%`, entry, rr, minGap: 0.5, maxGap: 2 });
    }
  }
  for (const [minGap, maxGap] of [[0.5, 1], [1, 2], [2, 3], [3, 100]]) {
    orbVariants.push({ name: `ORB break RR=2 gap ${minGap}-${maxGap === 100 ? "+" : maxGap}%`, entry: "break", rr: 2, minGap, maxGap });
  }

  const engulfeVariants = [
    { name: "ENGULFE ideal entry, no stop, exit 15:20", entry: "ideal", stopPct: null },
    { name: "ENGULFE next-open entry, no stop, exit 15:20", entry: "next", stopPct: null },
    { name: "ENGULFE next-open, SL 0.5% RR=2", entry: "next", stopPct: 0.5, rr: 2 },
    { name: "ENGULFE next-open, SL 1% RR=2", entry: "next", stopPct: 1, rr: 2 },
    { name: "ENGULFE next-open, SL 1% hold to 15:20", entry: "next", stopPct: 1, rr: null },
    { name: "ENGULFE ideal entry, SL 1% RR=2", entry: "ideal", stopPct: 1, rr: 2 },
  ];

  const trades = Object.fromEntries([...orbVariants, ...engulfeVariants].map((v) => [v.name, []]));
  const scannerReported = [];
  const started = Date.now();

  files.forEach((file, fileIdx) => {
    const symbol = file.replace(/\.json$/, "");
    const days = loadDays(path.join(DATA_DIR, file));
    for (let d = 1; d < days.length; d += 1) {
      const { day, candles } = days[d];
      const prevCandles = days[d - 1].candles;
      const ctx = { symbol, day, candles, prevClose: prevCandles[prevCandles.length - 1].close };

      for (const v of orbVariants) {
        const t = orbTrades(ctx, v);
        if (t) trades[v.name].push(t);
      }

      const signal = findEngulfeSignal(candles);
      if (signal) {
        scannerReported.push({ symbol, day, pnlPerShare: signal.scannerPnl, price: signal.price });
        for (const v of engulfeVariants) {
          const t = engulfeTrade({ ...ctx, signal }, v);
          if (t) trades[v.name].push(t);
        }
      }
    }
    if ((fileIdx + 1) % 20 === 0) console.log(`  processed ${fileIdx + 1}/${files.length} stocks (${Math.round((Date.now() - started) / 1000)}s)`);
  });

  const results = {
    generatedAt: new Date().toISOString(),
    stocks: files.length,
    settings: { riskPerTrade: RISK_PER_TRADE, maxNotional: MAX_NOTIONAL, slippagePct: SLIPPAGE * 100 },
    variants: Object.fromEntries(Object.entries(trades).map(([name, list]) => [name, summarise(list)])),
    engulfeScannerMetric: {
      note: "What the existing scanner's profitOrLoss reports: entry to the last candle's high/low (best case, no stop)",
      signals: scannerReported.length,
      positivePct: +((scannerReported.filter((s) => s.pnlPerShare > 0).length / Math.max(1, scannerReported.length)) * 100).toFixed(1),
    },
  };

  fs.writeFileSync(path.join(process.cwd(), "server", "backtest", "results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(process.cwd(), "server", "backtest", "trades.json"), JSON.stringify(trades));

  console.log(`\n${files.length} stocks, risk ₹${RISK_PER_TRADE}/trade, slippage ${SLIPPAGE * 100}%/side\n`);
  console.table(
    Object.fromEntries(
      Object.entries(results.variants).map(([name, s]) => [
        name,
        { trades: s.trades, "/day": s.tradesPerDay, "win%": s.winRate, avgR: s.avgR, "net ₹": s.netPnl, "charges ₹": s.totalCharges, PF: s.profitFactor, "maxDD ₹": s.maxDrawdown },
      ])
    )
  );
  console.log("Scanner's own profitOrLoss metric:", results.engulfeScannerMetric);
  console.log("Full details: server/backtest/results.json");
}

main();
