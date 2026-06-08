const fs = require("fs");
const path = require("path");
const http = require("http");
const { URL } = require("url");
const { KiteConnect } = require("kiteconnect");

loadEnvFile();

const PORT = Number(process.env.KITE_PORT || process.env.PORT || 5000);
const DAY_INTERVAL = "day";
const INTRADAY_INTERVAL = "5minute";
const SESSION_FILE_PATH = path.join(process.cwd(), ".kite-session.json");
const HISTORICAL_CONCURRENCY_LIMIT = Number(process.env.HISTORICAL_CONCURRENCY_LIMIT || 3);
const INTRADAY_CACHE_TTL_MS = Number(process.env.INTRADAY_CACHE_TTL_MS || 30 * 1000);
const DAY_CACHE_TTL_MS = Number(process.env.DAY_CACHE_TTL_MS || 5 * 60 * 1000);
const SCANNER_INTERVAL_MS = Number(process.env.SCANNER_INTERVAL_MS || 5 * 60 * 1000);
const SCANNER_START_MINUTE_IST = 10 * 60;
const SCANNER_END_MINUTE_IST = 14 * 60 + 30;

const config = {
  apiKey: process.env.KITE_API_KEY,
  apiSecret: process.env.KITE_API_SECRET,
  accessToken: process.env.KITE_ACCESS_TOKEN,
  refreshToken: process.env.KITE_REFRESH_TOKEN,
  redirectUrl: process.env.KITE_REDIRECT_URL || "",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:8080",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
};

const persistedSession = loadPersistedSession();
if (!config.accessToken && persistedSession?.accessToken) {
  config.accessToken = persistedSession.accessToken;
}
if (!config.refreshToken && persistedSession?.refreshToken) {
  config.refreshToken = persistedSession.refreshToken;
}

const kite = new KiteConnect({
  api_key: config.apiKey || "",
});

if (config.accessToken) {
  kite.setAccessToken(config.accessToken);
}

kite.setSessionExpiryHook(() => {
  config.accessToken = "";
});

const cache = {
  instruments: {
    expiresAt: 0,
    value: null,
  },
  historical: new Map(),
  historicalInflight: new Map(),
  historicalQueue: [],
  historicalActiveCount: 0,
};

const scannerState = {
  enabled: false,
  running: false,
  timer: null,
  lastRunAt: null,
  nextRunAt: null,
  lastError: null,
  lastSummary: null,
  notifiedHitKeys: new Set(),
};

const scannerOptions = [
  { key: "stocks65To70", label: "Scanner 1" },
  { key: "stocks70To75", label: "Scanner 2" },
  { key: "stocks75To80", label: "Scanner 3" },
  { key: "stocks80To100", label: "Scanner 4" },
  { key: "stocks80To100_2", label: "Scanner 5" },
  { key: "stocks70To75_2", label: "Scanner 6" },
];

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function loadPersistedSession() {
  if (!fs.existsSync(SESSION_FILE_PATH)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE_PATH, "utf8"));
  } catch (error) {
    console.warn("Failed to read persisted Kite session file.");
    return null;
  }
}

