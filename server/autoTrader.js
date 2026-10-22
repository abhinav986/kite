// Intraday auto-trader for NSE F&O stocks (cash segment, MIS).
//
// Methods
//  - gap-up SELL:   stock opens >= min gap above yesterday's close and the 2nd 5-min candle breaks the 1st candle's low.
//  - gap-down BUY:  stock opens >= min gap below yesterday's close and the 2nd 5-min candle breaks the 1st candle's high.
//  - engulfe:       closingTwoEngulfe signal on completed 5-min candles, entered at market.
// Every entry also needs the signal candle's volume >= AUTOTRADE_VOLUME_MULTIPLE x the average of the previous
// 10 candles (previous day's candles are used when today has fewer than 10).
//
// Sizing: the available equity balance is split into AUTOTRADE_SLOTS equal parts (default 3); each trade uses
// one part. At most one trade per slot per day.
//
// Exits: no stop loss by default (AUTOTRADE_USE_STOP_LOSS=true turns it on). A position closes at its target
// (if the method's RR is > 0) or at AUTOTRADE_SQUARE_OFF (default 15:15).
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
    strategies: (process.env.AUTOTRADE_STRATEGIES || "orb,engulfe").split(",").map((s) => s.trim()).filter(Boolean),
    symbols: (process.env.AUTOTRADE_SYMBOLS || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
    slots,
    leverage: envNumber("AUTOTRADE_LEVERAGE", 1),
    paperCapital: envNumber("AUTOTRADE_PAPER_CAPITAL", 0),
    useStopLoss: process.env.AUTOTRADE_USE_STOP_LOSS === "true",
    volumeMultiple: envNumber("AUTOTRADE_VOLUME_MULTIPLE", 4),
    maxTradesPerDay: envNumber("AUTOTRADE_MAX_TRADES_PER_DAY", slots),
    maxDailyLoss: envNumber("AUTOTRADE_MAX_DAILY_LOSS", 0), // 0 = off
    orbMinGapPct: envNumber("AUTOTRADE_ORB_MIN_GAP_PCT", 0.5),
    orbMaxGapPct: envNumber("AUTOTRADE_ORB_MAX_GAP_PCT", 2),
    orbEntry: process.env.AUTOTRADE_ORB_ENTRY === "close" ? "close" : "break",
    orbRR: envNumber("AUTOTRADE_ORB_RR", 2), // target = RR x first-candle range; 0 = hold to square-off
    engulfeStopPct: envNumber("AUTOTRADE_ENGULFE_STOP_PCT", 1), // reference distance for stop/target
    engulfeRR: envNumber("AUTOTRADE_ENGULFE_RR", 0),
    engulfeMaxChasePct: envNumber("AUTOTRADE_ENGULFE_MAX_CHASE_PCT", 0.3),
    engulfeStart: parseClock(process.env.AUTOTRADE_ENGULFE_START, 10 * 60),
    lastEntry: parseClock(process.env.AUTOTRADE_LAST_ENTRY, 14 * 60 + 30),
    squareOff: parseClock(process.env.AUTOTRADE_SQUARE_OFF, 15 * 60 + 15),
  };
}

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
    const wanted = state.settings.symbols.length ? new Set(state.settings.symbols) : null;
    state.universe = nse
      .filter((i) => i.segment === "NSE" && i.instrument_type === "EQ" && fno.has(i.tradingsymbol))
      .filter((i) => !wanted || wanted.has(i.tradingsymbol))
      .map((i) => ({ symbol: i.tradingsymbol, token: i.instrument_token, tick: i.tick_size || 0.05 }));
    log(`Universe loaded: ${state.universe.length} F&O stocks`);
  }

  // Completed 5-min candles from the last few sessions up to uptoMinute today, so the 10-candle
  // volume average is available even early in the day.
  async function fetchCompletedCandles(token, toDateKey, toMinute) {
    await sleep(HISTORICAL_GAP_MS);
    const candles = await withKiteAuth(() =>
      kite.getHistoricalData(token, "5minute", kiteTime(shiftDateKey(toDateKey, -7), 9 * 60 + 15), kiteTime(toDateKey, toMinute), false, false)
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

  function volumeCheck(volume, avgVolume) {
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
  async function enterTrade({ stock, side, refPrice, refDistance, rr, strategy, reason }) {
    const { settings } = state;
    if (state.tradedToday.has(stock.symbol)) return;
    state.tradedToday.add(stock.symbol);

    const qty = Math.floor((state.slotCapital * settings.leverage) / refPrice);
    if (qty < 1) {
      log(`${stock.symbol}: skipped, ₹${state.slotCapital.toFixed(0)} buys less than 1 share at ${refPrice}`);
      return;
    }

    const long = side === "long";
    const stop = settings.useStopLoss ? roundToTick(long ? refPrice - refDistance : refPrice + refDistance, stock.tick, long ? "down" : "up") : null;
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
        range: first.high - first.low,
        firstVolume: first.volume,
        avgVolume: averageVolume(all), // 10 candles before the 2nd candle (1st candle + previous day)
      });
    }
    log(`Gap candidates: ${state.orbCandidates.map((c) => `${c.symbol} ${c.gapPct.toFixed(2)}%`).join(", ") || "none"}`);
  }

  async function tryOrbEntry(c, price, volume, minute) {
    const vol = volumeCheck(volume, c.avgVolume);
    if (!vol.ok) return false;
    if (!canOpenNewTrade(minute)) return true;
    await enterTrade({
      stock: c,
      side: c.side,
      refPrice: price,
      refDistance: c.range,
      rr: state.settings.orbRR,
      strategy: c.side === "short" ? "GAP-UP SELL" : "GAP-DOWN BUY",
      reason: `gap ${c.gapPct.toFixed(2)}%, ${vol.text}`,
    });
    return true;
  }

  async function checkOrbBreaks(minute) {
    const pending = state.orbCandidates.filter((c) => !state.tradedToday.has(c.symbol));
    if (!pending.length) return;

    if (state.settings.orbEntry === "break") {
      // 9:20-9:25: the 2nd candle is forming; enter when price crosses the level and the 2nd candle's
      // volume so far (day volume minus 1st candle) already passes the volume check
      if (minute >= 9 * 60 + 25) {
        log(`Gap window closed. Not triggered: ${pending.map((c) => c.symbol).join(", ")}`);
        state.orbCandidates = [];
        return;
      }
      const quotes = await getQuotes(pending.map((c) => c.symbol));
      for (const c of pending) {
        const q = quotes[c.symbol];
        if (!q?.last_price) continue;
        const broke = c.side === "short" ? q.last_price < c.level : q.last_price > c.level;
        if (broke) await tryOrbEntry(c, q.last_price, (q.volume || 0) - (c.firstVolume || 0), minute);
      }
      return;
    }

    // "close" entry: wait for the 2nd candle to close beyond the level
    if (minute < 9 * 60 + 25) return;
    state.orbCandidates = [];
    for (const c of pending) {
      const { today } = await getRecentCandles(c.token, 9 * 60 + 25);
      const second = today[1];
      if (!second) continue;
      const closedBeyond = c.side === "short" ? second.close < c.level : second.close > c.level;
      if (closedBeyond) await tryOrbEntry(c, second.close, second.volume, minute);
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

  function paperPosition({ stock, session, strategy, side, entryIdx, fromIdx, entry, refDistance, rr, reason, ltp }) {
    const { settings } = state;
    const long = side === "long";
    const qty = Math.max(1, Math.floor((state.slotCapital * settings.leverage) / entry));
    const stop = settings.useStopLoss ? roundToTick(long ? entry - refDistance : entry + refDistance, stock.tick, long ? "down" : "up") : null;
    const target = rr > 0 ? roundToTick(long ? entry + refDistance * rr : entry - refDistance * rr, stock.tick, long ? "up" : "down") : null;
    const exit = replayExit({ today: session.today, fromIdx, side, stop, target });
    const mark = exit ? exit.exit : ltp ?? session.today[session.today.length - 1].close;
    return {
      id: `${session.day}-${stock.symbol}-${strategy}`,
      day: session.day,
      strategy,
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

  function replayGap(stock, session) {
    const { settings } = state;
    const [c1, c2] = session.today;
    if (!c1 || !c2 || !session.prev.length) return null;
    const prevClose = session.prev[session.prev.length - 1].close;
    const gapPct = ((c1.open - prevClose) / prevClose) * 100;
    if (Math.abs(gapPct) < settings.orbMinGapPct || Math.abs(gapPct) >= settings.orbMaxGapPct) return null;

    const side = gapPct > 0 ? "short" : "long";
    const level = side === "short" ? c1.low : c1.high;
    let entry;
    if (settings.orbEntry === "break") {
      if (!(side === "short" ? c2.low < level : c2.high > level)) return null;
      entry = side === "short" ? Math.min(level, c2.open) : Math.max(level, c2.open);
    } else {
      if (!(side === "short" ? c2.close < level : c2.close > level)) return null;
      entry = c2.close;
    }
    const vol = volumeAt(session.history, session.offset + 1);
    if (!vol.ok) return null;
    return paperPosition({
      stock,
      session,
      strategy: side === "short" ? "GAP-UP SELL" : "GAP-DOWN BUY",
      side,
      entryIdx: 1,
      fromIdx: 2,
      entry,
      refDistance: c1.high - c1.low,
      rr: settings.orbRR,
      reason: `gap ${gapPct.toFixed(2)}%, ${vol.text}`,
    });
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

  async function replayPaperSession(now, marketOpen) {
    const { strategies } = state.settings;
    const ltps = marketOpen ? await getLtps(state.universe.map((s) => s.symbol)).catch(() => ({})) : {};
    const positions = [];
    let done = 0;
    for (const stock of state.universe) {
      done += 1;
      state.replayProgress = `${done}/${state.universe.length}`;
      let session;
      try {
        session = splitLastSession(await fetchCompletedCandles(stock.token, now.dateKey, Math.min(now.minute, 15 * 60 + 30)));
      } catch (error) {
        log(`${stock.symbol}: candle fetch failed - ${error.message}`);
        continue;
      }
      if (!session || session.today.length < 2) continue;
      if (strategies.includes("orb")) {
        const p = replayGap(stock, session);
        if (p) positions.push(p);
      }
      if (strategies.includes("engulfe")) {
        const p = replayEngulfe(stock, session, ltps[stock.symbol]);
        if (p) positions.push(p);
      }
    }
    state.replayProgress = null;

    positions.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    for (const p of positions) {
      if (state.notifiedPaperIds.has(p.id)) continue;
      state.notifiedPaperIds.add(p.id);
      const text = `${p.strategy} ${p.side === "long" ? "BUY" : "SELL"} ${p.qty} ${p.symbol} @ ${p.entry} (${p.reason})`;
      if (marketOpen) notify(text);
      else log(text);
    }
    state.positions = positions;
    state.realisedPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
    state.paperSessionDay = positions[0]?.day || state.paperSessionDay;
    log(`Paper replay done: ${positions.length} trades met the conditions (${positions.filter((p) => p.status === "open").length} still open)`);
  }

  async function paperTick(now) {
    const marketOpen = now.weekday >= 1 && now.weekday <= 5 && now.minute >= 9 * 60 + 15 && now.minute <= 15 * 60 + 30;
    // during market hours: once per completed 5-min candle; otherwise once per calendar day
    const key = marketOpen ? `${now.dateKey}-${now.minute - (now.minute % 5)}` : `closed-${now.dateKey}`;
    if (key === state.lastReplayKey || (marketOpen && now.second < 5)) return;
    state.lastReplayKey = key;
    await replayPaperSession(now, marketOpen);
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
        if (p.stop != null) p.stop = roundToTick(long ? p.entry - p.refDistance : p.entry + p.refDistance, p.tick, long ? "down" : "up");
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
    start() {
      state.settings = readSettings();
      state.capital = null;
      state.lastReplayKey = null;
      state.enabled = true;
      if (!state.timer) state.timer = setInterval(tick, TICK_MS);
      notify(`Started. Methods: ${state.settings.strategies.join(", ")}, ${state.settings.slots} slots, stop loss ${state.settings.useStopLoss ? "on" : "off"}`);
      tick();
      return this.status();
    },
    stop() {
      state.enabled = false;
      clearInterval(state.timer);
      state.timer = null;
      notify("Stopped. Open positions (if any) are NOT closed - use square-off or Kite.");
      return this.status();
    },
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
        lastError: state.lastError,
        recentEvents: state.events.slice(-30),
      };
    },
  };
}
