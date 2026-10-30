// Backtests the strategy used for the paper-trading signals, on 5-minute candles downloaded by fetchData.js:
//   gap >= 1% at the open -> fade it when the 2nd candle breaks the 1st candle's low (gap-up, SELL) or high
//   (gap-down, BUY); stop at the 1st candle's other end; held until 15:15. Top 100 most liquid F&O stocks.
// It is run with and without the Nifty filter (fade only when Nifty is not moving with the gap by more than
// the limit) so the two can be compared, with a wider break window (any of the next 3 candles), plus TEST 1
// (gaps >= 4% only) and TEST 3 (skip when the stock already moved >= 3% the same way yesterday).
// Also tested: the gap fade with pullback confirmation (see gapPullbackTrade).
// Also tested: a 15-day swing hold after 3 momentum bursts in one day (see swingTrades).
// Results go to server/backtest/results.json.
//
//   node server/backtest/run.js [--risk 1000] [--slippage 0.02]
//
// Fill assumptions (deliberately conservative):
//  - on the candle where the entry triggers, only the stop is checked
//  - entries and exits pay slippage; a candle that opens beyond the level fills at its open
//  - every position is closed by 15:15 at the latest
//  - Zerodha equity-intraday charges are deducted from every trade

import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "server", "backtest", "data");
const IST_OFFSET_MS = 330 * 60000;

function getArg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : fallback;
}

const RISK_PER_TRADE = Number(getArg("risk", 1000));
const MAX_NOTIONAL = Number(getArg("maxNotional", 500000));
const SLIPPAGE = Number(getArg("slippage", 0.02)) / 100;
const SQUARE_OFF_MINUTE = 15 * 60 + 10; // exit at close of the 15:10 candle = 15:15, same as the signals
const MIN_GAP_PCT = 1; // same as the paper signals
const TOP_STOCKS = 100;

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

// ---------- trade simulation ----------

// Walks candles from entryIdx managing one position; the entry candle only checks the stop.
function simulate({ candles, entryIdx, side, stop }) {
  const long = side === "long";
  for (let k = entryIdx; k < candles.length; k += 1) {
    const c = candles[k];
    if (k !== entryIdx && (long ? c.open <= stop : c.open >= stop)) return { exit: c.open, reason: "stop" };
    if (long ? c.low <= stop : c.high >= stop) return { exit: stop, reason: "stop" };
    if (c.minute >= SQUARE_OFF_MINUTE) return { exit: c.close, reason: "time" };
  }
  return { exit: candles[candles.length - 1].close, reason: "time" };
}

// ---------- the strategy ----------

