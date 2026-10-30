// Intraday auto-trader for NSE F&O stocks (cash segment, MIS).
//
// Default method: the gap fade (see server/backtest/run.js "Gap >= 1% fade"):
//  - gap-up SELL:   stock opens >= 1% above yesterday's close and a 5-min candle in the break window breaks the 1st candle's low.
//                   Stop = 1st candle's high. (Optional AUTOTRADE_NIFTY_FILTER=true: skip when Nifty is up > 0.4%.)
//  - gap-down BUY:  mirror image. Stop = 1st candle's low.
//  Held until the stop or AUTOTRADE_SQUARE_OFF (default 15:15).
// Optional (AUTOTRADE_STRATEGIES=orb,engulfe): closingTwoEngulfe - it lost money in every backtest variant.
// Optional filter: AUTOTRADE_VOLUME_MULTIPLE > 0 requires the signal candle's volume >= that multiple of the
// previous 10 candles' average.
//
// Sizing: the available equity balance is split into AUTOTRADE_SLOTS equal parts (default 3); each trade uses
// one part. At most one trade per slot per day.
//
// Modes (switched from the UI and saved in server/autotrader-mode.json)
//  - paper (default): no orders are sent; fills are simulated from LTP.
//  - live: MARKET entry, then a LIMIT target (and SL-M stop if enabled).

import fs from "fs";
import path from "path";
import { closingTwoEngulfe } from "./strategies.js";

const IST_OFFSET_MS = 330 * 60000;
const TICK_MS = 5000;
const HISTORICAL_GAP_MS = 350; // historical API allows ~3 requests/second
const VOLUME_LOOKBACK = 10;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ORDER_TAG = "autotrd";
const LOG_PATH = path.join(process.cwd(), "server", "autotrader-trades.jsonl");
const MODE_PATH = path.join(process.cwd(), "server", "autotrader-mode.json");
const BACKTEST_UNIVERSE_PATH = path.join(process.cwd(), "server", "backtest", "data", "_universe.json");
const NIFTY_TOKEN = 256265; // NSE:NIFTY 50 index

// Mode chosen from the UI; falls back to AUTOTRADE_MODE, then paper.
function readSavedMode() {
  try {
    const saved = JSON.parse(fs.readFileSync(MODE_PATH, "utf8")).mode;
    if (saved === "live" || saved === "paper") return saved;
  } catch {
    // no saved mode yet
  }
  return process.env.AUTOTRADE_MODE === "live" ? "live" : "paper";
}

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== "" ? value : fallback;
}

function parseClock(value, fallback) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : fallback;
}

function readSettings() {
  const slots = envNumber("AUTOTRADE_SLOTS", 3);
  return {
    mode: readSavedMode(),
    // Defaults: gap >= 1% fade, stop at the 1st candle's other extreme, held to 15:15
    // (backtested in server/backtest/run.js, rows "Gap >= 1% fade").
    strategies: (process.env.AUTOTRADE_STRATEGIES || "orb").split(",").map((s) => s.trim()).filter(Boolean),
    symbols: (process.env.AUTOTRADE_SYMBOLS || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
    universeSize: envNumber("AUTOTRADE_UNIVERSE_SIZE", 0), // 0 = all F&O stocks; N = top N of the backtest list
    slots,
    leverage: envNumber("AUTOTRADE_LEVERAGE", 1),
    paperCapital: envNumber("AUTOTRADE_PAPER_CAPITAL", 0),
    useStopLoss: process.env.AUTOTRADE_USE_STOP_LOSS !== "false",
    volumeMultiple: envNumber("AUTOTRADE_VOLUME_MULTIPLE", 0), // 0 = off
    niftyFilter: process.env.AUTOTRADE_NIFTY_FILTER === "true", // off by default
    // 0.4% backtested better than 0.2%: +45 trades over 2 years, positive in every year, PF 2.44 overall
    niftyMaxAgainstPct: envNumber("AUTOTRADE_NIFTY_MAX_AGAINST_PCT", 0.4),
    maxTradesPerDay: envNumber("AUTOTRADE_MAX_TRADES_PER_DAY", slots),
    maxDailyLoss: envNumber("AUTOTRADE_MAX_DAILY_LOSS", 0), // 0 = off
    orbMinGapPct: envNumber("AUTOTRADE_ORB_MIN_GAP_PCT", 1),
    orbMaxGapPct: envNumber("AUTOTRADE_ORB_MAX_GAP_PCT", 100),
    orbEntry: process.env.AUTOTRADE_ORB_ENTRY === "close" ? "close" : "break",
    // the break may come on any of the first N candles after 9:15 (3 = 9:20, 9:25 or 9:30, valid until 9:35)
    orbBreakCandles: envNumber("AUTOTRADE_ORB_BREAK_CANDLES", 3),
    orbRR: envNumber("AUTOTRADE_ORB_RR", 0), // target = RR x first-candle range; 0 = hold to square-off
    engulfeStopPct: envNumber("AUTOTRADE_ENGULFE_STOP_PCT", 1), // reference distance for stop/target
    engulfeRR: envNumber("AUTOTRADE_ENGULFE_RR", 0),
    engulfeMaxChasePct: envNumber("AUTOTRADE_ENGULFE_MAX_CHASE_PCT", 0.3),
    engulfeStart: parseClock(process.env.AUTOTRADE_ENGULFE_START, 10 * 60),
    lastEntry: parseClock(process.env.AUTOTRADE_LAST_ENTRY, 14 * 60 + 30),
    squareOff: parseClock(process.env.AUTOTRADE_SQUARE_OFF, 15 * 60 + 15),
  };
}

// minute of day when the gap break window closes (9:25 for 1 candle, 9:35 for 3)
const breakWindowEnd = (settings) => 9 * 60 + 20 + 5 * Math.max(1, settings.orbBreakCandles);
const clockLabel = (minute) => `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`;

function istParts(date) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    dateKey: ist.toISOString().slice(0, 10),
    weekday: ist.getUTCDay(),
    minute: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
    second: ist.getUTCSeconds(),
  };
}

const istNow = () => istParts(new Date());

function kiteTime(dateKey, minute) {
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return `${dateKey} ${hh}:${mm}:00`;
}

function shiftDateKey(dateKey, days) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

function roundToTick(price, tick, direction) {
  const steps = price / tick;
  const rounded = direction === "up" ? Math.ceil(steps - 1e-9) : direction === "down" ? Math.floor(steps + 1e-9) : Math.round(steps);
  return +(rounded * tick).toFixed(2);
}

// Paper-signal strategies the UI can start/stop one by one (live mode supports only "gap").
const PAPER_STRATEGY_KEYS = ["gap", "pullback", "swing"];
const SWING_HOLD_DAYS = 15;
const SWING_BURSTS = 3;

function describeStrategies(settings) {
  const window = clockLabel(breakWindowEnd(settings));
  return {
    gap: {
      label: "Gap fade",
      type: "Intraday",
      rules: [
        `Gap ≥ ${settings.orbMinGapPct}% at the open`,
        `Gap-up: SELL when a candle breaks the 9:15 candle's low before ${window} (gap-down: BUY above its high)`,
        "Cancelled if the 9:15 candle's other end trades first",
        "Stop: the 9:15 candle's other end · exit 15:15",
      ],
    },
    pullback: {
      label: "Gap + pullback",
      type: "Intraday",
      rules: [
        `Gap ≥ ${settings.orbMinGapPct}% at the open`,
        "A candle crosses the 9:15 candle's low (gap-up), then a pullback candle makes a higher high",
        "SELL when a later candle breaks the day's low (gap-down: mirror → BUY above the day's high)",
        "Cancelled if the 9:15 candle's other end trades first · stop there · entries until 14:30 · exit 15:15",
      ],
    },
    swing: {
      label: "3-burst swing",
      type: `Swing · hold ${SWING_HOLD_DAYS} days`,
      rules: [
        "Burst = pullback (lower lows) → recovery: a candle closes above the day high → next 2 candles each break the previous high",
        "Pullback may break lows freely; once recovery starts no candle may trade below the previous candle's low until the burst completes (else it is a new pullback and the burst count resets to 0)",
        `BUY when burst ${SWING_BURSTS} completes, at the break of the previous high (delivery)`,
        `Sell at the close of the ${SWING_HOLD_DAYS}th trading day · no stop loss · BUY only`,
        "One holding per stock at a time",
      ],
    },
  };
}

