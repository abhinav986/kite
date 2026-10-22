// Backtests intraday strategies on 5-minute candles downloaded by fetchData.js:
//  - gap reversal on the first-candle break (with volume, relative-volume and Nifty filters)
//  - previous-day high/low breakout and VWAP pullback
//  - closingTwoEngulfe and the other signal functions from src/utils/analysis.js / analysis2.js
// Results are printed and written to server/backtest/results.json.
//
//   node server/backtest/run.js [--risk 1000] [--slippage 0.02]
//
// Fill assumptions (deliberately conservative):
//  - if stop and target are both inside one candle, the stop is assumed to hit first
//  - on the candle where an entry triggers, only the stop is checked (no target credit)
//  - stop/market fills pay slippage; target (limit) fills do not
//  - every position is closed by 15:15 at the latest
//  - Zerodha equity-intraday charges are deducted from every trade

import fs from "fs";
import path from "path";
import { closingTwoEngulfe } from "../strategies.js";
import {
  engulfe,
  firstCandleCrossBothSide,
  firstCross,
  fourInsideOne,
  insidePullbackBreakout,
  newBestTracker,
} from "../../src/utils/analysis.js";
import { engulfeFirst } from "../../src/utils/analysis2.js";

// the analysis.js helpers log every call; keep the real logger for our own output
const print = console.log.bind(console);

const DATA_DIR = path.join(process.cwd(), "server", "backtest", "data");
const IST_OFFSET_MS = 330 * 60000;

function getArg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : fallback;
}

const RISK_PER_TRADE = Number(getArg("risk", 1000));
const MAX_NOTIONAL = Number(getArg("maxNotional", 500000));
const SLIPPAGE = Number(getArg("slippage", 0.02)) / 100;
const CAPITAL = Number(getArg("capital", 300000));
const SLOTS = Number(getArg("slots", 3));
const VOLUME_MULTIPLE = Number(getArg("volume", 4));
const VOLUME_LOOKBACK = 10;
const SQUARE_OFF_MINUTE = 15 * 60 + 10; // exit at close of the 15:10 candle = 15:15, same as the auto-trader

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

// ---------- relative volume & market ----------

// RVOL: a candle's volume vs the average volume of the same 5-min slot over the previous 10 sessions.
// cumRvol: same idea for the day's cumulative volume up to that candle.
function buildRelativeVolume(days) {
  const slotVolume = days.map(({ candles }) => new Map(candles.map((c) => [c.minute, c.volume])));
  const slotCumVolume = days.map(({ candles }) => {
    let cum = 0;
    return new Map(candles.map((c) => [c.minute, (cum += c.volume)]));
  });
  const ratio = (maps, d, minute, value) => {
    let sum = 0;
    let n = 0;
    for (let j = d - 1; j >= 0 && n < 10; j -= 1) {
      const v = maps[j].get(minute);
      if (v != null) {
        sum += v;
        n += 1;
      }
    }
    return n >= 5 && sum > 0 ? value / (sum / n) : null;
  };
  return {
    rvol: (d, k) => ratio(slotVolume, d, days[d].candles[k].minute, days[d].candles[k].volume),
    cumRvol: (d, k) => ratio(slotCumVolume, d, days[d].candles[k].minute, slotCumVolume[d].get(days[d].candles[k].minute)),
  };
}