// opts.minGap:          minimum gap in % (default MIN_GAP_PCT)
// opts.breakCandles:    how many candles after the 1st may make the break (default 1 = only the 9:20 candle).
//                       A candle that crosses the other side of the 1st candle first cancels the setup.
// opts.niftyMax:        skip when Nifty moves with the gap by more than this % (null = no check)
// opts.skipPrevMovePct: skip when the stock already moved this much yesterday in the gap's direction
function gapFadeTrade({ symbol, day, candles, prevClose, prevDayChange, niftyChange }, opts) {
  const c1 = candles[0];
  const gapPct = ((c1.open - prevClose) / prevClose) * 100;
  if (Math.abs(gapPct) < (opts.minGap ?? MIN_GAP_PCT)) return null;

  const side = gapPct > 0 ? "short" : "long";
  const short = side === "short";

  // a second strong move in a row is more often news or momentum than an overreaction
  if (opts.skipPrevMovePct != null) {
    if (prevDayChange == null) return null;
    const prevWithGap = short ? prevDayChange : -prevDayChange;
    if (prevWithGap >= opts.skipPrevMovePct) return null;
  }


  const level = short ? c1.low : c1.high;
  const stop = short ? c1.high : c1.low;
  let entryIdx = null;
  for (let k = 1; k <= (opts.breakCandles ?? 1); k += 1) {
    const c = candles[k];
    if (short ? c.low < level : c.high > level) {
      entryIdx = k;
      break;
    }
    if (short ? c.high > stop : c.low < stop) return null;
  }
  if (entryIdx == null) return null;
  const breakCandle = candles[entryIdx];
  // a candle that opens beyond the level fills at its open
  const entry = short ? Math.min(level, breakCandle.open) : Math.max(level, breakCandle.open);

  // Nifty filter, measured at the close of the breakout candle
  let nifty = null;
  if (opts.niftyMax != null) {
    nifty = niftyChange(day, breakCandle.minute);
    if (nifty == null) return null;
    const withGap = short ? nifty : -nifty;
    if (withGap > opts.niftyMax) return null;
  }

  const riskPerShare = Math.abs(entry - stop);
  if (!(riskPerShare > 0)) return null;
  const qty = Math.floor(Math.min(RISK_PER_TRADE / riskPerShare, MAX_NOTIONAL / entry));
  if (qty < 1) return null;

  const result = simulate({ candles, entryIdx, side, stop });
  const fillEntry = slip(entry, side, true);
  const fillExit = slip(result.exit, side, false);
  const gross = (side === "long" ? fillExit - fillEntry : fillEntry - fillExit) * qty;
  const cost = charges(side, qty, fillEntry, fillExit);
  return {
    symbol,
    day,
    time: breakCandle.date.toISOString(),
    side,
    gapPct: +gapPct.toFixed(2),
    nifty: nifty == null ? null : +nifty.toFixed(2),
    prevDayChange: prevDayChange == null ? null : +prevDayChange.toFixed(2),
    qty,
    entry: +fillEntry.toFixed(2),
    stop: +stop.toFixed(2),
    exit: +fillExit.toFixed(2),
    reason: result.reason,
    gross: +gross.toFixed(2),
    cost: +cost.toFixed(2),
    net: +(gross - cost).toFixed(2),
    r: +((gross - cost) / (riskPerShare * qty)).toFixed(3),
  };
}

// ---------- strategy 2: gap fade with pullback confirmation ----------
//
// Gap-up -> SELL (mirror for gap-down -> BUY):
//  1. gap >= MIN_GAP_PCT at the open
//  2. any later candle crosses the 1st candle's low (not the entry)
//  3. a pullback candle: higher high than the candle before it
//  4. a candle breaks the day's low (lowest price so far) -> SELL at that low (or the open if it opens below)
// Trading above the 1st candle's high before the entry cancels the setup. opts.stopAt: "first" = the 1st
// candle's high, "pullback" = the highest high between the break and the entry. With opts.niftyMax, Nifty
// must not be more than that % with the gap at the entry candle. Exit at the stop or 15:15; entries until 14:30.
const PULLBACK_LAST_ENTRY_MINUTE = 14 * 60 + 30;

function gapPullbackTrade({ symbol, day, candles, prevClose, niftyChange }, opts) {
  const c1 = candles[0];
  const gapPct = ((c1.open - prevClose) / prevClose) * 100;
  if (Math.abs(gapPct) < MIN_GAP_PCT) return null;
  const side = gapPct > 0 ? "short" : "long";
  const short = side === "short";
  const firstStop = short ? c1.high : c1.low;
  const beyond = (a, b) => (short ? a < b : a > b); // in the trade's direction

  let dayExtreme = short ? c1.low : c1.high; // day's low (SELL) / high (BUY) so far
  let broke = false;
  let pulledBack = false;
  let pullbackExtreme = null; // highest high (SELL) / lowest low (BUY) since the break
  for (let k = 1; k < candles.length; k += 1) {
    const c = candles[k];
    const prev = candles[k - 1];
    if (c.minute > PULLBACK_LAST_ENTRY_MINUTE) return null;
    const towards = short ? c.low : c.high; // the side the trade goes
    const against = short ? c.high : c.low; // the stop side

    if (pulledBack && beyond(towards, dayExtreme)) {
      const entry = short ? Math.min(dayExtreme, c.open) : Math.max(dayExtreme, c.open);
      const stop = opts.stopAt === "pullback" ? pullbackExtreme : firstStop;
      let nifty = null;
      if (opts.niftyMax != null) {
        nifty = niftyChange(day, c.minute);
        const withGap = nifty == null ? null : short ? nifty : -nifty;
        if (withGap == null || withGap > opts.niftyMax) return null;
      }
      return sizeAndSimulate({ symbol, day, candles, entryIdx: k, side, entry, stop, extra: { gapPct: +gapPct.toFixed(2), nifty: nifty == null ? null : +nifty.toFixed(2) } });
    }
    if (short ? against > firstStop : against < firstStop) return null; // traded through the 1st candle's other end

    if (!broke) {
      if (beyond(towards, short ? c1.low : c1.high)) {
        broke = true;
        pullbackExtreme = against;
      }
    } else {
      pullbackExtreme = short ? Math.max(pullbackExtreme, c.high) : Math.min(pullbackExtreme, c.low);
      if (!pulledBack && (short ? c.high > prev.high : c.low < prev.low)) pulledBack = true;
    }
    dayExtreme = short ? Math.min(dayExtreme, c.low) : Math.max(dayExtreme, c.high);
  }
  return null;
}