function averageVolume(candles) {
  if (candles.length < VOLUME_LOOKBACK) return null;
  return candles.slice(-VOLUME_LOOKBACK).reduce((sum, c) => sum + (c.volume || 0), 0) / VOLUME_LOOKBACK;
}

export function createAutoTrader({ kite, withKiteAuth, getInstruments, sendTelegramMessage }) {
  const state = {
    enabled: false,
    busy: false,
    timer: null,
    settings: readSettings(),
    day: null,
    capital: null,
    slotCapital: null,
    universe: [], // [{ symbol, token, tick }]
    orbCandidates: [], // [{ symbol, token, tick, side, level, rangeStop, gapPct, firstVolume, avgVolume }]
    orbPrepared: false,
    lastEngulfeScanMinute: -1,
    tradedToday: new Set(),
    positions: [], // open + closed for the day
    realisedPnl: 0,
    haltedReason: null,
    lastError: null,
    events: [],
    // paper replay
    lastReplayKey: null,
    replayProgress: null,
    paperSessionDay: null,
    notifiedPaperIds: new Set(),
    notifiedExitIds: new Set(),
    dateJobs: new Map(), // dateKey -> past-date scan (date picker)
    activeStrategies: new Set(), // paper strategies started from the UI: "gap" | "pullback" | "swing"
  };

  function log(message) {
    const line = `${new Date().toISOString()} ${message}`;
    console.log(`[autotrader] ${message}`);
    state.events.push(line);
    if (state.events.length > 200) state.events.shift();
  }

  function notify(message) {
    log(message);
    sendTelegramMessage(`[AutoTrader ${state.settings.mode}] ${message}`).catch(() => {});
  }

  function resetDay(dateKey) {
    state.day = dateKey;
    state.capital = null;
    state.slotCapital = null;
    state.orbCandidates = [];
    state.orbPrepared = false;
    state.lastEngulfeScanMinute = -1;
    state.tradedToday = new Set();
    state.positions = [];
    state.realisedPnl = 0;
    state.haltedReason = null;
  }

  async function loadCapital() {
    const { settings } = state;
    let capital = null;
    try {
      const margins = await withKiteAuth(() => kite.getMargins("equity"));
      capital = Number(margins?.net);
    } catch (error) {
      log(`Could not read balance: ${error.message}`);
    }
    if (settings.mode === "paper" && settings.paperCapital > 0) capital = settings.paperCapital;
    if (settings.mode === "paper" && !(capital > 0)) capital = 300000;
    if (!(capital > 0)) throw new Error("No available balance found in your Kite account");
    state.capital = capital;
    state.slotCapital = capital / settings.slots;
    log(`Balance ₹${capital.toFixed(0)} split into ${settings.slots} parts of ₹${state.slotCapital.toFixed(0)} (leverage ${settings.leverage}x)`);
  }

  async function loadUniverse() {
    const [nfo, nse] = await Promise.all([getInstruments("NFO"), getInstruments("NSE")]);
    const fno = new Set(nfo.filter((i) => i.instrument_type === "FUT").map((i) => i.name));
    // all F&O stocks by default; AUTOTRADE_UNIVERSE_SIZE=N limits it to the top N of the backtest list
    // (that file is in liquidity order); AUTOTRADE_SYMBOLS overrides both
    let wanted = state.settings.symbols.length ? new Set(state.settings.symbols) : null;
    if (!wanted && state.settings.universeSize > 0 && fs.existsSync(BACKTEST_UNIVERSE_PATH)) {
      const ranked = JSON.parse(fs.readFileSync(BACKTEST_UNIVERSE_PATH, "utf8"));
      wanted = new Set(ranked.slice(0, state.settings.universeSize));
    }
    state.universe = nse
      .filter((i) => i.segment === "NSE" && i.instrument_type === "EQ" && fno.has(i.tradingsymbol))
      .filter((i) => !wanted || wanted.has(i.tradingsymbol))
      .map((i) => ({ symbol: i.tradingsymbol, token: i.instrument_token, tick: i.tick_size || 0.05 }));
    log(`Universe loaded: ${state.universe.length} F&O stocks`);
  }

  // Completed 5-min candles from the last few sessions up to uptoMinute today, so the 10-candle
  // volume average is available even early in the day.
  // one shared queue so concurrent scans (live + a past date) stay under the historical API rate limit
  let nextHistoricalSlot = 0;
  async function throttleHistorical() {
    const now = Date.now();
    const wait = Math.max(0, nextHistoricalSlot - now);
    nextHistoricalSlot = Math.max(now, nextHistoricalSlot) + HISTORICAL_GAP_MS;
    await sleep(wait);
  }

  // daysBack: calendar days of history before toDateKey (7 covers the previous session; the swing needs ~45)
  async function fetchCompletedCandles(token, toDateKey, toMinute, daysBack = 7) {
    await throttleHistorical();
    const candles = await withKiteAuth(() =>
      kite.getHistoricalData(token, "5minute", kiteTime(shiftDateKey(toDateKey, -daysBack), 9 * 60 + 15), kiteTime(toDateKey, toMinute), false, false)
    );
    // a candle stamped hh:mm is complete at hh:mm + 5
    const nowMs = Date.now();
    return (candles || []).filter((c) => new Date(c.date).getTime() + 5 * 60000 <= nowMs);
  }

  async function getRecentCandles(token, uptoMinute) {
    const all = await fetchCompletedCandles(token, state.day, uptoMinute);
    const today = all.filter((c) => istParts(new Date(c.date)).dateKey === state.day);
    return { all, today };
  }

  async function getQuotes(symbols) {
    if (!symbols.length) return {};
    const data = await withKiteAuth(() => kite.getQuote(symbols.map((s) => `NSE:${s}`)));
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key.replace(/^NSE:/, ""), value]));
  }

  async function getLtps(symbols) {
    if (!symbols.length) return {};
    const data = await withKiteAuth(() => kite.getLTP(symbols.map((s) => `NSE:${s}`)));
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key.replace(/^NSE:/, ""), value.last_price]));
  }

  // Nifty 50 % change from yesterday's close, live
  async function getNiftyChange() {
    const data = await withKiteAuth(() => kite.getOHLC(["NSE:NIFTY 50"]));
    const q = data?.["NSE:NIFTY 50"];
    if (!q?.last_price || !q?.ohlc?.close) return null;
    return ((q.last_price - q.ohlc.close) / q.ohlc.close) * 100;
  }

  // Fade a gap only when the market isn't pushing the same way (backtested at 0.2% and 0.4%)
  function niftyCheck(side, change) {
    const { niftyFilter, niftyMaxAgainstPct } = state.settings;
    if (!niftyFilter) return { ok: true, text: "" };
    if (change == null) return { ok: false, text: "Nifty unavailable" };
    const ok = side === "short" ? change <= niftyMaxAgainstPct : change >= -niftyMaxAgainstPct;
    return { ok, text: `Nifty ${change >= 0 ? "+" : ""}${change.toFixed(2)}%` };
  }

  function volumeCheck(volume, avgVolume) {
    if (!(state.settings.volumeMultiple > 0)) return { ok: true, text: "" };
    if (!(avgVolume > 0)) return { ok: false, text: "no volume average" };
    const ratio = volume / avgVolume;
    return { ok: ratio >= state.settings.volumeMultiple, text: `volume ${ratio.toFixed(1)}x avg` };
  }

  // ---------------- entries ----------------

  function activePositions() {
    return state.positions.filter((p) => p.status === "open" || p.status === "pending");
  }

  function canOpenNewTrade(minute) {
    if (state.haltedReason) return false;
    if (minute > state.settings.lastEntry) return false;
    if (state.positions.filter((p) => p.status !== "failed").length >= state.settings.maxTradesPerDay) return false;
    if (activePositions().length >= state.settings.slots) return false;
    return true;
  }

  // refDistance: per-share distance used for the target (first-candle range for ORB, % for engulfe)
  // and for the stop when no explicit stopPrice is given.
  async function enterTrade({ stock, side, refPrice, refDistance, stopPrice, rr, strategy, reason }) {
    const { settings } = state;
    if (state.tradedToday.has(stock.symbol)) return;
    state.tradedToday.add(stock.symbol);

    const qty = Math.floor((state.slotCapital * settings.leverage) / refPrice);
    if (qty < 1) {
      log(`${stock.symbol}: skipped, ₹${state.slotCapital.toFixed(0)} buys less than 1 share at ${refPrice}`);
      return;
    }

    const long = side === "long";
    const rawStop = stopPrice ?? (long ? refPrice - refDistance : refPrice + refDistance);
    const stop = settings.useStopLoss ? roundToTick(rawStop, stock.tick, long ? "down" : "up") : null;
    const target = rr > 0 ? roundToTick(long ? refPrice + refDistance * rr : refPrice - refDistance * rr, stock.tick, long ? "up" : "down") : null;
    const position = {
      id: `${stock.symbol}-${Date.now()}`,
      strategy,
      symbol: stock.symbol,
      tick: stock.tick,
      side,
      qty,
      entry: refPrice,
      refDistance,
      rr,
      stop,
      fixedStop: stopPrice != null, // a chart level: not moved to the fill price
      target,
      reason,
      status: "pending",
      openedAt: new Date().toISOString(),
      orders: {},
    };
    state.positions.push(position);
    const describe = `${strategy} ${long ? "BUY" : "SELL"} ${qty} ${stock.symbol} @ ~${refPrice} (${reason}) SL ${stop ?? "none"} TGT ${target ?? "15:15 exit"}`;

    try {
      const order = await withKiteAuth(() =>
        kite.placeOrder("regular", {
          exchange: "NSE",
          tradingsymbol: stock.symbol,
          transaction_type: long ? "BUY" : "SELL",
          quantity: qty,
          product: "MIS",
          order_type: "MARKET",
          tag: ORDER_TAG,
        })
      );
      position.orders.entry = order.order_id;
      notify(`${describe} - order ${order.order_id}`);
    } catch (error) {
      position.status = "failed";
      notify(`${stock.symbol}: entry order failed - ${error.message}`);
    }
  }

  // ---------------- gap-up SELL / gap-down BUY ----------------

  async function prepareOrb() {
    state.orbPrepared = true;
    const { settings } = state;
    const symbols = state.universe.map((s) => `NSE:${s.symbol}`);
    const quotes = {};
    for (let i = 0; i < symbols.length; i += 400) {
      Object.assign(quotes, await withKiteAuth(() => kite.getOHLC(symbols.slice(i, i + 400))));
    }

    const gapped = [];
    for (const stock of state.universe) {
      const q = quotes[`NSE:${stock.symbol}`];
      if (!q?.ohlc?.open || !q.ohlc.close) continue;
      const gapPct = ((q.ohlc.open - q.ohlc.close) / q.ohlc.close) * 100;
      if (Math.abs(gapPct) >= settings.orbMinGapPct && Math.abs(gapPct) < settings.orbMaxGapPct) {
        gapped.push({ ...stock, gapPct });
      }
    }

    for (const stock of gapped) {
      const { all, today } = await getRecentCandles(stock.token, 9 * 60 + 20);
      const first = today[0];
      if (!first) continue;
      const side = stock.gapPct > 0 ? "short" : "long";
      state.orbCandidates.push({
        ...stock,
        side,
        level: side === "short" ? first.low : first.high,
        stopLevel: side === "short" ? first.high : first.low,
        range: first.high - first.low,
        firstVolume: first.volume,
        avgVolume: averageVolume(all), // 10 candles before the 2nd candle (1st candle + previous day)
      });
    }
    log(`Gap candidates: ${state.orbCandidates.map((c) => `${c.symbol} ${c.gapPct.toFixed(2)}%`).join(", ") || "none"}`);
  }

  // Returns false when a filter blocks the entry (the stock is re-checked on the next tick).
  async function tryOrbEntry(c, price, volume, minute, niftyChange) {
    const vol = volumeCheck(volume, c.avgVolume);
    if (!vol.ok) return false;
    const nifty = niftyCheck(c.side, niftyChange);
    if (!nifty.ok) return false;
    if (!canOpenNewTrade(minute)) return true;
    await enterTrade({
      stock: c,
      side: c.side,
      refPrice: price,
      refDistance: c.range,
      stopPrice: c.stopLevel,
      rr: state.settings.orbRR,
      strategy: c.side === "short" ? "GAP-UP SELL" : "GAP-DOWN BUY",
      reason: [`gap ${c.gapPct.toFixed(2)}%`, nifty.text, vol.text].filter(Boolean).join(", "),
    });
    return true;
  }

  async function checkOrbBreaks(minute) {
    const pending = state.orbCandidates.filter((c) => !state.tradedToday.has(c.symbol));
    if (!pending.length) return;

    if (state.settings.orbEntry === "break") {
      // from 9:20 until the break window closes: enter when price crosses the level (the volume check uses
      // the day's volume so far minus the 1st candle). A candidate whose stop side trades first is dropped.
      if (minute >= breakWindowEnd(state.settings)) {
        log(`Gap window closed. Not triggered: ${pending.map((c) => c.symbol).join(", ")}`);
        state.orbCandidates = [];
        return;
      }
      const quotes = await getQuotes(pending.map((c) => c.symbol));
      const stoppedFirst = new Set(
        pending
          .filter((c) => {
            const ltp = quotes[c.symbol]?.last_price;
            return ltp && (c.side === "short" ? ltp > c.stopLevel : ltp < c.stopLevel);
          })
          .map((c) => c.symbol)
      );
      if (stoppedFirst.size) {
        log(`Gap setup cancelled (stop side traded first): ${[...stoppedFirst].join(", ")}`);
        state.orbCandidates = state.orbCandidates.filter((c) => !stoppedFirst.has(c.symbol));
      }
      const broken = pending.filter((c) => {
        const ltp = quotes[c.symbol]?.last_price;
        return ltp && !stoppedFirst.has(c.symbol) && (c.side === "short" ? ltp < c.level : ltp > c.level);
      });
      if (!broken.length) return;
      const niftyChange = state.settings.niftyFilter ? await getNiftyChange() : null;
      for (const c of broken) {
        const q = quotes[c.symbol];
        await tryOrbEntry(c, q.last_price, (q.volume || 0) - (c.firstVolume || 0), minute, niftyChange);
      }
      return;
    }

    // "close" entry: wait for the 2nd candle to close beyond the level
    if (minute < 9 * 60 + 25) return;
    state.orbCandidates = [];
    const niftyChange = state.settings.niftyFilter ? await getNiftyChange() : null;
    for (const c of pending) {
      const { today } = await getRecentCandles(c.token, 9 * 60 + 25);
      const second = today[1];
      if (!second) continue;
      const closedBeyond = c.side === "short" ? second.close < c.level : second.close > c.level;
      if (closedBeyond) await tryOrbEntry(c, second.close, second.volume, minute, niftyChange);
    }
  }

  // ---------------- closingTwoEngulfe ----------------

  async function scanEngulfe(minute) {
    const { settings } = state;
    for (const stock of state.universe) {
      if (!canOpenNewTrade(istNow().minute)) return;
      if (state.tradedToday.has(stock.symbol)) continue;
      let candles;
      try {
        candles = await getRecentCandles(stock.token, minute);
      } catch (error) {
        log(`${stock.symbol}: candle fetch failed - ${error.message}`);
        continue;
      }
      const result = closingTwoEngulfe(candles.today);
      if (!result.hit || !Number.isFinite(Number(result.buyOrSellPrice))) continue;

      // volume check on the candle that produced the signal (the latest completed one)
      const signalCandle = candles.all[candles.all.length - 1];
      const vol = volumeCheck(signalCandle.volume, averageVolume(candles.all.slice(0, -1)));
      if (!vol.ok) {
        state.tradedToday.add(stock.symbol);
        log(`${stock.symbol}: engulfe signal skipped, ${vol.text}`);
        continue;
      }

      const signalPrice = Number(result.buyOrSellPrice);
      const ltp = (await getLtps([stock.symbol]))[stock.symbol];
      const chasePct = (Math.abs(ltp - signalPrice) / signalPrice) * 100;
      if (!ltp || chasePct > settings.engulfeMaxChasePct) {
        state.tradedToday.add(stock.symbol);
        log(`${stock.symbol}: engulfe signal @ ${signalPrice} skipped, LTP ${ltp} is ${chasePct.toFixed(2)}% away`);
        continue;
      }
      await enterTrade({
        stock,
        side: result.direction === "up" ? "long" : "short",
        refPrice: ltp,
        refDistance: ltp * (settings.engulfeStopPct / 100),
        rr: settings.engulfeRR,
        strategy: "ENGULFE",
        reason: vol.text,
      });
    }
  }

  // ---------------- position management ----------------

  function closePosition(position, exitPrice, reason) {
    const long = position.side === "long";
    position.exit = exitPrice;
    position.exitReason = reason;
    position.closedAt = new Date().toISOString();
    position.status = "closed";
    position.pnl = +((long ? exitPrice - position.entry : position.entry - exitPrice) * position.qty).toFixed(2);
    state.realisedPnl += position.pnl;
    fs.appendFileSync(LOG_PATH, `${JSON.stringify({ mode: state.settings.mode, ...position })}\n`);
    notify(`${position.symbol} closed (${reason}) @ ${exitPrice}, P&L ₹${position.pnl}. Day P&L ₹${state.realisedPnl.toFixed(0)}`);

    const { maxDailyLoss } = state.settings;
    if (maxDailyLoss > 0 && state.realisedPnl <= -maxDailyLoss && !state.haltedReason) {
      state.haltedReason = `Daily loss limit ₹${maxDailyLoss} reached`;
      notify(`${state.haltedReason}. No new trades today.`);
    }
  }

  // ---------------- paper mode: session replay ----------------
  // Paper trades are recomputed from candles every 5 minutes (once after market hours): every stock that
  // met a method's conditions in the current session - or the last session when the market is closed - is
  // shown, with no slot or trade-count limit. Sizing still uses one balance slot so P&L is comparable.

  const candleMinute = (c) => istParts(new Date(c.date)).minute;
  const candleDay = (c) => istParts(new Date(c.date)).dateKey;

  function splitLastSession(all) {
    if (!all.length) return null;
    const day = candleDay(all[all.length - 1]);
    const before = all.filter((c) => candleDay(c) < day);
    const today = all.filter((c) => candleDay(c) === day);
    const prevDay = before.length ? candleDay(before[before.length - 1]) : null;
    return { day, today, prev: before.filter((c) => candleDay(c) === prevDay), history: [...before, ...today], offset: before.length };
  }

  function volumeAt(history, idx) {
    return volumeCheck(history[idx].volume, averageVolume(history.slice(0, idx)));
  }

  // Walks candles from fromIdx; returns the exit, or null while the position is still open.
  function replayExit({ today, fromIdx, side, stop, target }) {
    const long = side === "long";
    for (let k = fromIdx; k < today.length; k += 1) {
      const c = today[k];
      if (stop != null && (long ? c.low <= stop : c.high >= stop)) return { exit: stop, reason: "stop", at: c.date };
      if (target != null && (long ? c.high >= target : c.low <= target)) return { exit: target, reason: "target", at: c.date };
      if (candleMinute(c) + 5 >= state.settings.squareOff) return { exit: c.close, reason: "square-off", at: c.date };
    }
    return null;
  }

  function paperPosition({ stock, session, strategy, strategyKey, side, entryIdx, fromIdx, entry, refDistance, stopPrice, rr, reason, ltp }) {
    const { settings } = state;
    const long = side === "long";
    const qty = Math.max(1, Math.floor((state.slotCapital * settings.leverage) / entry));
    const rawStop = stopPrice ?? (long ? entry - refDistance : entry + refDistance);
    const stop = settings.useStopLoss ? roundToTick(rawStop, stock.tick, long ? "down" : "up") : null;
    const target = rr > 0 ? roundToTick(long ? entry + refDistance * rr : entry - refDistance * rr, stock.tick, long ? "up" : "down") : null;
    // an intrabar entry can still be stopped out on its own candle
    const stopOnEntryBar = fromIdx > entryIdx && stop != null && (long ? session.today[entryIdx].low <= stop : session.today[entryIdx].high >= stop);
    const exit = stopOnEntryBar
      ? { exit: stop, reason: "stop", at: session.today[entryIdx].date }
      : replayExit({ today: session.today, fromIdx, side, stop, target });
    const mark = exit ? exit.exit : ltp ?? session.today[session.today.length - 1].close;
    return {
      id: `${session.day}-${stock.symbol}-${strategy}`,
      day: session.day,
      strategy,
      strategyKey,
      symbol: stock.symbol,
      side,
      qty,
      entry: +entry.toFixed(2),
      stop,
      target,
      reason,
      time: session.today[entryIdx].date,
      status: exit ? "closed" : "open",
      exit: exit ? +exit.exit.toFixed(2) : null,
      exitReason: exit?.reason,
      closedAt: exit?.at,
      lastPrice: mark,
      pnl: +((long ? mark - entry : entry - mark) * qty).toFixed(2),
    };
  }

  function replayGap(stock, session, niftyChangeAt) {
    const { settings } = state;
    const [c1, c2] = session.today;
    if (!c1 || !c2 || !session.prev.length) return null;
    const prevClose = session.prev[session.prev.length - 1].close;
    const gapPct = ((c1.open - prevClose) / prevClose) * 100;
    if (Math.abs(gapPct) < settings.orbMinGapPct || Math.abs(gapPct) >= settings.orbMaxGapPct) return null;

    const side = gapPct > 0 ? "short" : "long";
    const short = side === "short";
    const level = short ? c1.low : c1.high;
    const stopLevel = short ? c1.high : c1.low;
    let entryIdx = null;
    let entry;
    if (settings.orbEntry === "break") {
      // the break may come on any of the next orbBreakCandles candles; crossing the stop side first cancels it
      for (let k = 1; k <= settings.orbBreakCandles && k < session.today.length; k += 1) {
        const c = session.today[k];
        if (short ? c.low < level : c.high > level) {
          entryIdx = k;
          entry = short ? Math.min(level, c.open) : Math.max(level, c.open);
          break;
        }
        if (short ? c.high > stopLevel : c.low < stopLevel) return null;
      }
      if (entryIdx == null) return null;
    } else {
      if (!(short ? c2.close < level : c2.close > level)) return null;
      entryIdx = 1;
      entry = c2.close;
    }
    const breakCandle = session.today[entryIdx];
    const vol = volumeAt(session.history, session.offset + entryIdx);
    if (!vol.ok) return null;
    // Nifty measured at the breakout candle's close, as in the backtest
    const nifty = niftyCheck(side, niftyChangeAt(breakCandle.date));
    if (!nifty.ok) return null;
    return paperPosition({
      stock,
      session,
      strategy: short ? "GAP-UP SELL" : "GAP-DOWN BUY",
      strategyKey: "gap",
      side,
      entryIdx,
      fromIdx: entryIdx + 1,
      entry,
      refDistance: c1.high - c1.low,
      stopPrice: side === "short" ? c1.high : c1.low,
      rr: settings.orbRR,
      reason: [`gap ${gapPct.toFixed(2)}%`, nifty.text, vol.text].filter(Boolean).join(", "),
    });
  }

  // Gap fade with pullback confirmation (gap-up -> SELL; gap-down mirror): a candle crosses the 9:15 candle's
  // low, then a pullback candle makes a higher high, then a candle breaks the day's low -> SELL at that low.
  // Trading through the 9:15 candle's other end first cancels it; the stop is that other end.
  function replayPullback(stock, session) {
    const { settings } = state;
    const { today } = session;
    const c1 = today[0];
    if (!c1 || today.length < 3 || !session.prev.length) return null;
    const prevClose = session.prev[session.prev.length - 1].close;
    const gapPct = ((c1.open - prevClose) / prevClose) * 100;
    if (Math.abs(gapPct) < settings.orbMinGapPct || Math.abs(gapPct) >= settings.orbMaxGapPct) return null;
    const short = gapPct > 0;
    const side = short ? "short" : "long";
    const firstStop = short ? c1.high : c1.low;

    let dayExtreme = short ? c1.low : c1.high;
    let broke = false;
    let pulledBack = false;
    for (let k = 1; k < today.length; k += 1) {
      const c = today[k];
      const prev = today[k - 1];
      if (candleMinute(c) > settings.lastEntry) return null;
      const towards = short ? c.low : c.high;
      if (pulledBack && (short ? towards < dayExtreme : towards > dayExtreme)) {
        const entry = short ? Math.min(dayExtreme, c.open) : Math.max(dayExtreme, c.open);
        return paperPosition({
          stock,
          session,
          strategy: short ? "PULLBACK SELL" : "PULLBACK BUY",
          strategyKey: "pullback",
          side,
          entryIdx: k,
          fromIdx: k + 1,
          entry,
          refDistance: Math.abs(firstStop - entry),
          stopPrice: firstStop,
          rr: 0,
          reason: `gap ${gapPct.toFixed(2)}%, pullback, break of the day ${short ? "low" : "high"}`,
        });
      }
      if (short ? c.high > firstStop : c.low < firstStop) return null;
      if (!broke) {
        if (short ? c.low < c1.low : c.high > c1.high) broke = true;
      } else if (!pulledBack && (short ? c.high > prev.high : c.low < prev.low)) {
        pulledBack = true;
      }
      dayExtreme = short ? Math.min(dayExtreme, c.low) : Math.max(dayExtreme, c.high);
    }
    return null;
  }

  // Burst = pullback (one or more candles making lower lows) -> recovery starts with a candle above the previous
  // candle's high -> a candle closes above the day's high -> the next 2 candles each trade above the previous
  // candle's high (if not, wait for another close above the day's high). Inside a recovery leg (from its first
  // candle until the burst completes) no candle may trade below the previous candle's low; if one does the leg
  // fails, that candle is a new pullback and the burst count starts again from 0. Returns how many bursts
  // the day had, the candle index where burst number SWING_BURSTS completed and the buy price there.
  function findBursts(candles) {
    let count = 0;
    let step = "wait"; // wait -> pullback -> close -> hh1 -> hh2
    let dayHigh = candles[0]?.high ?? 0;
    for (let k = 1; k < candles.length; k += 1) {
      const c = candles[k];
      const prev = candles[k - 1];
      if (step === "wait") {
        if (c.low < prev.low) step = "pullback";
      } else if (step === "pullback") {
        if (c.low >= prev.low && c.high > prev.high) step = c.close > dayHigh ? "hh1" : "close";
      } else if (c.low < prev.low) {
        step = "pullback";
        count = 0;
      } else if (step === "close") {
        if (c.close > dayHigh) step = "hh1";
      } else if (c.high > prev.high) {
        if (step === "hh1") step = "hh2";
        else {
          count += 1;
          if (count >= SWING_BURSTS) return { count, completedIdx: k, price: Math.max(c.open, prev.high) };
          step = "wait";
        }
      } else {
        step = c.close > dayHigh ? "hh1" : "close";
      }
      dayHigh = Math.max(dayHigh, c.high);
    }
    return { count, completedIdx: null };
  }

  // 3-burst swing trades over a list of sessions, one holding per stock at a time:
  // [{ entryIdx, exitIdx (null while held), burstIdx }]
  function swingTradesFor(sessions) {
    const trades = [];
    let nextAllowed = 0;
    for (let i = 0; i < sessions.length; i += 1) {
      if (i < nextAllowed) continue;
      const { completedIdx, price } = findBursts(sessions[i].candles);
      if (completedIdx == null) continue;
      const exitIdx = i + SWING_HOLD_DAYS < sessions.length ? i + SWING_HOLD_DAYS : null;
      trades.push({ entryIdx: i, exitIdx, burstIdx: completedIdx, price });
      nextAllowed = i + SWING_HOLD_DAYS;
    }
    return trades;
  }

  // A swing holding as seen on session asOfIdx: bought when burst 3 completed on the entry day, sold at the
  // close of day 15 (closed once asOfIdx reaches it).
  function swingPosition(stock, sessions, trade, asOfIdx, { ltp } = {}) {
    const { settings } = state;
    const entrySession = sessions[trade.entryIdx];
    const entryCandles = entrySession.candles;
    const entry = trade.price;
    const qty = Math.max(1, Math.floor((state.slotCapital * settings.leverage) / entry));
    const closed = trade.exitIdx != null && trade.exitIdx <= asOfIdx;
    const asOf = sessions[Math.min(asOfIdx, sessions.length - 1)].candles;
    const exitCandles = closed ? sessions[trade.exitIdx].candles : null;
    const exit = closed ? exitCandles[exitCandles.length - 1].close : null;
    const mark = closed ? exit : ltp ?? asOf[asOf.length - 1].close;
    const holdDay = Math.min(asOfIdx - trade.entryIdx, SWING_HOLD_DAYS);
    return {
      id: `${entrySession.day}-${stock.symbol}-SWING`,
      day: sessions[asOfIdx].day,
      strategy: "SWING BUY",
      strategyKey: "swing",
      symbol: stock.symbol,
      side: "long",
      qty,
      entry: +entry.toFixed(2),
      stop: null,
      target: null,
      reason: `Burst ${SWING_BURSTS} at ${clock(entryCandles[trade.burstIdx].date)} on ${entrySession.day} · hold day ${holdDay}/${SWING_HOLD_DAYS}`,
      time: entryCandles[trade.burstIdx].date,
      entryDay: entrySession.day,
      exitDay: trade.exitIdx != null ? sessions[trade.exitIdx].day : null,
      holdDay,
      status: closed ? "closed" : "open",
      exit: closed ? +exit.toFixed(2) : null,
      exitReason: closed ? "day 15" : undefined,
      closedAt: closed ? exitCandles[exitCandles.length - 1].date : undefined,
      lastPrice: mark,
      pnl: +((mark - entry) * qty).toFixed(2),
      returnPct: +(((mark - entry) / entry) * 100).toFixed(2),
    };
  }

  function replayEngulfe(stock, session, ltp) {
    const { settings } = state;
    const { today } = session;
    for (let k = 8; k < today.length; k += 1) {
      if (candleMinute(today[k]) + 5 > settings.lastEntry) return null;
      const result = closingTwoEngulfe(today.slice(0, k + 1));
      if (!result.hit || !Number.isFinite(Number(result.buyOrSellPrice))) continue;
      const vol = volumeAt(session.history, session.offset + k);
      if (!vol.ok) return null;
      // entered at the next candle's open; if that candle hasn't formed yet, at the current price
      const next = today[k + 1];
      const entry = next ? next.open : ltp;
      if (!entry) return null;
      return paperPosition({
        stock,
        session,
        strategy: "ENGULFE",
        strategyKey: "engulfe",
        side: result.direction === "up" ? "long" : "short",
        entryIdx: next ? k + 1 : k,
        fromIdx: next ? k + 1 : today.length,
        entry,
        refDistance: entry * (settings.engulfeStopPct / 100),
        rr: settings.engulfeRR,
        reason: vol.text,
        ltp,
      });
    }
    return null;
  }

  // Returns candleDate -> Nifty % change from the previous session's close at that candle's close.
  async function loadNiftyChangeAt(now) {
    if (!state.settings.niftyFilter) return () => null;
    try {
      const session = splitLastSession(await fetchCompletedCandles(NIFTY_TOKEN, now.dateKey, Math.min(now.minute, 15 * 60 + 30)));
      if (!session?.prev.length) return () => null;
      const prevClose = session.prev[session.prev.length - 1].close;
      const closes = new Map(session.today.map((c) => [new Date(c.date).getTime(), c.close]));
      return (date) => {
        const close = closes.get(new Date(date).getTime());
        return close == null ? null : ((close - prevClose) / prevClose) * 100;
      };
    } catch (error) {
      log(`Nifty candles unavailable: ${error.message}`);
      return () => null;
    }
  }

  // Replays the session ending at `now` ({ dateKey, minute }) for every stock and returns the signals.
  // requireDay: only accept that exact date (the date picker), so holidays return nothing.
  // strategies: paper strategy keys to run ("gap" | "pullback" | "swing"; "engulfe" still works if listed).
  // For the swing, positions are the holdings open on that day plus the ones bought or sold that day.
  async function computeSessionSignals(now, { strategies = [...state.activeStrategies], marketOpen = false, requireDay = null, onProgress } = {}) {
    const ltps = marketOpen ? await getLtps(state.universe.map((s) => s.symbol)).catch(() => ({})) : {};
    const niftyChangeAt = await loadNiftyChangeAt(now);
    const withSwing = strategies.includes("swing");
    const toMinute = Math.min(now.minute, 15 * 60 + 30);
    const positions = [];
    let day = null;
    let done = 0;
    for (const stock of state.universe) {
      done += 1;
      onProgress?.(`${done}/${state.universe.length}`);
      let all;
      try {
        all = await fetchCompletedCandles(stock.token, now.dateKey, toMinute, withSwing ? 45 : 7);
      } catch (error) {
        log(`${stock.symbol}: candle fetch failed - ${error.message}`);
        continue;
      }
      const session = splitLastSession(all);
      if (!session || session.today.length < 2) continue;
      if (requireDay && session.day !== requireDay) continue;
      day = session.day;
      if (strategies.includes("gap")) {
        const p = replayGap(stock, session, niftyChangeAt);
        if (p) positions.push(p);
      }
      if (strategies.includes("pullback")) {
        const p = replayPullback(stock, session);
        if (p) positions.push(p);
      }
      if (strategies.includes("engulfe")) {
        const p = replayEngulfe(stock, session, ltps[stock.symbol]);
        if (p) positions.push(p);
      }
      if (withSwing) {
        const sessions = groupSessions(all);
        const asOfIdx = sessions.length - 1;
        for (const trade of swingTradesFor(sessions)) {
          // held on this day, bought this day, or sold this day
          if (trade.entryIdx > asOfIdx || (trade.exitIdx != null && trade.exitIdx < asOfIdx)) continue;
          positions.push(swingPosition(stock, sessions, trade, asOfIdx, { ltp: ltps[stock.symbol] }));
        }
      }
    }
    positions.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    return { day, positions };
  }

  // ---------------- Telegram alerts ----------------

  const money = (n) => `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const clock = (date) => {
    const { minute } = istParts(new Date(date));
    return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  };

  function sendAlert(text) {
    log(text.split("\n")[0]);
    sendTelegramMessage(text).catch((error) => log(`Telegram alert failed: ${error.message}`));
  }

  // One alert per new signal and one when it exits (stop hit or 15:15), for today's session only.
  function sendSignalAlerts(positions) {
    for (const p of positions) {
      if (p.strategyKey === "swing") {
        sendSwingAlerts(p);
        continue;
      }
      const buy = p.side === "long";
      if (!state.notifiedPaperIds.has(p.id)) {
        state.notifiedPaperIds.add(p.id);
        sendAlert(
          [
            `${buy ? "🟢 BUY" : "🔴 SELL"} ${p.symbol} at ${money(p.entry)}`,
            `Stop: ${p.stop != null ? money(p.stop) : "none"} · ${p.target != null ? `Target: ${money(p.target)}` : "Exit by 15:15"}`,
            `${p.strategy} · ${p.reason} · signal at ${clock(p.time)}`,
            `Qty for 1/${state.settings.slots} of balance: ${p.qty}`,
          ].join("\n")
        );
      }
      if (p.status === "closed" && !state.notifiedExitIds.has(p.id)) {
        state.notifiedExitIds.add(p.id);
        const label = p.exitReason === "stop" ? "⛔ STOP HIT" : p.exitReason === "target" ? "🎯 TARGET" : "🏁 EXIT 15:15";
        sendAlert(`${label} ${p.symbol} at ${money(p.exit)} · paper P&L ${money(p.pnl)}`);
      }
    }
  }

  // Swing holdings show for 15 days; alert only on the day they are bought and the day they are sold.
  function sendSwingAlerts(p) {
    if (p.entryDay === p.day && !state.notifiedPaperIds.has(p.id)) {
      state.notifiedPaperIds.add(p.id);
      sendAlert(
        [
          `🟢 SWING BUY ${p.symbol} at ${money(p.entry)} (burst ${SWING_BURSTS} at ${clock(p.time)}, now ${money(p.lastPrice)})`,
          `${SWING_BURSTS} bursts today, no break of the previous low inside a recovery leg · hold ${SWING_HOLD_DAYS} trading days · no stop loss · delivery (CNC)`,
          `Qty for 1/${state.settings.slots} of balance: ${p.qty}`,
        ].join("\n")
      );
    }
    if (p.status === "closed" && p.exitDay === p.day && !state.notifiedExitIds.has(p.id)) {
      state.notifiedExitIds.add(p.id);
      sendAlert(`🏁 SWING SELL ${p.symbol} at today's close (day ${SWING_HOLD_DAYS}) ${money(p.exit)} · bought ${p.entryDay} at ${money(p.entry)} · paper P&L ${money(p.pnl)} (${p.returnPct}%)`);
    }
  }

  // 9:20 heads-up: the stocks that gapped and the level that triggers the trade before the window closes, so an
  // SL (stop-entry) order can be placed in time.
  async function sendWatchlistAlert() {
    const { settings } = state;
    let niftyText = "";
    if (settings.niftyFilter) {
      const change = await getNiftyChange().catch(() => null);
      niftyText = change == null ? "" : ` Nifty now ${change >= 0 ? "+" : ""}${change.toFixed(2)}%.`;
    }
    if (!state.orbCandidates.length) {
      sendAlert(`👀 9:20 watchlist: no stock gapped ≥ ${settings.orbMinGapPct}% today.${niftyText}`);
      return;
    }
    const lines = state.orbCandidates.map((c) =>
      c.side === "short"
        ? `🔴 SELL ${c.symbol} if below ${money(c.level)} · stop ${money(c.stopLevel)} · gap +${c.gapPct.toFixed(2)}%`
        : `🟢 BUY ${c.symbol} if above ${money(c.level)} · stop ${money(c.stopLevel)} · gap ${c.gapPct.toFixed(2)}%`
    );
    const until = clockLabel(breakWindowEnd(settings));
    const rule = settings.niftyFilter
      ? `Valid only if it breaks before ${until} without trading through the stop first, and Nifty is not more than ${settings.niftyMaxAgainstPct}% in the gap's direction.`
      : `Valid only if it breaks before ${until} without trading through the stop first.`;
    sendAlert([`👀 9:20 watchlist (${state.orbCandidates.length})`, ...lines, rule + niftyText].join("\n"));
  }

  async function replayPaperSession(now, marketOpen) {
    const { day, positions } = await computeSessionSignals(now, {
      marketOpen,
      onProgress: (progress) => {
        state.replayProgress = progress;
      },
    });
    state.replayProgress = null;
    if (day === now.dateKey) sendSignalAlerts(positions);
    state.positions = positions;
    state.realisedPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
    state.paperSessionDay = day || state.paperSessionDay;
    log(`Paper scan done: ${positions.length} signals (${positions.filter((p) => p.status === "open").length} still open)`);
  }

  async function paperTick(now) {
    const marketOpen = now.weekday >= 1 && now.weekday <= 5 && now.minute >= 9 * 60 + 15 && now.minute <= 15 * 60 + 30;
    const watchlistWindow = now.minute > 9 * 60 + 20 || (now.minute === 9 * 60 + 20 && now.second >= 5);
    if (marketOpen && state.activeStrategies.has("gap") && !state.orbPrepared && watchlistWindow && now.minute < breakWindowEnd(state.settings)) {
      await prepareOrb();
      await sendWatchlistAlert();
    }
    // during market hours: once per completed 5-min candle; otherwise once per calendar day
    const key = marketOpen ? `${now.dateKey}-${now.minute - (now.minute % 5)}` : `closed-${now.dateKey}`;
    if (key === state.lastReplayKey || (marketOpen && now.second < 5)) return;
    state.lastReplayKey = key;
    await replayPaperSession(now, marketOpen);
  }

  // ---------------- History Analysis: one stock, past months ----------------

  // All NSE stocks that have F&O futures, for the All Instruments list.
  async function listFnoStocks() {
    const [nfo, nse] = await Promise.all([getInstruments("NFO"), getInstruments("NSE")]);
    const lotSize = new Map();
    for (const i of nfo) if (i.instrument_type === "FUT" && !lotSize.has(i.name)) lotSize.set(i.name, i.lot_size);
    return nse
      .filter((i) => i.segment === "NSE" && i.instrument_type === "EQ" && lotSize.has(i.tradingsymbol))
      .map((i) => ({ symbol: i.tradingsymbol, name: i.name, token: i.instrument_token, tick: i.tick_size || 0.05, lotSize: lotSize.get(i.tradingsymbol) }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }

  // 5-min candles from fromKey to today, fetched in <= 90-day chunks (Kite allows 100 days per request)
  async function fetchCandleRange(token, fromKey) {
    const today = istNow().dateKey;
    const all = [];
    for (let start = fromKey; start <= today; start = shiftDateKey(start, 90)) {
      const end = shiftDateKey(start, 89) < today ? shiftDateKey(start, 89) : today;
      await throttleHistorical();
      const chunk = await withKiteAuth(() => kite.getHistoricalData(token, "5minute", kiteTime(start, 9 * 60 + 15), kiteTime(end, 15 * 60 + 30), false, false));
      all.push(...(chunk || []));
    }
    const nowMs = Date.now();
    return all.filter((c) => new Date(c.date).getTime() + 5 * 60000 <= nowMs);
  }

  function groupSessions(candles) {
    const byDay = new Map();
    for (const c of candles) {
      const minute = candleMinute(c);
      if (minute < 9 * 60 + 15 || minute > 15 * 60 + 25) continue;
      const day = candleDay(c);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(c);
    }
    return [...byDay.entries()].map(([day, list]) => ({ day, candles: list }));
  }

  const stockHistoryCache = new Map(); // `${token}-${months}` -> { at, result }

  // Runs the paper-signal rules (same replayGap as the live scan) on one stock for the past `months`, and
  // returns each signal day with its candles and the previous day's, for the table and the chart.
  async function backtestStock({ token, months = 6, strategy = "gap" }) {
    if (!PAPER_STRATEGY_KEYS.includes(strategy)) throw new Error(`Unknown strategy ${strategy}`);
    const cacheKey = `${token}-${months}-${strategy}`;
    const cached = stockHistoryCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 10 * 60000) return cached.result;

    if (state.capital == null) await loadCapital();
    const stocks = await listFnoStocks();
    const stock = stocks.find((s) => String(s.token) === String(token));
    if (!stock) throw new Error("Not an F&O stock");

    const today = istNow().dateKey;
    const fromKey = shiftDateKey(today, -Math.round(months * 30.5) - 7); // a week extra for the first previous day
    const sessions = groupSessions(await fetchCandleRange(stock.token, fromKey));

    let niftyChangeAt = () => null;
    if (state.settings.niftyFilter) {
      const niftySessions = groupSessions(await fetchCandleRange(NIFTY_TOKEN, fromKey));
      const changes = new Map();
      niftySessions.forEach(({ candles }, i) => {
        if (!i) return;
        const prev = niftySessions[i - 1].candles;
        const prevClose = prev[prev.length - 1].close;
        for (const c of candles) changes.set(new Date(c.date).getTime(), ((c.close - prevClose) / prevClose) * 100);
      });
      niftyChangeAt = (date) => changes.get(new Date(date).getTime()) ?? null;
    }

    const periodStart = shiftDateKey(today, -Math.round(months * 30.5));
    const signals = [];
    const chartCandles = {};
    let gapDays = 0;
    if (strategy === "swing") {
      // bought when burst 3 completes, sold at the close of day 15 (still held if the data ends first)
      const startIdx = sessions.findIndex((s) => s.day >= periodStart);
      for (const trade of swingTradesFor(sessions)) {
        const i = trade.entryIdx;
        if (startIdx < 0 || i < startIdx || i < 1) continue;
        const p = swingPosition(stock, sessions, trade, sessions.length - 1);
        const prev = sessions[i - 1].candles;
        const prevClose = prev[prev.length - 1].close;
        const holdDaily = sessions.slice(i, (trade.exitIdx ?? sessions.length - 1) + 1).map((s) => ({
          day: s.day,
          open: s.candles[0].open,
          high: Math.max(...s.candles.map((c) => c.high)),
          low: Math.min(...s.candles.map((c) => c.low)),
          close: s.candles[s.candles.length - 1].close,
        }));
        const dayChange = ((sessions[i].candles[0].open - prevClose) / prevClose) * 100;
        signals.push({ ...p, day: p.entryDay, prevDay: sessions[i - 1].day, prevClose, gapPct: +dayChange.toFixed(2), points: +(p.lastPrice - p.entry).toFixed(2), r: p.returnPct, holdDaily });
        chartCandles[sessions[i].day] = sessions[i].candles;
        chartCandles[sessions[i - 1].day] = prev;
      }
    }
    for (let i = 1; strategy !== "swing" && i < sessions.length; i += 1) {
      const { day, candles } = sessions[i];
      if (day < periodStart || candles.length < 2) continue;
      const prev = sessions[i - 1].candles;
      const prevClose = prev[prev.length - 1].close;
      const gapPct = ((candles[0].open - prevClose) / prevClose) * 100;
      if (Math.abs(gapPct) >= state.settings.orbMinGapPct) gapDays += 1;

      const session = { day, today: candles, prev, history: [...prev, ...candles], offset: prev.length };
      const p = strategy === "pullback" ? replayPullback(stock, session) : replayGap(stock, session, niftyChangeAt);
      if (!p) continue;
      // R = points made / points risked (null when trading without a stop)
      const exitPrice = p.exit ?? p.lastPrice;
      const points = p.side === "long" ? exitPrice - p.entry : p.entry - exitPrice;
      const r = p.stop != null && p.entry !== p.stop ? +(points / Math.abs(p.entry - p.stop)).toFixed(2) : null;
      signals.push({ ...p, prevDay: sessions[i - 1].day, prevClose, gapPct: +gapPct.toFixed(2), points: +points.toFixed(2), r });
      chartCandles[day] = candles;
      chartCandles[sessions[i - 1].day] = prev;
    }

    const closed = signals.filter((p) => p.status === "closed");
    const wins = closed.filter((p) => p.pnl > 0);
    let equity = 0;
    let peak = 0;
    let maxDrawdown = 0;
    for (const p of signals) {
      equity += p.pnl;
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);
    }
    const result = {
      symbol: stock.symbol,
      name: stock.name,
      from: periodStart,
      to: today,
      tradingDays: sessions.filter((s) => s.day >= periodStart).length,
      gapDays,
      slotCapital: state.slotCapital,
      strategy,
      strategyInfo: describeStrategies(state.settings)[strategy],
      rules: {
        minGapPct: state.settings.orbMinGapPct,
        breakCandles: state.settings.orbBreakCandles,
        niftyFilter: state.settings.niftyFilter,
        useStopLoss: state.settings.useStopLoss,
        holdDays: SWING_HOLD_DAYS,
      },
      summary: {
        signals: signals.length,
        wins: wins.length,
        winRate: closed.length ? +((wins.length / closed.length) * 100).toFixed(1) : null,
        totalPnl: +signals.reduce((s, p) => s + p.pnl, 0).toFixed(2),
        avgR: signals.some((p) => p.r != null)
          ? +(signals.reduce((s, p) => s + (p.r ?? 0), 0) / signals.filter((p) => p.r != null).length).toFixed(2)
          : null,
        maxDrawdown: +maxDrawdown.toFixed(2),
      },
      signals: signals.reverse(), // newest first
      candles: chartCandles,
    };
    stockHistoryCache.set(cacheKey, { at: Date.now(), result });
    return result;
  }

  // Signals for a past date (date picker). Runs in the background; the UI polls until status is "done".
  // Finished past dates are cached since their candles don't change.
  function signalsForDate(dateKey) {
    const today = istNow().dateKey;
    if (dateKey === today) {
      return {
        date: dateKey,
        status: state.replayProgress ? "running" : "done",
        progress: state.replayProgress,
        live: true,
        scanned: state.enabled && state.lastReplayKey != null,
        positions: state.paperSessionDay === today ? state.positions : [],
      };
    }
    if (dateKey > today) return { date: dateKey, status: "done", positions: [], note: "That date is in the future." };

    let job = state.dateJobs.get(dateKey);
    if (!job || job.status === "error") {
      job = { status: "running", progress: "0", positions: [], error: null, note: null };
      state.dateJobs.set(dateKey, job);
      (async () => {
        if (!state.universe.length) await loadUniverse();
        if (state.capital == null) await loadCapital();
        const result = await computeSessionSignals(
          { dateKey, minute: 15 * 60 + 30 },
          {
            strategies: PAPER_STRATEGY_KEYS, // all of them; the UI filters by strategy
            requireDay: dateKey,
            onProgress: (progress) => {
              job.progress = progress;
            },
          }
        );
        job.positions = result.positions;
        if (!result.day) job.note = "No trading session on this date (weekend or market holiday).";
        job.status = "done";
      })().catch((error) => {
        job.status = "error";
        job.error = error.message;
      });
    }
    return { date: dateKey, ...job };
  }

  async function placeExitOrders(p) {
    const exitSide = p.side === "long" ? "SELL" : "BUY";
    const common = { exchange: "NSE", tradingsymbol: p.symbol, transaction_type: exitSide, quantity: p.qty, product: "MIS", tag: ORDER_TAG };
    if (p.stop != null) {
      const sl = await withKiteAuth(() => kite.placeOrder("regular", { ...common, order_type: "SL-M", trigger_price: p.stop }));
      p.orders.stop = sl.order_id;
    }
    if (p.target != null) {
      const tgt = await withKiteAuth(() => kite.placeOrder("regular", { ...common, order_type: "LIMIT", price: p.target }));
      p.orders.target = tgt.order_id;
    }
  }

  async function cancelIfOpen(orderId, ordersById) {
    const order = orderId && ordersById.get(orderId);
    if (order && ["OPEN", "TRIGGER PENDING", "AMO REQ RECEIVED"].includes(order.status)) {
      await withKiteAuth(() => kite.cancelOrder("regular", orderId)).catch((error) => log(`cancel ${orderId} failed: ${error.message}`));
    }
  }

  async function manageLive(minute) {
    const active = activePositions();
    if (!active.length) return;
    const orders = await withKiteAuth(() => kite.getOrders());
    const byId = new Map(orders.map((o) => [o.order_id, o]));

    for (const p of active) {
      if (p.status === "pending") {
        const entry = byId.get(p.orders.entry);
        if (!entry) continue;
        if (entry.status === "REJECTED" || entry.status === "CANCELLED") {
          p.status = "failed";
          state.tradedToday.delete(p.symbol);
          notify(`${p.symbol}: entry ${entry.status} - ${entry.status_message || ""}`);
          continue;
        }
        if (entry.status !== "COMPLETE") continue;
        // re-anchor stop/target to the actual fill price
        const long = p.side === "long";
        p.entry = entry.average_price;
        if (p.stop != null && !p.fixedStop) p.stop = roundToTick(long ? p.entry - p.refDistance : p.entry + p.refDistance, p.tick, long ? "down" : "up");
        if (p.target != null) p.target = roundToTick(long ? p.entry + p.refDistance * p.rr : p.entry - p.refDistance * p.rr, p.tick, long ? "up" : "down");
        p.status = "open";
        try {
          await placeExitOrders(p);
          notify(`${p.symbol} filled @ ${p.entry}. SL ${p.stop ?? "none"}, target ${p.target ?? "15:15 exit"}`);
        } catch (error) {
          notify(`${p.symbol}: failed to place exit orders (${error.message}). Squaring off now.`);
          await squareOffLive(p, byId);
        }
        continue;
      }

      const stopOrder = byId.get(p.orders.stop);
      const targetOrder = byId.get(p.orders.target);
      if (stopOrder?.status === "COMPLETE") {
        await cancelIfOpen(p.orders.target, byId);
        closePosition(p, stopOrder.average_price, "stop");
      } else if (targetOrder?.status === "COMPLETE") {
        await cancelIfOpen(p.orders.stop, byId);
        closePosition(p, targetOrder.average_price, "target");
      } else if (minute >= state.settings.squareOff) {
        await squareOffLive(p, byId);
      }
    }
  }

  async function squareOffLive(p, byId) {
    await cancelIfOpen(p.orders.stop, byId);
    await cancelIfOpen(p.orders.target, byId);
    try {
      const order = await withKiteAuth(() =>
        kite.placeOrder("regular", {
          exchange: "NSE",
          tradingsymbol: p.symbol,
          transaction_type: p.side === "long" ? "SELL" : "BUY",
          quantity: p.qty,
          product: "MIS",
          order_type: "MARKET",
          tag: ORDER_TAG,
        })
      );
      const ltp = (await getLtps([p.symbol]))[p.symbol];
      p.orders.squareOff = order.order_id;
      closePosition(p, ltp, "square-off");
    } catch (error) {
      notify(`${p.symbol}: SQUARE-OFF FAILED (${error.message}). Close it manually in Kite!`);
    }
  }

  // ---------------- main loop ----------------

  async function tick() {
    if (state.busy) return;
    state.busy = true;
    try {
      const now = istNow();
      if (state.day !== now.dateKey) resetDay(now.dateKey);

      if (state.settings.mode === "paper") {
        if (!state.universe.length) await loadUniverse();
        if (state.capital == null) await loadCapital();
        await paperTick(now);
        state.lastError = null;
        return;
      }

      if (now.weekday === 0 || now.weekday === 6) return;
      if (now.minute < 9 * 60 + 15 || now.minute > 15 * 60 + 30) return;
      if (!state.universe.length) await loadUniverse();
      if (state.capital == null) await loadCapital();

      const { settings } = state;
      await manageLive(now.minute);

      if (now.minute >= settings.squareOff) return;

      if (settings.strategies.includes("orb") && now.minute >= 9 * 60 + 20 && now.minute < 9 * 60 + 30) {
        if (!state.orbPrepared) await prepareOrb();
        await checkOrbBreaks(now.minute);
      }

      // closingTwoEngulfe runs once per completed 5-min candle
      const candleBoundary = now.minute - (now.minute % 5);
      if (
        settings.strategies.includes("engulfe") &&
        now.minute >= settings.engulfeStart &&
        now.second >= 5 &&
        state.lastEngulfeScanMinute !== candleBoundary &&
        canOpenNewTrade(now.minute)
      ) {
        state.lastEngulfeScanMinute = candleBoundary;
        await scanEngulfe(candleBoundary);
      }
      state.lastError = null;
    } catch (error) {
      state.lastError = error.message;
      log(`tick error: ${error.message}`);
    } finally {
      state.busy = false;
    }
  }

  return {
    // Starts one paper strategy ("gap" | "pullback" | "swing"); the engine runs while any is started.
    // Live mode supports only the gap fade.
    start(strategy = "gap") {
      if (!PAPER_STRATEGY_KEYS.includes(strategy)) throw new Error(`Unknown strategy ${strategy}`);
      state.settings = readSettings();
      if (state.settings.mode === "live" && strategy !== "gap") throw new Error("Live mode supports only the Gap fade strategy");
      state.activeStrategies.add(strategy);
      state.capital = null;
      state.lastReplayKey = null; // rescan now with the new strategy set
      state.enabled = true;
      if (!state.timer) state.timer = setInterval(tick, TICK_MS);
      notify(`Started ${describeStrategies(state.settings)[strategy].label}. Running: ${[...state.activeStrategies].join(", ")}`);
      tick();
      return this.status();
    },
    // Stops one strategy (or all when none is given); open live positions are NOT closed.
    stop(strategy) {
      if (strategy) state.activeStrategies.delete(strategy);
      else state.activeStrategies.clear();
      state.positions = state.positions.filter((p) => !p.strategyKey || state.activeStrategies.has(p.strategyKey));
      if (!state.activeStrategies.size) {
        state.enabled = false;
        clearInterval(state.timer);
        state.timer = null;
      }
      notify(
        state.activeStrategies.size
          ? `Stopped ${strategy}. Still running: ${[...state.activeStrategies].join(", ")}`
          : "Stopped. Open positions (if any) are NOT closed - use square-off or Kite."
      );
      return this.status();
    },
    signalsForDate,
    listFnoStocks,
    backtestStock,
    setMode(mode) {
      if (mode !== "live" && mode !== "paper") throw new Error("mode must be 'live' or 'paper'");
      if (state.settings.mode === "live" && activePositions().length) throw new Error("Close open live positions before switching mode");
      fs.writeFileSync(MODE_PATH, JSON.stringify({ mode, changedAt: new Date().toISOString() }));
      state.settings = readSettings();
      state.capital = null;
      state.positions = [];
      state.realisedPnl = 0;
      state.lastReplayKey = null;
      notify(`Mode switched to ${mode.toUpperCase()}`);
      return this.status();
    },
    async squareOffAll() {
      state.haltedReason = "Manual square-off";
      const active = activePositions();
      if (state.settings.mode === "live") {
        const orders = await withKiteAuth(() => kite.getOrders());
        const byId = new Map(orders.map((o) => [o.order_id, o]));
        for (const p of active) await squareOffLive(p, byId);
      }
      // paper trades are a replay of the session; nothing to close
      return this.status();
    },
    status() {
      return {
        enabled: state.enabled,
        mode: state.settings.mode,
        settings: state.settings,
        day: state.day,
        capital: state.capital,
        slotCapital: state.slotCapital,
        universeSize: state.universe.length,
        haltedReason: state.haltedReason,
        realisedPnl: +state.realisedPnl.toFixed(2),
        positions: state.positions,
        orbCandidates: state.orbCandidates,
        replayProgress: state.replayProgress,
        paperSessionDay: state.paperSessionDay,
        activeStrategies: [...state.activeStrategies],
        strategyInfo: describeStrategies(state.settings),
        lastError: state.lastError,
        recentEvents: state.events.slice(-30),
      };
    },
  };
}
