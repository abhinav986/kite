// Intraday auto-trader for NSE F&O stocks (cash segment, MIS).
//
// Strategies
//  - orb:     gap-up stock whose 2nd 5-min candle breaks the 1st candle's low -> SELL (stop = 1st high);
//             gap-down stock whose 2nd candle breaks the 1st candle's high -> BUY (stop = 1st low).
//  - engulfe: closingTwoEngulfe signal on completed 5-min candles, entered at market; stop is a % of entry.
//
// Modes
//  - paper (default): no orders are sent; fills are simulated from LTP.
//  - live: MARKET entry, then an exchange-side SL-M stop and a LIMIT target. When one fills the other is
//          cancelled. Everything still open is squared off at AUTOTRADE_SQUARE_OFF (default 15:15).
//          Live mode only runs when AUTOTRADE_MODE=live is set in .env.

import fs from "fs";
import path from "path";
import { closingTwoEngulfe } from "./strategies.js";

const IST_OFFSET_MS = 330 * 60000;
const TICK_MS = 5000;
const HISTORICAL_GAP_MS = 350; // historical API allows ~3 requests/second
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ORDER_TAG = "autotrd";
const LOG_PATH = path.join(process.cwd(), "server", "autotrader-trades.jsonl");

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== "" ? value : fallback;
}

function parseClock(value, fallback) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : fallback;
}

function readSettings() {
  return {
    mode: process.env.AUTOTRADE_MODE === "live" ? "live" : "paper",
    strategies: (process.env.AUTOTRADE_STRATEGIES || "orb").split(",").map((s) => s.trim()).filter(Boolean),
    symbols: (process.env.AUTOTRADE_SYMBOLS || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
    riskPerTrade: envNumber("AUTOTRADE_RISK_PER_TRADE", 500),
    maxNotional: envNumber("AUTOTRADE_MAX_NOTIONAL", 100000),
    maxTradesPerDay: envNumber("AUTOTRADE_MAX_TRADES_PER_DAY", 5),
    maxOpenPositions: envNumber("AUTOTRADE_MAX_OPEN_POSITIONS", 3),
    maxDailyLoss: envNumber("AUTOTRADE_MAX_DAILY_LOSS", 1500),
    orbMinGapPct: envNumber("AUTOTRADE_ORB_MIN_GAP_PCT", 0.5),
    orbMaxGapPct: envNumber("AUTOTRADE_ORB_MAX_GAP_PCT", 2),
    orbEntry: process.env.AUTOTRADE_ORB_ENTRY === "close" ? "close" : "break",
    orbRR: envNumber("AUTOTRADE_ORB_RR", 2),
    engulfeStopPct: envNumber("AUTOTRADE_ENGULFE_STOP_PCT", 1),
    engulfeRR: envNumber("AUTOTRADE_ENGULFE_RR", 2),
    engulfeMaxChasePct: envNumber("AUTOTRADE_ENGULFE_MAX_CHASE_PCT", 0.3),
    engulfeStart: parseClock(process.env.AUTOTRADE_ENGULFE_START, 10 * 60),
    lastEntry: parseClock(process.env.AUTOTRADE_LAST_ENTRY, 14 * 60 + 30),
    squareOff: parseClock(process.env.AUTOTRADE_SQUARE_OFF, 15 * 60 + 15),
  };
}

function istNow(date = new Date()) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    dateKey: ist.toISOString().slice(0, 10),
    weekday: ist.getUTCDay(),
    minute: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
    second: ist.getUTCSeconds(),
  };
}

function kiteTime(dateKey, minute) {
  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(minute % 60).padStart(2, "0");
  return `${dateKey} ${hh}:${mm}:00`;
}

function roundToTick(price, tick, direction) {
  const steps = price / tick;
  const rounded = direction === "up" ? Math.ceil(steps - 1e-9) : direction === "down" ? Math.floor(steps + 1e-9) : Math.round(steps);
  return +(rounded * tick).toFixed(2);
}