function savePersistedSession(session) {
  const payload = {
    accessToken: session.access_token || config.accessToken || "",
    refreshToken: session.refresh_token || config.refreshToken || "",
    publicToken: session.public_token || "",
    userId: session.user_id || "",
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(SESSION_FILE_PATH, JSON.stringify(payload, null, 2));
}

function clearPersistedSession() {
  if (fs.existsSync(SESSION_FILE_PATH)) {
    fs.unlinkSync(SESSION_FILE_PATH);
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function sendNoContent(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end();
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    req.on("error", reject);
  });
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return String(value).toLowerCase() === "true";
}

function parseInstrumentList(searchParams) {
  const repeated = searchParams.getAll("i");
  if (repeated.length > 0) {
    return repeated;
  }

  const csv = searchParams.get("instruments");
  if (!csv) {
    return [];
  }

  return csv
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function requireEnv(name, value) {
  if (!value) {
    const error = new Error(`Missing required environment variable: ${name}`);
    error.statusCode = 500;
    throw error;
  }
}

function ensureConfigured() {
  requireEnv("KITE_API_KEY", config.apiKey);
}

function setAccessToken(accessToken) {
  config.accessToken = accessToken;
  kite.setAccessToken(accessToken);
}

function clearInMemorySession() {
  config.accessToken = "";
  config.refreshToken = "";
}

function setSessionTokens(session) {
  if (session.access_token) {
    setAccessToken(session.access_token);
  }

  if (session.refresh_token) {
    config.refreshToken = session.refresh_token;
  }

  savePersistedSession(session);
}

async function tryGenerateSessionFromRequestToken(requestToken) {
  requireEnv("KITE_API_SECRET", config.apiSecret);
  const session = await kite.generateSession(requestToken, config.apiSecret);
  setSessionTokens(session);
  return session;
}

async function tryRenewAccessToken() {
  requireEnv("KITE_API_SECRET", config.apiSecret);

  if (!config.refreshToken) {
    return false;
  }

  const session = await kite.renewAccessToken(config.refreshToken, config.apiSecret);
  setSessionTokens(session);
  console.log("Kite access token renewed from refresh token.");
  return true;
}

async function ensureActiveSession() {
  ensureConfigured();

  if (config.accessToken) {
    return;
  }

  if (config.refreshToken) {
    await tryRenewAccessToken();
  }
}

function isTokenError(error) {
  const statusCode = error?.response?.status || error?.statusCode;
  const errorType = error?.response?.data?.error_type;
  const message = String(error?.message || "").toLowerCase();

  return (
    statusCode === 401 ||
    errorType === "TokenException" ||
    message.includes("token is invalid") ||
    message.includes("token has expired")
  );
}

async function withKiteAuth(action) {
  await ensureActiveSession();

  try {
    return await action();
  } catch (error) {
    if (!isTokenError(error)) {
      throw error;
    }

    config.accessToken = "";

    if (config.refreshToken) {
      await tryRenewAccessToken();
      return action();
    }

    clearPersistedSession();
    throw error;
  }
}

function normaliseKiteError(error) {
  const statusCode = error?.response?.status || error?.statusCode || 500;
  const data = error?.response?.data;

  return {
    statusCode,
    payload: {
      error: error?.message || "Unexpected server error",
      details: data || null,
    },
  };
}

function getRequiredNumber(searchParams, key) {
  const value = searchParams.get(key);
  if (!value) {
    const error = new Error(`Missing required query parameter: ${key}`);
    error.statusCode = 400;
    throw error;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    const error = new Error(`Query parameter "${key}" must be a number.`);
    error.statusCode = 400;
    throw error;
  }

  return parsed;
}

// function resolveDateRange(searchParams, mode) {
//   const now = new Date();
//   const from = searchParams.get("from");
//   const to = searchParams.get("to");

//   if (from && to) {
//     return { from, to };
//   }

//   const startOfToday = new Date("04/10/2026");
//   startOfToday.setHours(0, 0, 0, 0);

//   // Get yesterday
//   const yesterday = new Date(startOfToday);
//   yesterday.setDate(startOfToday.getDate());
//   yesterday.setHours(23, 59, 59, 999); // optional: end of yesterday

//   return {
//     from: startOfToday,
//     to: yesterday,
//   };
// }
// Format date to Kite-required format
function formatDate(date) {
  const pad = (n) => String(n).padStart(2, "0");

  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate()) +
    " " +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes()) +
    ":" +
    pad(date.getSeconds())
  );
}

// Convert system time → IST
function getISTDate(date = new Date()) {
  return new Date(
    date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );
}

// Main function
function resolveDateRange(searchParams, mode, fallbackWindow = "default") {
  const nowIST = getISTDate();

  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  if (fromParam && toParam) {
    return {
      from: fromParam,
      to: toParam,
    };
  }

  if (mode === "intraday" && fallbackWindow === "month") {
    const twoMonthsAgoIST = new Date(nowIST);
    twoMonthsAgoIST.setMonth(twoMonthsAgoIST.getMonth() - 2);
    twoMonthsAgoIST.setHours(9, 15, 0, 0);

    const rangeEnd = new Date(nowIST);
    rangeEnd.setSeconds(0, 0);

    return {
      from: formatDate(twoMonthsAgoIST),
      to: formatDate(rangeEnd),
    };
  }

  const startOfTodayIST = new Date(nowIST);
  startOfTodayIST.setHours(9, 15, 0, 0);

  // Before market open → fallback to yesterday
  if (nowIST < startOfTodayIST) {
    const yesterday = new Date(startOfTodayIST);
    yesterday.setDate(yesterday.getDate() - 1);

    const yesterdayStart = new Date(yesterday);
    yesterdayStart.setHours(9, 15, 0, 0);

    const yesterdayEnd = new Date(yesterday);
    yesterdayEnd.setHours(15, 30, 0, 0);

    return {
      from: formatDate(yesterdayStart),
      to: formatDate(yesterdayEnd),
    };
  }

  return {
    from: formatDate(startOfTodayIST),
    to: formatDate(nowIST),
  };
}


