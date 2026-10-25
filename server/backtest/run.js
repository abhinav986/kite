// Backtests the strategy used for the paper-trading signals, on 5-minute candles downloaded by fetchData.js:
//   gap >= 2% at the open -> fade it when the 2nd candle breaks the 1st candle's low (gap-up, SELL) or high
//   (gap-down, BUY); stop at the 1st candle's other end; held until 15:15. Top 100 most liquid F&O stocks.
// It is run with and without the Nifty filter (fade only when Nifty is not moving with the gap by more than
// the limit) so the two can be compared, with a wider break window (any of the next 3 candles), plus TEST 1
// (gaps >= 4% only) and TEST 3 (skip when the stock already moved >= 3% the same way yesterday).
// Also tested: the break / pullback / close-above-day-high continuation (see continuationTrade).
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
const MIN_GAP_PCT = 2;
const TOP_STOCKS = 100;
const LAST_ENTRY_MINUTE = 14 * 60 + 30; // no new entries after 14:30, same as the signals
const CONTINUATION_LIMIT_PCT = 2.5; // continuation entry must be within this % of yesterday's close

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
// entryAtClose: the position was opened at entryIdx's close, so management starts on the next candle.
function simulate({ candles, entryIdx, side, stop, entryAtClose = false }) {
  const long = side === "long";
  for (let k = entryAtClose ? entryIdx + 1 : entryIdx; k < candles.length; k += 1) {
    const c = candles[k];
    if ((entryAtClose || k !== entryIdx) && (long ? c.open <= stop : c.open >= stop)) return { exit: c.open, reason: "stop" };
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

// ---------- strategy 2: break -> pullback -> new-high close -> 2 higher highs -> close above day high ----------
//
// BUY (mirror for SELL):
//  1. the 9:15 candle is green           2. the 9:20 candle trades above its high
//  3. a pullback candle (lower low than the candle before it; the deepest low until step 4 is the stop)
//  4. a candle closes above the day's high so far
//  5-6. the next 2 candles each make a higher high (if not, wait for another step-4 close)
//  7. the first later candle that closes above the day's high -> BUY at that close
// The entry must be less than CONTINUATION_LIMIT_PCT above yesterday's close (SELL: below), and with
// opts.niftyMax, Nifty must not be more than that % against the trade at the entry candle. Exit at the stop
// or 15:15; entries until 14:30.
function continuationTrade({ symbol, day, candles, prevClose, niftyChange }, opts) {
  const [c1, c2] = candles;
  let side = null;
  if (c1.close > c1.open && c2.high > c1.high) side = "long";
  else if (c1.close < c1.open && c2.low < c1.low) side = "short";
  if (!side) return null;
  const long = side === "long";
  const beyond = (a, b) => (long ? a > b : a < b); // "above" for BUY, "below" for SELL
  const extremeOf = (c) => (long ? c.high : c.low); // day high for BUY, day low for SELL
  const againstOf = (c) => (long ? c.low : c.high); // pullback side

  let dayExtreme = long ? Math.max(c1.high, c2.high) : Math.min(c1.low, c2.low);
  let stop = null; // deepest pullback point, set once a pullback starts
  let step = 3; // next step we are waiting for
  let newHighIdx = null;

  for (let k = 2; k < candles.length; k += 1) {
    const c = candles[k];
    const prev = candles[k - 1];
    if (c.minute > LAST_ENTRY_MINUTE) return null;

    if (step === 3) {
      if (beyond(againstOf(prev), againstOf(c))) {
        stop = againstOf(c);
        step = 4;
      }
    } else if (step === 4) {
      if (beyond(c.close, dayExtreme)) {
        newHighIdx = k;
        step = 5;
      } else if (beyond(stop, againstOf(c))) {
        stop = againstOf(c); // pullback went deeper
      }
    } else if (step === 5 || step === 6) {
      if (beyond(extremeOf(c), extremeOf(prev))) {
        step += 1; // 5 -> 6 -> 7
      } else {
        step = 4; // the two higher highs didn't come: wait for another close beyond the day's extreme
        if (beyond(c.close, dayExtreme)) {
          newHighIdx = k;
          step = 5;
        }
      }
    } else if (step === 7) {
      if (beyond(c.close, dayExtreme)) {
        const entry = c.close;
        const limit = prevClose * (1 + (long ? 1 : -1) * (CONTINUATION_LIMIT_PCT / 100));
        if (beyond(entry, limit)) return null; // too far from yesterday's close
        let nifty = null;
        if (opts.niftyMax != null) {
          nifty = niftyChange(day, c.minute);
          const against = nifty == null ? null : long ? -nifty : nifty;
          if (against == null || against > opts.niftyMax) return null;
        }
        return sizeAndSimulate({
          symbol,
          day,
          candles,
          entryIdx: k,
          side,
          entry,
          stop,
          entryAtClose: true,
          extra: { newHighTime: candles[newHighIdx].date.toISOString(), nifty: nifty == null ? null : +nifty.toFixed(2) },
        });
      }
    }
    dayExtreme = long ? Math.max(dayExtreme, c.high) : Math.min(dayExtreme, c.low);
  }
  return null;
}

// Sizes the position to RISK_PER_TRADE, simulates it and applies slippage and charges.
function sizeAndSimulate({ symbol, day, candles, entryIdx, side, entry, stop, entryAtClose = false, extra = {} }) {
  const long = side === "long";
  if (stop == null || (long ? entry <= stop : entry >= stop)) return null;
  const riskPerShare = Math.abs(entry - stop);
  const qty = Math.floor(Math.min(RISK_PER_TRADE / riskPerShare, MAX_NOTIONAL / entry));
  if (qty < 1) return null;
  const result = simulate({ candles, entryIdx, side, stop, entryAtClose });
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
    { name: "Gap >= 2% fade, NO Nifty check (paper signals)", niftyMax: null },
    { name: "Gap >= 2% fade, Nifty check 0.4%", niftyMax: 0.4 },
    { name: "Gap >= 2% fade, Nifty check 0.2%", niftyMax: 0.2 },
    // break by any of the next 3 candles (9:20, 9:25, 9:30) instead of only 9:20
    { name: "Gap >= 2% fade, break within 3 candles, NO Nifty check", niftyMax: null, breakCandles: 3 },
    { name: "Gap >= 2% fade, break within 3 candles, Nifty check 0.4%", niftyMax: 0.4, breakCandles: 3 },
    { name: "Gap >= 2% fade, break within 3 candles, Nifty check 0.2%", niftyMax: 0.2, breakCandles: 3 },
    // Test 1: only big gaps
    { name: "TEST 1: Gap >= 4% fade, Nifty check 0.4%", minGap: 4, niftyMax: 0.4 },
    { name: "TEST 1: Gap >= 4% fade, NO Nifty check (reference)", minGap: 4, niftyMax: null },
    // Test 3: skip when yesterday already moved >= 3% the same way as today's gap
    { name: "TEST 3: Gap >= 2% fade, skip if yesterday moved >= 3% same way, NO Nifty check", skipPrevMovePct: 3, niftyMax: null },
    { name: "TEST 3: Gap >= 2% fade, skip if yesterday moved >= 3% same way, Nifty check 0.4%", skipPrevMovePct: 3, niftyMax: 0.4 },
  ];
  const continuationVariants = [
    { name: "CONTINUATION: break, pullback, new-high close, 2 higher highs, close above day high, Nifty check 0.2%", niftyMax: 0.2 },
    { name: "CONTINUATION: same setup, NO Nifty check", niftyMax: null },
  ];
  const trades = Object.fromEntries([...variants, ...continuationVariants].map((v) => [v.name, []]));
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
      for (const v of continuationVariants) {
        const t = continuationTrade(ctx, v);
        if (t) trades[v.name].push(t);
      }
    }
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