// Sizes the position to RISK_PER_TRADE, simulates it and applies slippage and charges.
function sizeAndSimulate({ symbol, day, candles, entryIdx, side, entry, stop, extra = {} }) {
  const long = side === "long";
  if (stop == null || (long ? entry <= stop : entry >= stop)) return null;
  const riskPerShare = Math.abs(entry - stop);
  const qty = Math.floor(Math.min(RISK_PER_TRADE / riskPerShare, MAX_NOTIONAL / entry));
  if (qty < 1) return null;
  const result = simulate({ candles, entryIdx, side, stop });
  const fillEntry = slip(entry, side, true);
  const fillExit = slip(result.exit, side, false);
  const gross = (long ? fillExit - fillEntry : fillEntry - fillExit) * qty;
  const cost = charges(side, qty, fillEntry, fillExit);
  return {
    symbol,
    day,
    time: candles[entryIdx].date.toISOString(),
    side,
    ...extra,
    qty,
    entry: +fillEntry.toFixed(2),
    stop: +stop.toFixed(2),
    exit: +fillExit.toFixed(2),
    reason: result.reason,
    gross: +gross.toFixed(2),
    cost: +cost.toFixed(2),
    net: +(gross - cost).toFixed(2),
    r: +((gross - cost) / (riskPerShare * qty)).toFixed(3),
  };
}

// ---------- strategy 3: three momentum bursts in a day -> hold 15 days (delivery) ----------
//
// One occurrence (5-min candles): a pullback candle (lower low than the candle before it), then a candle
// CLOSES above the day's high so far, then the next 2 candles each trade above the previous candle's high
// (if they don't, wait for another close above the day's high). Strict rule: once recovery starts after a
// pullback, no candle may trade below the previous candle's low until the occurrence completes. When the 3rd
// occurrence completes, BUY right there (delivery) and sell at the close of the 15th trading day after.
// No stop loss, LONG only, ₹1,00,000 per trade, one position per stock at a time.
const HOLD_DAYS = 15;
const SWING_NOTIONAL = 100000;
const OCCURRENCES_NEEDED = 3;

function deliveryCharges(side, value) {
  const stt = value * 0.001; // 0.1% on buy and sell
  const exchange = value * 0.0000297;
  const sebi = value * 0.000001;
  const stamp = side === "buy" ? value * 0.00015 : 0;
  const gst = 0.18 * (exchange + sebi);
  const dp = side === "sell" ? 15.93 : 0; // depository charge per stock sold
  return stt + exchange + sebi + stamp + gst + dp;
}