export function createAutoTrader({ kite, withKiteAuth, getInstruments, sendTelegramMessage }) {
  const state = {
    enabled: false,
    busy: false,
    timer: null,
    settings: readSettings(),
    day: null,
    universe: [], // [{ symbol, token, tick }]
    orbCandidates: [], // [{ symbol, token, tick, side, level, stop, gapPct }]
    orbPrepared: false,
    lastEngulfeScanMinute: -1,
    tradedToday: new Set(),
    positions: [], // open + closed for the day
    realisedPnl: 0,
    haltedReason: null,
    lastError: null,
    events: [],
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
    state.orbCandidates = [];
    state.orbPrepared = false;
    state.lastEngulfeScanMinute = -1;
    state.tradedToday = new Set();
    state.positions = [];
    state.realisedPnl = 0;
    state.haltedReason = null;
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

  async function getCandles(token, dateKey, uptoMinute) {
    await sleep(HISTORICAL_GAP_MS);
    const candles = await withKiteAuth(() =>
      kite.getHistoricalData(token, "5minute", kiteTime(dateKey, 9 * 60 + 15), kiteTime(dateKey, uptoMinute), false, false)
    );
    // keep completed candles only (a candle stamped hh:mm is complete at hh:mm + 5)
    const nowMs = Date.now();
    return (candles || []).filter((c) => new Date(c.date).getTime() + 5 * 60000 <= nowMs);
  }

  async function getLtps(symbols) {
    if (!symbols.length) return {};
    const data = await withKiteAuth(() => kite.getLTP(symbols.map((s) => `NSE:${s}`)));
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key.replace(/^NSE:/, ""), value.last_price]));
  }

  // ---------------- risk & entries ----------------

  function openPositions() {
    return state.positions.filter((p) => p.status === "open" || p.status === "pending");
  }

  function canOpenNewTrade(minute) {
    if (state.haltedReason) return false;
    if (minute > state.settings.lastEntry) return false;
    if (state.positions.length >= state.settings.maxTradesPerDay) return false;
    if (openPositions().length >= state.settings.maxOpenPositions) return false;
    return true;
  }

  async function enterTrade({ stock, side, refPrice, stop, rr, strategy }) {
    const { settings } = state;
    if (state.tradedToday.has(stock.symbol)) return;
    const risk = Math.abs(refPrice - stop);
    if (!(risk > 0)) return;
    const qty = Math.floor(Math.min(settings.riskPerTrade / risk, settings.maxNotional / refPrice));
    if (qty < 1) {
      log(`${stock.symbol}: skipped, quantity < 1 (risk/share ${risk.toFixed(2)})`);
      return;
    }

    state.tradedToday.add(stock.symbol);
    const long = side === "long";
    const position = {
      id: `${stock.symbol}-${Date.now()}`,
      strategy,
      symbol: stock.symbol,
      tick: stock.tick,
      side,
      qty,
      entry: refPrice,
      stop: roundToTick(stop, stock.tick, long ? "down" : "up"),
      target: roundToTick(long ? refPrice + risk * rr : refPrice - risk * rr, stock.tick, long ? "up" : "down"),
      status: "pending",
      openedAt: new Date().toISOString(),
      orders: {},
    };
    state.positions.push(position);

    if (settings.mode === "paper") {
      position.status = "open";
      notify(`${strategy} ${long ? "BUY" : "SELL"} ${qty} ${stock.symbol} @ ~${refPrice} SL ${position.stop} TGT ${position.target}`);
      return;
    }

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
      notify(`${strategy} ${long ? "BUY" : "SELL"} ${qty} ${stock.symbol} sent (order ${order.order_id})`);
    } catch (error) {
      position.status = "failed";
      notify(`${stock.symbol}: entry order failed - ${error.message}`);
    }
  }

  // ---------------- ORB ----------------

  async function prepareOrb(dateKey) {
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
      const candles = await getCandles(stock.token, dateKey, 9 * 60 + 20);
      const first = candles[0];
      if (!first) continue;
      const side = stock.gapPct > 0 ? "short" : "long";
      state.orbCandidates.push({
        ...stock,
        side,
        level: side === "short" ? first.low : first.high,
        stop: side === "short" ? first.high : first.low,
      });
    }
    log(`ORB: ${state.orbCandidates.length} gap candidates (${state.orbCandidates.map((c) => `${c.symbol} ${c.gapPct.toFixed(2)}%`).join(", ")})`);
  }

  async function checkOrbBreaks(minute) {
    const pending = state.orbCandidates.filter((c) => !state.tradedToday.has(c.symbol));
    if (!pending.length) return;

    if (state.settings.orbEntry === "break") {
      // 9:20-9:25: the 2nd candle is forming; enter as soon as LTP crosses the 1st candle's extreme
      if (minute >= 9 * 60 + 25) {
        state.orbCandidates = [];
        return;
      }
      const ltps = await getLtps(pending.map((c) => c.symbol));
      for (const c of pending) {
        const ltp = ltps[c.symbol];
        const broke = c.side === "short" ? ltp < c.level : ltp > c.level;
        if (ltp && broke && canOpenNewTrade(minute)) {
          await enterTrade({ stock: c, side: c.side, refPrice: ltp, stop: c.stop, rr: state.settings.orbRR, strategy: "ORB" });
        }
      }
      return;
    }

    // "close" entry: wait for the 2nd candle to close beyond the level
    if (minute < 9 * 60 + 25) return;
    state.orbCandidates = [];
    for (const c of pending) {
      const candles = await getCandles(c.token, state.day, 9 * 60 + 25);
      const second = candles[1];
      if (!second) continue;
      const closedBeyond = c.side === "short" ? second.close < c.level : second.close > c.level;
      if (closedBeyond && canOpenNewTrade(minute)) {
        await enterTrade({ stock: c, side: c.side, refPrice: second.close, stop: c.stop, rr: state.settings.orbRR, strategy: "ORB" });
      }
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
        candles = await getCandles(stock.token, state.day, minute);
      } catch (error) {
        log(`${stock.symbol}: candle fetch failed - ${error.message}`);
        continue;
      }
      const result = closingTwoEngulfe(candles);
      if (!result.hit || !Number.isFinite(Number(result.buyOrSellPrice))) continue;

      const signalPrice = Number(result.buyOrSellPrice);
      const ltp = (await getLtps([stock.symbol]))[stock.symbol];
      const chasePct = (Math.abs(ltp - signalPrice) / signalPrice) * 100;
      const side = result.direction === "up" ? "long" : "short";
      const movedAgainst = side === "long" ? ltp < signalPrice * (1 - settings.engulfeStopPct / 100) : ltp > signalPrice * (1 + settings.engulfeStopPct / 100);
      if (!ltp || chasePct > settings.engulfeMaxChasePct || movedAgainst) {
        state.tradedToday.add(stock.symbol);
        log(`${stock.symbol}: engulfe signal @ ${signalPrice} skipped, LTP ${ltp} is ${chasePct.toFixed(2)}% away`);
        continue;
      }
      const stopDistance = ltp * (settings.engulfeStopPct / 100);
      await enterTrade({
        stock,
        side,
        refPrice: ltp,
        stop: side === "long" ? ltp - stopDistance : ltp + stopDistance,
        rr: settings.engulfeRR,
        strategy: "ENGULFE",
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

    if (state.realisedPnl <= -state.settings.maxDailyLoss && !state.haltedReason) {
      state.haltedReason = `Daily loss limit ₹${state.settings.maxDailyLoss} reached`;
      notify(`${state.haltedReason}. No new trades today.`);
    }
  }

  async function managePaper(minute) {
    const open = state.positions.filter((p) => p.status === "open");
    if (!open.length) return;
    const ltps = await getLtps(open.map((p) => p.symbol));
    for (const p of open) {
      const ltp = ltps[p.symbol];
      if (!ltp) continue;
      const long = p.side === "long";
      if (long ? ltp <= p.stop : ltp >= p.stop) closePosition(p, ltp, "stop");
      else if (long ? ltp >= p.target : ltp <= p.target) closePosition(p, p.target, "target");
      else if (minute >= state.settings.squareOff) closePosition(p, ltp, "square-off");
    }
  }

  async function placeExitOrders(p) {
    const exitSide = p.side === "long" ? "SELL" : "BUY";
    const common = { exchange: "NSE", tradingsymbol: p.symbol, transaction_type: exitSide, quantity: p.qty, product: "MIS", tag: ORDER_TAG };
    const sl = await withKiteAuth(() => kite.placeOrder("regular", { ...common, order_type: "SL-M", trigger_price: p.stop }));
    p.orders.stop = sl.order_id;
    const tgt = await withKiteAuth(() => kite.placeOrder("regular", { ...common, order_type: "LIMIT", price: p.target }));
    p.orders.target = tgt.order_id;
  }

  async function cancelIfOpen(orderId, ordersById) {
    const order = orderId && ordersById.get(orderId);
    if (order && ["OPEN", "TRIGGER PENDING", "AMO REQ RECEIVED"].includes(order.status)) {
      await withKiteAuth(() => kite.cancelOrder("regular", orderId)).catch((error) => log(`cancel ${orderId} failed: ${error.message}`));
    }
  }

  async function manageLive(minute) {
    const active = state.positions.filter((p) => p.status === "pending" || p.status === "open");
    if (!active.length) return;
    const orders = await withKiteAuth(() => kite.getOrders());
    const byId = new Map(orders.map((o) => [o.order_id, o]));

    for (const p of active) {
      if (p.status === "pending") {
        const entry = byId.get(p.orders.entry);
        if (!entry) continue;
        if (entry.status === "REJECTED" || entry.status === "CANCELLED") {
          p.status = "failed";
          notify(`${p.symbol}: entry ${entry.status} - ${entry.status_message || ""}`);
          continue;
        }
        if (entry.status !== "COMPLETE") continue;
        // re-anchor stop/target to the actual fill, keeping the same per-share risk
        const long = p.side === "long";
        const risk = Math.abs(p.entry - p.stop);
        const rr = Math.abs(p.target - p.entry) / risk;
        p.entry = entry.average_price;
        p.stop = roundToTick(long ? p.entry - risk : p.entry + risk, p.tick, long ? "down" : "up");
        p.target = roundToTick(long ? p.entry + risk * rr : p.entry - risk * rr, p.tick, long ? "up" : "down");
        p.status = "open";
        try {
          await placeExitOrders(p);
          notify(`${p.symbol} filled @ ${p.entry}. SL-M ${p.stop}, target ${p.target}`);
        } catch (error) {
          notify(`${p.symbol}: FAILED to place stop/target (${error.message}). Squaring off now.`);
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
      if (now.weekday === 0 || now.weekday === 6) return;
      if (state.day !== now.dateKey) resetDay(now.dateKey);
      if (now.minute < 9 * 60 + 15 || now.minute > 15 * 60 + 30) return;
      if (!state.universe.length) await loadUniverse();

      const { settings } = state;
      if (settings.mode === "live") await manageLive(now.minute);
      else await managePaper(now.minute);

      if (now.minute >= settings.squareOff) return;

      if (settings.strategies.includes("orb") && now.minute >= 9 * 60 + 20 && now.minute < 9 * 60 + 30) {
        if (!state.orbPrepared) await prepareOrb(now.dateKey);
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
      state.enabled = true;
      if (!state.timer) state.timer = setInterval(tick, TICK_MS);
      notify(`Started. Strategies: ${state.settings.strategies.join(", ")}`);
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
    async squareOffAll() {
      state.haltedReason = "Manual square-off";
      const active = state.positions.filter((p) => p.status === "open" || p.status === "pending");
      if (state.settings.mode === "live") {
        const orders = await withKiteAuth(() => kite.getOrders());
        const byId = new Map(orders.map((o) => [o.order_id, o]));
        for (const p of active) await squareOffLive(p, byId);
      } else {
        const ltps = await getLtps(active.map((p) => p.symbol));
        for (const p of active) closePosition(p, ltps[p.symbol] ?? p.entry, "manual square-off");
      }
      return this.status();
    },
    status() {
      return {
        enabled: state.enabled,
        mode: state.settings.mode,
        settings: state.settings,
        day: state.day,
        universeSize: state.universe.length,
        haltedReason: state.haltedReason,
        realisedPnl: +state.realisedPnl.toFixed(2),
        positions: state.positions,
        orbCandidates: state.orbCandidates,
        lastError: state.lastError,
        recentEvents: state.events.slice(-30),
      };
    },
  };
}
