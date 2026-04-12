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

const config = {
  apiKey: process.env.KITE_API_KEY,
  apiSecret: process.env.KITE_API_SECRET,
  accessToken: process.env.KITE_ACCESS_TOKEN,
  refreshToken: process.env.KITE_REFRESH_TOKEN,
  redirectUrl: process.env.KITE_REDIRECT_URL || "",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:8080",
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
};

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
//   const yesterday = new Date(now);
//   yesterday.setDate(now.getDate() - 1);
//   yesterday.setHours(23, 59, 59, 999); // optional: end of yesterday

//   return {
//     from: startOfToday,
//     to: yesterday,
//   };
// }
function resolveDateRange(searchParams, mode) {
  const now = new Date();
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (from && to) {
    return { from, to };
  }

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  return {
    from: startOfToday,
    to: now,
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
    const mode = params.mode || "day";
    const range = resolveDateRange(url.searchParams, mode);
    const interval = url.searchParams.get("interval") || (mode === "intraday" ? INTRADAY_INTERVAL : DAY_INTERVAL);
    const continuous = parseBoolean(url.searchParams.get("continuous"), false);
    const oi = parseBoolean(url.searchParams.get("oi"), false);

    const data = await withKiteAuth(() =>
      kite.getHistoricalData(
        instrumentToken,
        interval,
        range.from,
        range.to,
        continuous,
        oi
      )
    );

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
    handler: (req, res, url) => routes.historical(req, res, url, { mode: "intraday" }),
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