// Finds the candle where occurrence number OCCURRENCES_NEEDED completes in one day's 5-min candles.
// Returns { idx, price } (price = where that candle broke the previous high, or its open if it opened above)
// or null. strict = inside a recovery leg (from the first candle above the previous high after a pullback
// until the occurrence completes) no candle may trade below the previous candle's low; if one does the leg
// fails, that candle is a new pullback and the count resets to 0. Pullback candles themselves may break lows freely.
function findBursts(candles, strict) {
  let count = 0;
  let step = "wait"; // wait -> pullback -> close -> hh1 -> hh2
  let dayHigh = candles[0].high;
  for (let k = 1; k < candles.length; k += 1) {
    const c = candles[k];
    const prev = candles[k - 1];
    if (step === "wait") {
      if (c.low < prev.low) step = strict ? "pullback" : "close";
    } else if (step === "pullback") {
      if (c.low >= prev.low && c.high > prev.high) step = c.close > dayHigh ? "hh1" : "close"; // recovery starts
    } else if (strict && c.low < prev.low) {
      step = "pullback"; // broke the previous low inside the leg: start counting again
      count = 0;
    } else if (step === "close") {
      if (c.close > dayHigh) step = "hh1";
    } else if (c.high > prev.high) {
      if (step === "hh1") {
        step = "hh2";
      } else {
        count += 1;
        if (count >= OCCURRENCES_NEEDED) return { idx: k, price: Math.max(c.open, prev.high) };
        step = "wait";
      }
    } else {
      step = c.close > dayHigh ? "hh1" : "close"; // no follow-through: this candle may be a new close above
    }
    dayHigh = Math.max(dayHigh, c.high);
  }
  return null;
}

// Buys on day d (at the 3rd burst when strict, else at the close), sells at the close of day d + HOLD_DAYS.
// Returns null if the data ends first.
function holdTrade(symbol, days, d, burst) {
  const exitDay = days[d + HOLD_DAYS];
  if (!exitDay) return null;
  const entryCandles = days[d].candles;
  const entryCandle = burst ? entryCandles[burst.idx] : entryCandles[entryCandles.length - 1];
  const entry = (burst ? burst.price : entryCandle.close) * (1 + SLIPPAGE);
  const exit = exitDay.candles[exitDay.candles.length - 1].close * (1 - SLIPPAGE);
  const qty = Math.floor(SWING_NOTIONAL / entry);
  if (qty < 1) return null;
  const gross = (exit - entry) * qty;
  const cost = deliveryCharges("buy", qty * entry) + deliveryCharges("sell", qty * exit);
  const net = gross - cost;
  return {
    symbol,
    day: days[d].day,
    exitDay: exitDay.day,
    time: entryCandle.date.toISOString(),
    side: "long",
    qty,
    entry: +entry.toFixed(2),
    exit: +exit.toFixed(2),
    reason: "time",
    gross: +gross.toFixed(2),
    cost: +cost.toFixed(2),
    net: +net.toFixed(2),
    r: +((net / (qty * entry)) * 100).toFixed(3), // % return on the money invested
  };
}

function swingTrades(symbol, days, strict) {
  const out = [];
  let nextAllowed = 0; // one position per stock at a time
  for (let d = 1; d < days.length; d += 1) {
    if (d < nextAllowed) continue;
    const burst = findBursts(days[d].candles, strict);
    if (!burst) continue;
    const t = holdTrade(symbol, days, d, strict ? burst : null);
    if (!t) break;
    out.push(t);
    nextAllowed = d + HOLD_DAYS;
  }
  return out;
}

// ---------- metrics ----------

let SPLIT_DAY = null;