async function getInstruments(exchange) {
  const cacheKey = exchange || "all";
  const cached = cache.instruments.value && cache.instruments.value[cacheKey];

  if (cached && cache.instruments.expiresAt > Date.now()) {
    return cached;
  }

  const instruments = await withKiteAuth(() => kite.getInstruments(exchange));
  cache.instruments.value = cache.instruments.value || {};
  cache.instruments.value[cacheKey] = instruments;
  cache.instruments.expiresAt = Date.now() + 15 * 60 * 1000;

  return instruments;
}

function getLoginUrl() {
  ensureConfigured();
  return kite.getLoginURL();
}

function getHistoricalCacheTtl(mode) {
  return mode === "intraday" ? INTRADAY_CACHE_TTL_MS : DAY_CACHE_TTL_MS;
}

function getHistoricalCacheKey({ instrumentToken, interval, from, to, continuous, oi, mode }) {
  return [
    mode,
    instrumentToken,
    interval,
    new Date(from).toISOString(),
    new Date(to).toISOString(),
    continuous ? "1" : "0",
    oi ? "1" : "0",
  ].join("|");
}

function getCachedHistoricalResponse(cacheKey) {
  const cached = cache.historical.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    cache.historical.delete(cacheKey);
    return null;
  }

  return cached.value;
}