// % change of Nifty 50 from the previous close to the close of the candle at `minute`
function loadNifty() {
  const file = path.join(DATA_DIR, "_NIFTY.json");
  if (!fs.existsSync(file)) return () => null;
  const days = loadDays(file);
  const byDay = new Map();
  days.forEach(({ day, candles }, i) => {
    if (i === 0) return;
    const prevCandles = days[i - 1].candles;
    byDay.set(day, { prevClose: prevCandles[prevCandles.length - 1].close, closes: new Map(candles.map((c) => [c.minute, c.close])) });
  });
  return (day, minute) => {
    const entry = byDay.get(day);
    const close = entry?.closes.get(minute);
    return close == null ? null : ((close - entry.prevClose) / entry.prevClose) * 100;
  };
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

// signal candle volume vs the average of the 10 candles before it (history = previous day + today)
function volumeOk(history, idx, multiple) {
  if (!multiple) return true;
  if (idx < VOLUME_LOOKBACK) return false;
  const prev = history.slice(idx - VOLUME_LOOKBACK, idx);
  const avg = prev.reduce((sum, c) => sum + (c.volume || 0), 0) / VOLUME_LOOKBACK;
  return avg > 0 && history[idx].volume >= multiple * avg;
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

// sizingRisk: per-share risk used for position size and R when the trade has no stop.
// notional: when set, qty = notional / entry (capital-split sizing) and R is measured per 1% move.
function buildTrade({ symbol, day, candles, entryIdx, side, entry, stop, target, sizingRisk, notional }) {
  const riskPerShare = notional ? entry * 0.01 : stop == null ? sizingRisk : Math.abs(entry - stop);
  if (!(riskPerShare > 0)) return null;
  const qty = notional ? Math.floor(notional / entry) : Math.floor(Math.min(RISK_PER_TRADE / riskPerShare, MAX_NOTIONAL / entry));
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

function orbTrades({ symbol, rank, day, d, candles, prevClose, history, offset, rvol, niftyChange }, opts) {
  // liquidity rank (0 = most liquid): limit a variant to the top N stocks, or to the stocks after them
  if (opts.maxRank != null && !(rank < opts.maxRank)) return null;
  if (opts.minRank != null && !(rank >= opts.minRank)) return null;
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
  // 2nd candle volume vs the 10 before it (1st candle + previous day's last 9).
  // Note: live "break" entries check the 2nd candle's volume so far, which is stricter.
  if (!volumeOk(history, offset + 1, opts.volumeMultiple)) return null;
  // 2nd candle vs the same 9:20 candle of the last 10 sessions
  if (opts.minRvol && !(rvol(d, 1) >= opts.minRvol)) return null;
  // fade only when the market isn't pushing the same way as the gap. "against" = how far Nifty moves in the
  // gap's direction; niftyMinAgainst isolates the extra trades a looser limit would add.
  if (opts.niftyFilter) {
    const nifty = niftyChange(day, c2.minute);
    if (nifty == null) return null;
    const against = side === "short" ? nifty : -nifty;
    if (against > (opts.niftyMax ?? 0.2)) return null;
    if (opts.niftyMinAgainst != null && against <= opts.niftyMinAgainst) return null;
  }

  const risk = Math.abs(entry - stop);
  const target = opts.rr == null ? null : side === "short" ? entry - risk * opts.rr : entry + risk * opts.rr;
  const trade = buildTrade({ symbol, day, candles, entryIdx, side, entry, stop: opts.noStop ? null : stop, target, notional: opts.notional });
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

function engulfeTrade({ symbol, day, candles, signal, history, offset }, opts) {
  if (!volumeOk(history, offset + signal.idx, opts.volumeMultiple)) return null;
  const side = signal.direction === "up" ? "long" : "short";
  let entry;
  let entryIdx;
  if (opts.entry === "ideal") {
    // resting stop order at the signal price, as the scanner reports it. Only valid when the signal fires
    // on the candle that crosses the price; a candle that opens beyond it fills at its open.
    const c = candles[signal.idx];
    const long = signal.direction === "up";
    if (long ? signal.price > c.high : signal.price < c.low) return null;
    entry = long ? Math.max(signal.price, c.open) : Math.min(signal.price, c.open);
    entryIdx = signal.idx;
  } else {
    // signal noticed after the candle closes; market order at next candle open
    entryIdx = signal.idx + 1;
    entry = candles[entryIdx].open;
  }

  if (opts.stopPct == null) {
    // strategy as written: no stop, held until 15:15 (sized as if risking 1%)
    return buildTrade({ symbol, day, candles, entryIdx, side, entry, stop: null, target: null, sizingRisk: entry * 0.01, notional: opts.notional });
  }

  const riskPerShare = entry * (opts.stopPct / 100);
  const stop = side === "long" ? entry - riskPerShare : entry + riskPerShare;
  const target = opts.rr == null ? null : side === "long" ? entry + riskPerShare * opts.rr : entry - riskPerShare * opts.rr;
  return buildTrade({ symbol, day, candles, entryIdx, side, entry, stop, target });
}

// ---------- strategy 3: previous-day high/low breakout ----------

// First 5-min close beyond yesterday's high (long) or low (short) between 10:00 and 13:00, entered at the
// next candle's open, stop at the breakout candle's other end. Days where the level already broke before
// 10:00 (or the stock opened beyond it) are skipped.
function pdhlTrades({ symbol, day, d, candles, prevCandles, rvol }, opts) {
  const pdh = Math.max(...prevCandles.map((c) => c.high));
  const pdl = Math.min(...prevCandles.map((c) => c.low));
  if (candles[0].open > pdh || candles[0].open < pdl) return null;

  for (let k = 0; k < candles.length - 1; k += 1) {
    const c = candles[k];
    if (c.minute < 10 * 60) {
      if (c.high > pdh || c.low < pdl) return null;
      continue;
    }
    if (c.minute > 13 * 60) return null;
    const side = c.close > pdh ? "long" : c.close < pdl ? "short" : null;
    if (!side) continue;
    if (opts.minRvol && !(rvol(d, k) >= opts.minRvol)) return null;

    const entry = candles[k + 1].open;
    const stop = side === "long" ? c.low : c.high;
    const risk = side === "long" ? entry - stop : stop - entry;
    if (!(risk > 0)) return null;
    const target = opts.rr == null ? null : side === "long" ? entry + risk * opts.rr : entry - risk * opts.rr;
    return buildTrade({ symbol, day, candles, entryIdx: k + 1, side, entry, stop, target });
  }
  return null;
}

// ---------- strategy 4: VWAP pullback ----------

// After 10:00, a stock whose last 6 candles all closed above VWAP dips to VWAP and closes back above it
// -> buy at the next open (mirror for shorts). Needs the day's volume so far to be high vs usual.
function vwapTrades({ symbol, day, d, candles, cumRvol }, opts) {
  const vwap = [];
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    pv += ((c.high + c.low + c.close) / 3) * c.volume;
    vol += c.volume;
    vwap.push(vol ? pv / vol : c.close);
  }

  for (let k = 7; k < candles.length - 1; k += 1) {
    const c = candles[k];
    if (c.minute < 10 * 60) continue;
    if (c.minute > 13 * 60 + 30) return null;
    let above = true;
    let below = true;
    for (let j = k - 6; j < k; j += 1) {
      above = above && candles[j].close > vwap[j];
      below = below && candles[j].close < vwap[j];
    }
    const long = above && c.low <= vwap[k] && c.close > vwap[k];
    const short = below && c.high >= vwap[k] && c.close < vwap[k];
    if (!long && !short) continue;
    if (opts.minCumRvol && !(cumRvol(d, k) >= opts.minCumRvol)) continue;

    const side = long ? "long" : "short";
    const entry = candles[k + 1].open;
    const stop = long ? Math.min(c.low, vwap[k]) * 0.999 : Math.max(c.high, vwap[k]) * 1.001;
    const risk = long ? entry - stop : stop - entry;
    if (!(risk > 0)) return null;
    const target = opts.rr == null ? null : long ? entry + risk * opts.rr : entry - risk * opts.rr;
    return buildTrade({ symbol, day, candles, entryIdx: k + 1, side, entry, stop, target });
  }
  return null;
}

// ---------- strategies from src/utils/analysis.js ----------

const ANALYSIS_STRATEGIES = {
  firstCandleCrossBothSide,
  engulfe,
  insidePullbackBreakout,
  newBestTracker,
  fourInsideOne,
  firstCross,
  engulfeFirst,
};

function safeCall(fn, candles, prevCandles) {
  try {
    return fn(candles, prevCandles);
  } catch {
    return null;
  }
}

// First candle at which the function reports a hit, replayed candle by candle like the live scanner.
// A full-day call screens out days with no hit first (these functions only build state forwards).
function findAnalysisSignal(fn, candles, prevCandles) {
  if (!safeCall(fn, candles, prevCandles)?.hit) return null;
  for (let k = 3; k < candles.length - 1; k += 1) {
    if (candles[k].minute >= SQUARE_OFF_MINUTE) return null;
    const r = safeCall(fn, candles.slice(0, k + 1), prevCandles);
    const price = Number(r?.buyOrSellPrice);
    if (r?.hit && Number.isFinite(price) && price > 0) {
      return { idx: k, price, direction: r.direction === "up" ? "up" : "down" };
    }
  }
  return null;
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
    ...halves(sorted, sum, grossLoss ? grossWin / grossLoss : null),
  };
}

// Splits the test period in two equal halves: a strategy is only a candidate if it made money in both,
// had enough trades, and a profit factor that leaves room for worse live fills.
let SPLIT_DAY = null;
function halves(sorted, sum, profitFactor) {
  const first = sorted.filter((t) => t.day < SPLIT_DAY);
  const second = sorted.filter((t) => t.day >= SPLIT_DAY);
  const firstHalfNet = Math.round(sum(first, (t) => t.net));
  const secondHalfNet = Math.round(sum(second, (t) => t.net));
  return {
    firstHalfNet,
    secondHalfNet,
    candidate: sorted.length >= 100 && profitFactor >= 1.15 && firstHalfNet > 0 && secondHalfNet > 0,
  };
}

// ---------- main ----------

function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error("No data found. Run: node server/backtest/fetchData.js");
    process.exit(1);
  }
  // only the stocks picked by the last fetchData run (older extra files are ignored)
  const universePath = path.join(DATA_DIR, "_universe.json");
  const ranked = fs.existsSync(universePath) ? JSON.parse(fs.readFileSync(universePath, "utf8")) : null;
  const universe = ranked ? new Set(ranked) : null;
  const rankOf = new Map((ranked || []).map((symbol, i) => [symbol, i]));
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .filter((f) => !universe || universe.has(f.replace(/\.json$/, "")));

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
    { name: "ENGULFE ideal entry, no stop, exit 15:15", entry: "ideal", stopPct: null },
    { name: "ENGULFE next-open entry, no stop, exit 15:15", entry: "next", stopPct: null },
    { name: "ENGULFE next-open, SL 0.5% RR=2", entry: "next", stopPct: 0.5, rr: 2 },
    { name: "ENGULFE next-open, SL 1% RR=2", entry: "next", stopPct: 1, rr: 2 },
    { name: "ENGULFE next-open, SL 1% hold to 15:15", entry: "next", stopPct: 1, rr: null },
    { name: "ENGULFE ideal entry, SL 1% RR=2", entry: "ideal", stopPct: 1, rr: 2 },
  ];

  // Your live setup: balance split in SLOTS parts, no stop loss, volume >= VOLUME_MULTIPLE x last-10 average.
  // Gap trades keep the 1:2 target (from the first-candle range); engulfe trades are held to 15:15.
  const notional = CAPITAL / SLOTS;
  const setupGap = { name: `SETUP gap trades: vol>=${VOLUME_MULTIPLE}x, no SL, RR=2`, entry: "break", rr: 2, minGap: 0.5, maxGap: 2, noStop: true, notional, volumeMultiple: VOLUME_MULTIPLE };
  const setupGapNoVol = { ...setupGap, name: "SETUP gap trades: NO volume filter, no SL, RR=2", volumeMultiple: 0 };
  const setupEngulfe = { name: `SETUP engulfe: vol>=${VOLUME_MULTIPLE}x, no SL, exit 15:15`, entry: "next", stopPct: null, notional, volumeMultiple: VOLUME_MULTIPLE };
  const setupEngulfeNoVol = { ...setupEngulfe, name: "SETUP engulfe: NO volume filter, no SL, exit 15:15", volumeMultiple: 0 };
  orbVariants.push(setupGap, setupGapNoVol);
  engulfeVariants.push(setupEngulfe, setupEngulfeNoVol);

  // Suggested improvements: big-gap fade with time-of-day relative volume and a Nifty filter
  for (const rr of [2, null]) {
    const base = { entry: "break", rr, minGap: 2, maxGap: 100 };
    const label = `RR=${rr ?? "EOD"}`;
    orbVariants.push(
      { ...base, name: `NEW gap>=2% fade, SL, ${label}` },
      { ...base, name: `NEW gap>=2% fade, SL, ${label}, RVOL>=2`, minRvol: 2 },
      { ...base, name: `NEW gap>=2% fade, SL, ${label}, Nifty filter`, niftyFilter: true },
      { ...base, name: `NEW gap>=2% fade, SL, ${label}, RVOL>=2 + Nifty`, minRvol: 2, niftyFilter: true }
    );
  }
  orbVariants.push({ name: "NEW gap 0.5-2% fade, SL, RR=2, RVOL>=3", entry: "break", rr: 2, minGap: 0.5, maxGap: 2, minRvol: 3 });

  // Ways to get more trades from the best setup (gap >= 2% fade, SL, hold to 15:15, Nifty <= 0.2% against).
  // Each test has an "extra trades only" row: a looser rule is worth it only if those added trades profit too.
  const best = { entry: "break", rr: null, minGap: 2, maxGap: 100, niftyFilter: true, niftyMax: 0.2 };
  orbVariants.push(
    { ...best, name: "BEST gap>=2% fade + Nifty 0.2% (top 100 stocks)", maxRank: 100 },
    { ...best, name: "TEST1 same rule on ALL F&O stocks" },
    { ...best, name: "TEST1 extra trades only: stocks ranked 101+", minRank: 100 },
    { ...best, name: "TEST2 gap>=1.5% + Nifty 0.2% (top 100)", minGap: 1.5, maxRank: 100 },
    { ...best, name: "TEST2 extra trades only: gap 1.5-2% (top 100)", minGap: 1.5, maxGap: 2, maxRank: 100 },
    { ...best, name: "TEST3 gap>=2% + Nifty 0.4% (top 100)", niftyMax: 0.4, maxRank: 100 },
    { ...best, name: "TEST3 extra trades only: Nifty 0.2-0.4% against (top 100)", niftyMax: 0.4, niftyMinAgainst: 0.2, maxRank: 100 }
  );

  const pdhlVariants = [
    { name: "NEW prev-day high/low breakout, RR=2", rr: 2 },
    { name: "NEW prev-day high/low breakout, RR=2, RVOL>=2", rr: 2, minRvol: 2 },
    { name: "NEW prev-day high/low breakout, EOD, RVOL>=2", rr: null, minRvol: 2 },
  ];
  const vwapVariants = [
    { name: "NEW VWAP pullback, RR=2", rr: 2 },
    { name: "NEW VWAP pullback, RR=2, day RVOL>=1.5", rr: 2, minCumRvol: 1.5 },
    { name: "NEW VWAP pullback, EOD, day RVOL>=1.5", rr: null, minCumRvol: 1.5 },
  ];
  // Next-open entry only: several of these functions report a price crossed candles before the signal is
  // confirmed (e.g. newBestTracker needs 3 crosses), so an "ideal" fill at that price is not achievable.
  const analysisVariants = Object.keys(ANALYSIS_STRATEGIES).map((key) => ({
    key,
    name: `analysis.js ${key}: next-open, SL 1% RR=2`,
    entry: "next",
    stopPct: 1,
    rr: 2,
  }));

  const allVariants = [...orbVariants, ...engulfeVariants, ...pdhlVariants, ...vwapVariants, ...analysisVariants];
  const trades = Object.fromEntries(allVariants.map((v) => [v.name, []]));
  const scannerReported = [];
  const niftyChange = loadNifty();
  const started = Date.now();
  let firstDay = null;
  let lastDay = null;

  console.log = () => {}; // silence analysis.js debug logging during the run
  files.forEach((file, fileIdx) => {
    const symbol = file.replace(/\.json$/, "");
    const days = loadDays(path.join(DATA_DIR, file));
    const { rvol, cumRvol } = buildRelativeVolume(days);
    for (let d = 1; d < days.length; d += 1) {
      const { day, candles } = days[d];
      if (!firstDay || day < firstDay) firstDay = day;
      if (!lastDay || day > lastDay) lastDay = day;
      const prevCandles = days[d - 1].candles;
      const history = [...prevCandles, ...candles];
      const ctx = {
        symbol,
        rank: rankOf.get(symbol) ?? Infinity,
        day,
        d,
        candles,
        prevCandles,
        prevClose: prevCandles[prevCandles.length - 1].close,
        history,
        offset: prevCandles.length,
        rvol,
        cumRvol,
        niftyChange,
      };

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

      for (const v of pdhlVariants) {
        const t = pdhlTrades(ctx, v);
        if (t) trades[v.name].push(t);
      }
      for (const v of vwapVariants) {
        const t = vwapTrades(ctx, v);
        if (t) trades[v.name].push(t);
      }

      for (const [key, fn] of Object.entries(ANALYSIS_STRATEGIES)) {
        const s = findAnalysisSignal(fn, candles, prevCandles);
        if (!s) continue;
        for (const v of analysisVariants.filter((x) => x.key === key)) {
          const t = engulfeTrade({ ...ctx, signal: s }, v);
          if (t) trades[v.name].push(t);
        }
      }
    }
    if ((fileIdx + 1) % 10 === 0) print(`  processed ${fileIdx + 1}/${files.length} stocks (${Math.round((Date.now() - started) / 1000)}s)`);
  });
  console.log = print;

  // midpoint of the tested period, for the 1st-half / 2nd-half check
  SPLIT_DAY = new Date((Date.parse(firstDay) + Date.parse(lastDay)) / 2).toISOString().slice(0, 10);

  // Combined portfolio exactly like the auto-trader: first SLOTS trades of the day across all methods,
  // one trade per stock per day.
  const takeFirstPerDay = (list) => {
    const perDay = new Map();
    for (const t of [...list].sort((a, b) => a.time.localeCompare(b.time))) {
      const taken = perDay.get(t.day) || [];
      if (taken.length < SLOTS && !taken.some((x) => x.symbol === t.symbol)) taken.push(t);
      perDay.set(t.day, taken);
    }
    return [...perDay.values()].flat();
  };
  trades[`SETUP COMBINED: first ${SLOTS} trades/day, vol>=${VOLUME_MULTIPLE}x, no SL`] = takeFirstPerDay([...trades[setupGap.name], ...trades[setupEngulfe.name]]);
  trades[`SETUP COMBINED: first ${SLOTS} trades/day, NO volume filter, no SL`] = takeFirstPerDay([...trades[setupGapNoVol.name], ...trades[setupEngulfeNoVol.name]]);

  const results = {
    generatedAt: new Date().toISOString(),
    stocks: files.length,
    settings: { riskPerTrade: RISK_PER_TRADE, maxNotional: MAX_NOTIONAL, slippagePct: SLIPPAGE * 100, capital: CAPITAL, slots: SLOTS, volumeMultiple: VOLUME_MULTIPLE },
    period: { from: firstDay, to: lastDay, splitDay: SPLIT_DAY },
    variants: Object.fromEntries(Object.entries(trades).map(([name, list]) => [name, summarise(list)])),
    engulfeScannerMetric: {
      note: "What the existing scanner's profitOrLoss reports: entry to the last candle's high/low (best case, no stop)",
      signals: scannerReported.length,
      positivePct: +((scannerReported.filter((s) => s.pnlPerShare > 0).length / Math.max(1, scannerReported.length)) * 100).toFixed(1),
    },
  };

  fs.writeFileSync(path.join(process.cwd(), "server", "backtest", "results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(process.cwd(), "server", "backtest", "trades.json"), JSON.stringify(trades));

  console.log(`\n${files.length} stocks, slippage ${SLIPPAGE * 100}%/side. Older variants risk ₹${RISK_PER_TRADE}/trade; SETUP variants use ₹${CAPITAL} split in ${SLOTS}\n`);
  console.table(
    Object.fromEntries(
      Object.entries(results.variants).map(([name, s]) => [
        name,
        { trades: s.trades, "win%": s.winRate, avgR: s.avgR, "net ₹": s.netPnl, PF: s.profitFactor, "maxDD ₹": s.maxDrawdown, "H1 ₹": s.firstHalfNet, "H2 ₹": s.secondHalfNet, candidate: s.candidate ? "YES" : "" },
      ])
    )
  );
  console.log("Scanner's own profitOrLoss metric:", results.engulfeScannerMetric);
  console.log("Full details: server/backtest/results.json");
}

main();