function summarise(trades) {
  const sorted = [...trades].sort((a, b) => a.time.localeCompare(b.time));
  const n = sorted.length;
  if (!n) return { trades: 0 };
  const sum = (arr, f) => arr.reduce((s, t) => s + f(t), 0);
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  for (const t of sorted) {
    equity += t.net;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  const wins = sorted.filter((t) => t.net > 0);
  const grossWin = sum(wins, (t) => t.net);
  const grossLoss = -sum(sorted.filter((t) => t.net <= 0), (t) => t.net);
  const profitFactor = grossLoss ? grossWin / grossLoss : null;
  const byYear = {};
  for (const t of sorted) byYear[t.day.slice(0, 4)] = (byYear[t.day.slice(0, 4)] || 0) + t.net;
  const firstHalfNet = Math.round(sum(sorted.filter((t) => t.day < SPLIT_DAY), (t) => t.net));
  const secondHalfNet = Math.round(sum(sorted.filter((t) => t.day >= SPLIT_DAY), (t) => t.net));
  const side = (s) => {
    const list = sorted.filter((t) => t.side === s);
    return { trades: list.length, net: Math.round(sum(list, (t) => t.net)), winRate: list.length ? +((list.filter((t) => t.net > 0).length / list.length) * 100).toFixed(1) : null };
  };
  return {
    trades: n,
    tradingDays: new Set(sorted.map((t) => t.day)).size,
    winRate: +((wins.length / n) * 100).toFixed(1),
    avgR: +(sum(sorted, (t) => t.r) / n).toFixed(3),
    netPnl: Math.round(equity),
    grossPnl: Math.round(sum(sorted, (t) => t.gross)),
    totalCharges: Math.round(sum(sorted, (t) => t.cost)),
    profitFactor: profitFactor == null ? null : +profitFactor.toFixed(2),
    maxDrawdown: Math.round(maxDd),
    longs: side("long"),
    shorts: side("short"),
    netByYear: Object.fromEntries(Object.entries(byYear).map(([y, v]) => [y, Math.round(v)])),
    firstHalfNet,
    secondHalfNet,
    // enough trades, a profit factor with room for worse live fills, and profitable in both halves and every year
    candidate:
      n >= 100 && profitFactor >= 1.15 && firstHalfNet > 0 && secondHalfNet > 0 && Object.values(byYear).every((v) => v > 0),
  };
}

// ---------- main ----------

function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error("No data found. Run: node server/backtest/fetchData.js");
    process.exit(1);
  }
  // the stocks picked by fetchData, in liquidity order; only the top 100 are traded
  const universePath = path.join(DATA_DIR, "_universe.json");
  const ranked = fs.existsSync(universePath) ? JSON.parse(fs.readFileSync(universePath, "utf8")) : null;
  const wanted = ranked ? new Set(ranked.slice(0, TOP_STOCKS)) : null;
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .filter((f) => !wanted || wanted.has(f.replace(/\.json$/, "")));

  const variants = [
    { name: "Gap >= 1% fade, NO Nifty check (paper signals)", niftyMax: null },
    { name: "Gap >= 1% fade, Nifty check 0.4%", niftyMax: 0.4 },
    { name: "Gap >= 1% fade, Nifty check 0.2%", niftyMax: 0.2 },
    // break by any of the next 3 candles (9:20, 9:25, 9:30) instead of only 9:20
    { name: "Gap >= 1% fade, break within 3 candles, NO Nifty check", niftyMax: null, breakCandles: 3 },
    { name: "Gap >= 1% fade, break within 3 candles, Nifty check 0.4%", niftyMax: 0.4, breakCandles: 3 },
    { name: "Gap >= 1% fade, break within 3 candles, Nifty check 0.2%", niftyMax: 0.2, breakCandles: 3 },
    // Test 1: only big gaps
    { name: "TEST 1: Gap >= 4% fade, Nifty check 0.4%", minGap: 4, niftyMax: 0.4 },
    { name: "TEST 1: Gap >= 4% fade, NO Nifty check (reference)", minGap: 4, niftyMax: null },
    // Test 3: skip when yesterday already moved >= 3% the same way as today's gap
    { name: "TEST 3: Gap >= 1% fade, skip if yesterday moved >= 3% same way, NO Nifty check", skipPrevMovePct: 3, niftyMax: null },
    { name: "TEST 3: Gap >= 1% fade, skip if yesterday moved >= 3% same way, Nifty check 0.4%", skipPrevMovePct: 3, niftyMax: 0.4 },
  ];
  const pullbackVariants = [
    { name: "PULLBACK: Gap >= 1%, break of 1st candle, pullback, break of day low/high, stop 1st candle, NO Nifty check", stopAt: "first", niftyMax: null },
    { name: "PULLBACK: same, stop at pullback high/low, NO Nifty check", stopAt: "pullback", niftyMax: null },
    { name: "PULLBACK: same, stop 1st candle, Nifty check 0.4%", stopAt: "first", niftyMax: 0.4 },
    { name: "PULLBACK: same, stop at pullback high/low, Nifty check 0.4%", stopAt: "pullback", niftyMax: 0.4 },
  ];
  const swingVariants = [
    { name: "SWING: 3 bursts, no break of previous low inside a recovery leg (else count resets to 0) -> buy at burst 3, hold 15 days (R = % return)", strict: true },
    { name: "SWING (old rule, for comparison): 3 bursts in a day -> buy at close, hold 15 days (R = % return)", strict: false },
  ];
  const trades = Object.fromEntries([...variants, ...pullbackVariants, ...swingVariants].map((v) => [v.name, []]));
  const niftyChange = loadNifty();
  let firstDay = null;
  let lastDay = null;

  for (const file of files) {
    const symbol = file.replace(/\.json$/, "");
    const days = loadDays(path.join(DATA_DIR, file));
    for (let d = 1; d < days.length; d += 1) {
      const { day, candles } = days[d];
      if (!firstDay || day < firstDay) firstDay = day;
      if (!lastDay || day > lastDay) lastDay = day;
      const prevCandles = days[d - 1].candles;
      const prevClose = prevCandles[prevCandles.length - 1].close;
      // yesterday's % change (yesterday's close vs the day before), for test 3
      const twoDaysAgo = days[d - 2]?.candles;
      const prevDayChange = twoDaysAgo ? ((prevClose - twoDaysAgo[twoDaysAgo.length - 1].close) / twoDaysAgo[twoDaysAgo.length - 1].close) * 100 : null;
      const ctx = { symbol, day, candles, prevClose, prevDayChange, niftyChange };
      for (const v of variants) {
        const t = gapFadeTrade(ctx, v);
        if (t) trades[v.name].push(t);
      }
      for (const v of pullbackVariants) {
        const t = gapPullbackTrade(ctx, v);
        if (t) trades[v.name].push(t);
      }
    }
    for (const v of swingVariants) trades[v.name].push(...swingTrades(symbol, days, v.strict));
  }

  // midpoint of the tested period, for the 1st-half / 2nd-half check
  SPLIT_DAY = new Date((Date.parse(firstDay) + Date.parse(lastDay)) / 2).toISOString().slice(0, 10);

  const results = {
    generatedAt: new Date().toISOString(),
    stocks: files.length,
    settings: { riskPerTrade: RISK_PER_TRADE, maxNotional: MAX_NOTIONAL, slippagePct: SLIPPAGE * 100, minGapPct: MIN_GAP_PCT },
    period: { from: firstDay, to: lastDay, splitDay: SPLIT_DAY },
    variants: Object.fromEntries(Object.entries(trades).map(([name, list]) => [name, summarise(list)])),
  };

  fs.writeFileSync(path.join(process.cwd(), "server", "backtest", "results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(process.cwd(), "server", "backtest", "trades.json"), JSON.stringify(trades));

  console.log(`\n${files.length} stocks, ${firstDay} -> ${lastDay}, risk ₹${RISK_PER_TRADE}/trade, slippage ${SLIPPAGE * 100}%/side\n`);
  console.table(
    Object.fromEntries(
      Object.entries(results.variants).map(([name, s]) => [
        name,
        { trades: s.trades, "win%": s.winRate, avgR: s.avgR, "net ₹": s.netPnl, PF: s.profitFactor, "maxDD ₹": s.maxDrawdown, "H1 ₹": s.firstHalfNet, "H2 ₹": s.secondHalfNet, candidate: s.candidate ? "YES" : "" },
      ])
    )
  );
  console.log("Full details: server/backtest/results.json");
}

main();