function setCachedHistoricalResponse(cacheKey, value, ttlMs) {
  cache.historical.set(cacheKey, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function runHistoricalTask(task) {
  return new Promise((resolve, reject) => {
    const execute = async () => {
      cache.historicalActiveCount += 1;

      try {
        resolve(await task());
      } catch (error) {
        reject(error);
      } finally {
        cache.historicalActiveCount -= 1;
        const next = cache.historicalQueue.shift();
        if (next) {
          next();
        }
      }
    };

    if (cache.historicalActiveCount < HISTORICAL_CONCURRENCY_LIMIT) {
      execute();
      return;
    }

    cache.historicalQueue.push(execute);
  });
}

async function getHistoricalDataCached(request) {
  const cacheKey = getHistoricalCacheKey(request);
  const ttlMs = getHistoricalCacheTtl(request.mode);
  const cached = getCachedHistoricalResponse(cacheKey);

  if (cached) {
    return cached;
  }

  const inflight = cache.historicalInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const promise = runHistoricalTask(() =>
    withKiteAuth(() =>
      kite.getHistoricalData(
        request.instrumentToken,
        request.interval,
        request.from,
        request.to,
        request.continuous,
        request.oi
      )
    )
  );

  cache.historicalInflight.set(cacheKey, promise);

  try {
    const data = await promise;
    setCachedHistoricalResponse(cacheKey, data, ttlMs);
    return data;
  } finally {
    cache.historicalInflight.delete(cacheKey);
  }
}

function getScannerStatus() {
  return {
    enabled: scannerState.enabled,
    running: scannerState.running,
    lastRunAt: scannerState.lastRunAt,
    nextRunAt: scannerState.nextRunAt,
    lastError: scannerState.lastError,
    lastSummary: scannerState.lastSummary,
    notifiedHitCount: scannerState.notifiedHitKeys.size,
    telegramConfigured: Boolean(config.telegramBotToken && config.telegramChatId),
    intervalMs: SCANNER_INTERVAL_MS,
  };
}

function getMinutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function isScannerWindow(date = new Date()) {
  const nowIST = getISTDate(date);
  const day = nowIST.getDay();
  const minutes = getMinutesSinceMidnight(nowIST);

  return (
    day >= 1 &&
    day <= 5 &&
    minutes >= SCANNER_START_MINUTE_IST &&
    minutes <= SCANNER_END_MINUTE_IST
  );
}

function getDelayToNextScannerWindow(date = new Date()) {
  const nowIST = getISTDate(date);
  const targetIST = new Date(nowIST);
  targetIST.setHours(10, 0, 0, 0);

  if (
    nowIST.getDay() >= 1 &&
    nowIST.getDay() <= 5 &&
    getMinutesSinceMidnight(nowIST) < SCANNER_START_MINUTE_IST
  ) {
    return targetIST.getTime() - nowIST.getTime();
  }

  do {
    targetIST.setDate(targetIST.getDate() + 1);
    targetIST.setHours(10, 0, 0, 0);
  } while (targetIST.getDay() === 0 || targetIST.getDay() === 6);

  return targetIST.getTime() - nowIST.getTime();
}

function getNextScannerDelay() {
  if (isScannerWindow()) {
    return SCANNER_INTERVAL_MS;
  }

  return Math.max(60 * 1000, getDelayToNextScannerWindow());
}

function scheduleNextScannerRun(delayMs = getNextScannerDelay()) {
  if (!scannerState.enabled) {
    scannerState.nextRunAt = null;
    return;
  }

  if (scannerState.timer) {
    clearTimeout(scannerState.timer);
  }

  scannerState.nextRunAt = new Date(Date.now() + delayMs).toISOString();
  scannerState.timer = setTimeout(() => {
    runScannerLoop().catch((error) => {
      console.error("Scanner loop failed:", error);
    });
  }, delayMs);
}

async function sendTelegramMessage(text) {
  if (!config.telegramBotToken || !config.telegramChatId) {
    console.warn("Telegram notification skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing.");
    return false;
  }

  const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.telegramChatId,
      text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Telegram send failed (${response.status}): ${detail}`);
  }

  return true;
}

function loadScannerStockGroups() {
  const stockFilePath = path.join(process.cwd(), "src", "constants", "stock.js");
  const content = fs.readFileSync(stockFilePath, "utf8");
  const groups = {};

  scannerOptions.forEach((option) => {
    const pattern = new RegExp(`export\\s+const\\s+${option.key}\\s*=\\s*(\\[[\\s\\S]*?\\])`, "m");
    const match = content.match(pattern);
    if (!match) {
      groups[option.key] = [];
      return;
    }

    try {
      groups[option.key] = JSON.parse(match[1].replace(/,\s*\]/g, "]"));
    } catch (error) {
      console.warn(`Unable to parse scanner group ${option.key}:`, error.message);
      groups[option.key] = [];
    }
  });

  return groups;
}

async function getNseEquityInstrumentMap() {
  const instruments = await getInstruments();
  const map = new Map();

  instruments.forEach((instrument) => {
    if (instrument.segment === "NSE" && instrument.instrument_type === "EQ" && instrument.name) {
      map.set(instrument.name, instrument.instrument_token);
    }
  });

  return map;
}

function engulfe(candles) {
  let hit = false;
  let buyOrSellPrice;
  let direction;
  let inProgress = false;
  let isSucess = false;

  for (let i = 2; i < candles.length - 6; i++) {
    let c1 = candles[i - 1];
    let c2 = candles[i];

    let upPhase1 = c2.close > c1.high && c2.low > c1.low;

    if (upPhase1) {
      let validPullbackUp = false;
      let hightestHigh = c2.high;
      let crossCount = 0;
      let dontCrossLow = c1.low;
      let topPrice = 0;

      for (let k = i + 1; k < candles.length; k++) {
        if (candles[k - 1].high >= candles[k].high && candles[k].low >= candles[k - 1].low) {
          break;
        }
        if (crossCount >= 1 && topPrice < candles[k].high) {
          topPrice = candles[k].high;
        } else if (crossCount >= 1 && topPrice >= candles[k].high) {
          break;
        }
        if (candles[k].high > candles[k - 1].high) {
          dontCrossLow = candles[k - 1].low;
        }
        if (candles[k].high > hightestHigh && !validPullbackUp) {
          hightestHigh = candles[k].high;
        }
        if (candles[k].low < candles[k - 1].low) {
          if (candles[k].high >= candles[k - 1].high) {
            break;
          }
          validPullbackUp = true;
        }
        if (validPullbackUp && candles[k].high > hightestHigh) {
          crossCount++;
          topPrice = candles[k].high;
          if (crossCount === 4) {
            hit = true;
            isSucess = true;
            buyOrSellPrice = candles[k - 1].high;
            break;
          }
          if (crossCount === 1 && candles[k].close < hightestHigh) {
            inProgress = false;
            break;
          }
          if (candles[k - 1].low >= candles[k].low && candles[k - 1].high <= candles[k].high) {
            inProgress = false;
            break;
          }
        }
        if (crossCount === 2) {
          inProgress = true;
          direction = "up";
        }
        if (candles[k].low < dontCrossLow) {
          break;
        }
      }
    }

    let downPhase1 = c2.close < c1.low && c2.high < c1.high;

    if (downPhase1) {
      let validPullbackDown = false;
      let lowestLow = c2.low;
      let crossCount = 0;
      let dontCrossHigh = c1.high;
      let lowestPrice = 0;

      for (let k = i + 1; k < candles.length; k++) {
        if (candles[k - 1].high >= candles[k].high && candles[k].low >= candles[k - 1].low) {
          break;
        }
        if (crossCount >= 1 && lowestPrice > candles[k].low) {
          lowestPrice = candles[k].low;
        } else if (crossCount >= 1 && lowestPrice <= candles[k].low) {
          break;
        }
        if (candles[k].low < candles[k - 1].low) {
          dontCrossHigh = candles[k - 1].high;
        }
        if (candles[k].low < lowestLow && !validPullbackDown) {
          lowestLow = candles[k].low;
        }
        if (candles[k].high > candles[k - 1].high) {
          if (candles[k - 1].low >= candles[k].low) {
            break;
          }
          validPullbackDown = true;
        }
        if (validPullbackDown && candles[k].low < lowestLow) {
          crossCount++;
          lowestPrice = candles[k].low;
          if (crossCount === 4) {
            hit = true;
            isSucess = true;
            buyOrSellPrice = candles[k - 1].low;
            break;
          }
          if (crossCount === 1 && candles[k].close > lowestLow) {
            inProgress = false;
            break;
          }
          if (candles[k - 1].low >= candles[k].low && candles[k - 1].high <= candles[k].high) {
            inProgress = false;
            break;
          }
        }
        if (crossCount === 2) {
          inProgress = true;
          direction = "down";
        }
        if (candles[k].high > dontCrossHigh) {
          break;
        }
      }
    }

    if (hit) {
      break;
    }
  }

  const lastCandle = candles[candles.length - 1];
  const target = direction === "up" ? lastCandle?.high : lastCandle?.low;

  return {
    buyOrSellPrice,
    target,
    profitOrLoss:
      direction === "up"
        ? Math.floor((target || 0) - (buyOrSellPrice || 0))
        : Math.floor((buyOrSellPrice || 0) - (target || 0)),
    direction,
    time: candles[0]?.date,
    hit,
    inProgress,
    isSucess,
  };
}

async function scanStock(stock, scannerLabel) {
  const now = new Date();
  const range = resolveDateRange(new URLSearchParams(), "intraday", "default");
  const candles = await getHistoricalDataCached({
    instrumentToken: stock.instrumentToken,
    mode: "intraday",
    interval: INTRADAY_INTERVAL,
    from: range.from,
    to: range.to,
    continuous: false,
    oi: false,
  });

  const result = engulfe(candles || []);
  if (!result.hit || !Number.isFinite(Number(result.buyOrSellPrice))) {
    return null;
  }

  const hitKey = `${stock.name}|${result.buyOrSellPrice}`;
  if (scannerState.notifiedHitKeys.has(hitKey)) {
    return null;
  }

  scannerState.notifiedHitKeys.add(hitKey);
  return {
    name: stock.name,
    price: result.buyOrSellPrice,
    scannerLabel,
    direction: result.direction,
    hitAt: now.toISOString(),
  };
}

async function runScannerOnce() {
  const stockGroups = loadScannerStockGroups();
  const instrumentMap = await getNseEquityInstrumentMap();
  const hits = [];
  const errors = [];
  let scanned = 0;

  for (const option of scannerOptions) {
    const stocks = (stockGroups[option.key] || [])
      .map((name) => ({
        name,
        instrumentToken: instrumentMap.get(name),
      }))
      .filter((stock) => stock.instrumentToken);

    for (const stock of stocks) {
      scanned += 1;
      try {
        const hit = await scanStock(stock, option.label);
        if (hit) {
          hits.push(hit);
          await sendTelegramMessage(`${hit.name} ${hit.price}`);
        }
      } catch (error) {
        const message = `${option.label} ${stock.name}: ${error.message}`;
        errors.push(message);
        await sendTelegramMessage(`Scanner error: ${message}`).catch((telegramError) => {
          console.error("Unable to send scanner error to Telegram:", telegramError.message);
        });
      }
    }
  }

  return {
    scanned,
    hits,
    errors,
    completedAt: new Date().toISOString(),
  };
}

async function runScannerLoop({ force = false } = {}) {
  if (scannerState.running) {
    return scannerState.lastSummary;
  }

  if (!force && !isScannerWindow()) {
    scannerState.lastSummary = {
      skipped: true,
      reason: "Outside scanner window",
      completedAt: new Date().toISOString(),
    };
    scheduleNextScannerRun();
    return scannerState.lastSummary;
  }

  scannerState.running = true;
  scannerState.lastRunAt = new Date().toISOString();
  scannerState.lastError = null;

  try {
    scannerState.lastSummary = await runScannerOnce();
    return scannerState.lastSummary;
  } catch (error) {
    scannerState.lastError = error.message;
    await sendTelegramMessage(`Scanner error: ${error.message}`).catch((telegramError) => {
      console.error("Unable to send scanner error to Telegram:", telegramError.message);
    });
    throw error;
  } finally {
    scannerState.running = false;
    if (scannerState.enabled) {
      scheduleNextScannerRun();
    }
  }
}

function startScanner() {
  scannerState.enabled = true;

  if (!scannerState.running) {
    scheduleNextScannerRun(isScannerWindow() ? 0 : getDelayToNextScannerWindow());
  }

  return getScannerStatus();
}

function stopScanner() {
  scannerState.enabled = false;
  scannerState.nextRunAt = null;

  if (scannerState.timer) {
    clearTimeout(scannerState.timer);
    scannerState.timer = null;
  }

  return getScannerStatus();
}

function buildAuthCallbackSuccessPage() {
  const destination = config.frontendUrl || "/";

  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kite Connected</title>
    <style>
      body {
        margin: 0;
        font-family: Segoe UI, Arial, sans-serif;
        background: linear-gradient(135deg, #fff8eb, #d9f0ec);
        color: #0f172a;
        display: grid;
        place-items: center;
        min-height: 100vh;
      }
      .card {
        width: min(92vw, 540px);
        background: rgba(255,255,255,0.92);
        border-radius: 24px;
        padding: 32px;
        box-shadow: 0 22px 60px rgba(15, 61, 62, 0.12);
      }
      h1 { margin: 0 0 12px; font-size: 28px; }
      p { margin: 0 0 20px; line-height: 1.6; color: #475569; }
      a {
        display: inline-block;
        text-decoration: none;
        background: #0f766e;
        color: white;
        padding: 12px 18px;
        border-radius: 12px;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Kite login complete</h1>
      <p>The server has stored the session and can now auto-renew using the refresh token. You can close this tab or return to the app.</p>
      <a href="${destination}">Back to app</a>
    </div>
  </body>
</html>`;
}

const routes = {
  async health(req, res) {
    sendJson(res, 200, {
      ok: true,
      configured: Boolean(config.apiKey),
      authenticated: Boolean(config.accessToken),
      renewable: Boolean(config.refreshToken),
    });
  },

  async authStatus(req, res) {
    sendJson(res, 200, {
      configured: Boolean(config.apiKey && config.apiSecret),
      authenticated: Boolean(config.accessToken),
      renewable: Boolean(config.refreshToken),
      hasPersistedSession: Boolean(loadPersistedSession()),
      redirectUrl: config.redirectUrl || null,
      frontendUrl: config.frontendUrl || null,
    });
  },

  async scannerStatus(req, res) {
    sendJson(res, 200, getScannerStatus());
  },

  async scannerStart(req, res) {
    sendJson(res, 200, startScanner());
  },

  async scannerStop(req, res) {
    sendJson(res, 200, stopScanner());
  },

  async scannerRunOnce(req, res) {
    const body = await parseBody(req);
    const summary = await runScannerLoop({ force: Boolean(body.force) });
    sendJson(res, 200, {
      ...getScannerStatus(),
      summary,
    });
  },

  async loginUrl(req, res) {
    sendJson(res, 200, { loginUrl: getLoginUrl() });
  },

  async login(req, res) {
    redirect(res, getLoginUrl());
  },

  async authCallback(req, res, url) {
    ensureConfigured();

    const requestToken = url.searchParams.get("request_token");
    const status = url.searchParams.get("status");

    if (status && status !== "success") {
      sendHtml(res, 400, `<h1>Kite login failed</h1><p>Status: ${status}</p>`);
      return;
    }

    if (!requestToken) {
      sendHtml(res, 400, "<h1>Missing request_token</h1><p>The callback did not include a Kite request token.</p>");
      return;
    }

    await tryGenerateSessionFromRequestToken(requestToken);
    sendHtml(res, 200, buildAuthCallbackSuccessPage());
  },

  async logout(req, res) {
    clearInMemorySession();
    clearPersistedSession();
    sendJson(res, 200, { ok: true });
  },

  async profile(req, res) {
    sendJson(res, 200, await withKiteAuth(() => kite.getProfile()));
  },

  async margins(req, res, url) {
    const segment = url.searchParams.get("segment") || undefined;
    sendJson(res, 200, await withKiteAuth(() => kite.getMargins(segment)));
  },

  async positions(req, res) {
    sendJson(res, 200, await withKiteAuth(() => kite.getPositions()));
  },

  async convertPosition(req, res) {
    const body = await parseBody(req);
    sendJson(res, 200, await withKiteAuth(() => kite.convertPosition(body)));
  },

  async holdings(req, res) {
    sendJson(res, 200, await withKiteAuth(() => kite.getHoldings()));
  },

  async orderHistory(req, res, url, params) {
    sendJson(res, 200, await withKiteAuth(() => kite.getOrderHistory(params.orderId)));
  },

  async trades(req, res) {
    sendJson(res, 200, await withKiteAuth(() => kite.getTrades()));
  },

  async orderTrades(req, res, url, params) {
    sendJson(res, 200, await withKiteAuth(() => kite.getOrderTrades(params.orderId)));
  },

  async instruments(req, res, url) {
    const exchange = url.searchParams.get("exchange") || undefined;
    sendJson(res, 200, await getInstruments(exchange));
  },

  async quote(req, res, url) {
    const instruments = parseInstrumentList(url.searchParams);
    sendJson(res, 200, await withKiteAuth(() => kite.getQuote(instruments)));
  },

  async ohlc(req, res, url) {
    const instruments = parseInstrumentList(url.searchParams);
    sendJson(res, 200, await withKiteAuth(() => kite.getOHLC(instruments)));
  },

  async ltp(req, res, url) {
    const instruments = parseInstrumentList(url.searchParams);
    sendJson(res, 200, await withKiteAuth(() => kite.getLTP(instruments)));
  },

  async historical(req, res, url, params = {}) {
    const instrumentToken = params.instrumentToken || getRequiredNumber(url.searchParams, "id");
    const mode = params.mode || url.searchParams.get("mode") || "intraday";
    const fallbackWindow = params.fallbackWindow || url.searchParams.get("fallbackWindow") || (mode === "intraday" ? "month" : "default");
    const range = resolveDateRange(url.searchParams, mode, fallbackWindow);
    const interval = url.searchParams.get("interval") || (mode === "intraday" ? INTRADAY_INTERVAL : DAY_INTERVAL);
    const continuous = parseBoolean(url.searchParams.get("continuous"), false);
    const oi = parseBoolean(url.searchParams.get("oi"), false);

    const data = await getHistoricalDataCached({
      instrumentToken,
      mode,
      interval,
      from: range.from,
      to: range.to,
      continuous,
      oi,
    });

    sendJson(res, 200, data);
  },

  async placeOrder(req, res, url) {
    const body = await parseBody(req);
    const variety = body.variety || url.searchParams.get("variety") || kite.VARIETY_REGULAR;
    const payload = { ...body };
    delete payload.variety;
    sendJson(res, 200, await withKiteAuth(() => kite.placeOrder(variety, payload)));
  },

  async modifyOrder(req, res, url, params) {
    const body = await parseBody(req);
    const variety = body.variety || url.searchParams.get("variety") || kite.VARIETY_REGULAR;
    const payload = { ...body };
    delete payload.variety;
    sendJson(res, 200, await withKiteAuth(() => kite.modifyOrder(variety, params.orderId, payload)));
  },

  async cancelOrder(req, res, url, params) {
    const variety = url.searchParams.get("variety") || kite.VARIETY_REGULAR;
    sendJson(res, 200, await withKiteAuth(() => kite.cancelOrder(variety, params.orderId)));
  },

  async getGtts(req, res) {
    sendJson(res, 200, await withKiteAuth(() => kite.getGTTs()));
  },

  async getGtt(req, res, url, params) {
    sendJson(res, 200, await withKiteAuth(() => kite.getGTT(params.triggerId)));
  },

  async placeGtt(req, res) {
    const body = await parseBody(req);
    sendJson(res, 200, await withKiteAuth(() => kite.placeGTT(body)));
  },

  async modifyGtt(req, res, url, params) {
    const body = await parseBody(req);
    sendJson(res, 200, await withKiteAuth(() => kite.modifyGTT(params.triggerId, body)));
  },

  async deleteGtt(req, res, url, params) {
    sendJson(res, 200, await withKiteAuth(() => kite.deleteGTT(params.triggerId)));
  },

  async orderMargins(req, res, url) {
    const body = await parseBody(req);
    const mode = url.searchParams.get("mode") || body.mode || undefined;
    const orders = body.orders || body;
    sendJson(res, 200, await withKiteAuth(() => kite.orderMargins(orders, mode)));
  },

  async basketMargins(req, res, url) {
    const body = await parseBody(req);
    const mode = url.searchParams.get("mode") || body.mode || undefined;
    const considerPositions = parseBoolean(
      url.searchParams.get("considerPositions"),
      body.considerPositions
    );
    const orders = body.orders || body;
    sendJson(res, 200, await withKiteAuth(() => kite.orderBasketMargins(orders, considerPositions, mode)));
  },

  async virtualContractNote(req, res) {
    const body = await parseBody(req);
    const payload = Array.isArray(body) ? body : body.orders;
    sendJson(res, 200, await withKiteAuth(() => kite.getvirtualContractNote(payload)));
  },
};

const router = [
  { method: "GET", pattern: /^\/api\/health\/?$/, handler: routes.health },
  { method: "GET", pattern: /^\/api\/auth\/status\/?$/, handler: routes.authStatus },
  { method: "GET", pattern: /^\/api\/scanner\/status\/?$/, handler: routes.scannerStatus },
  { method: "POST", pattern: /^\/api\/scanner\/start\/?$/, handler: routes.scannerStart },
  { method: "POST", pattern: /^\/api\/scanner\/stop\/?$/, handler: routes.scannerStop },
  { method: "POST", pattern: /^\/api\/scanner\/run-once\/?$/, handler: routes.scannerRunOnce },
  { method: "GET", pattern: /^\/api\/auth\/login-url\/?$/, handler: routes.loginUrl },
  { method: "GET", pattern: /^\/api\/auth\/login\/?$/, handler: routes.login },
  { method: "GET", pattern: /^\/api\/auth\/callback\/?$/, handler: routes.authCallback },
  { method: "POST", pattern: /^\/api\/auth\/logout\/?$/, handler: routes.logout },
  { method: "GET", pattern: /^\/api\/profile\/?$/, handler: routes.profile },
  { method: "GET", pattern: /^\/api\/margins\/?$/, handler: routes.margins },
  { method: "GET", pattern: /^\/api\/positions\/?$/, handler: routes.positions },
  { method: "POST", pattern: /^\/api\/positions\/convert\/?$/, handler: routes.convertPosition },
  { method: "GET", pattern: /^\/api\/holdings\/?$/, handler: routes.holdings },
  { method: "GET", pattern: /^\/api\/orders\/([^/]+)\/history\/?$/, handler: routes.orderHistory, keys: ["orderId"] },
  { method: "GET", pattern: /^\/api\/trades\/?$/, handler: routes.trades },
  { method: "GET", pattern: /^\/api\/orders\/([^/]+)\/trades\/?$/, handler: routes.orderTrades, keys: ["orderId"] },
  { method: "GET", pattern: /^\/api\/instruments\/?$/, handler: routes.instruments },
  { method: "GET", pattern: /^\/api\/quote\/?$/, handler: routes.quote },
  { method: "GET", pattern: /^\/api\/ohlc\/?$/, handler: routes.ohlc },
  { method: "GET", pattern: /^\/api\/ltp\/?$/, handler: routes.ltp },
  { method: "GET", pattern: /^\/api\/historyData\/?$/, handler: routes.historical },
  {
    method: "GET",
    pattern: /^\/api\/historyData\/intraday\/?$/,
    handler: (req, res, url) => routes.historical(req, res, url, { mode: "intraday", fallbackWindow: "default" }),
  },
  { method: "POST", pattern: /^\/api\/orders\/?$/, handler: routes.placeOrder },
  { method: "PUT", pattern: /^\/api\/orders\/([^/]+)\/?$/, handler: routes.modifyOrder, keys: ["orderId"] },
  { method: "DELETE", pattern: /^\/api\/orders\/([^/]+)\/?$/, handler: routes.cancelOrder, keys: ["orderId"] },
  { method: "GET", pattern: /^\/api\/gtts\/?$/, handler: routes.getGtts },
  { method: "GET", pattern: /^\/api\/gtts\/([^/]+)\/?$/, handler: routes.getGtt, keys: ["triggerId"] },
  { method: "POST", pattern: /^\/api\/gtts\/?$/, handler: routes.placeGtt },
  { method: "PUT", pattern: /^\/api\/gtts\/([^/]+)\/?$/, handler: routes.modifyGtt, keys: ["triggerId"] },
  { method: "DELETE", pattern: /^\/api\/gtts\/([^/]+)\/?$/, handler: routes.deleteGtt, keys: ["triggerId"] },
  { method: "POST", pattern: /^\/api\/order-margins\/?$/, handler: routes.orderMargins },
  { method: "POST", pattern: /^\/api\/basket-margins\/?$/, handler: routes.basketMargins },
  { method: "POST", pattern: /^\/api\/virtual-contract-note\/?$/, handler: routes.virtualContractNote },
];

function matchRoute(method, pathname) {
  for (const route of router) {
    if (route.method !== method) {
      continue;
    }

    const match = pathname.match(route.pattern);
    if (!match) {
      continue;
    }

    const params = {};
    if (route.keys) {
      route.keys.forEach((key, index) => {
        params[key] = match[index + 1];
      });
    }

    return { route, params };
  }

  return null;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendNoContent(res);
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const match = matchRoute(req.method, url.pathname);

  if (!match) {
    sendJson(res, 404, { error: "Route not found" });
    return;
  }

  try {
    await match.route.handler(req, res, url, match.params);
  } catch (error) {
    const normalised = normaliseKiteError(error);
    sendJson(res, normalised.statusCode, normalised.payload);
  }
});

ensureActiveSession()
  .catch((error) => {
    console.error("Failed to bootstrap Kite session:", error.message);
  })
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`Kite backend listening on http://localhost:${PORT}`);
    });
  });
