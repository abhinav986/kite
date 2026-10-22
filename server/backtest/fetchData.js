// Downloads 5-minute candles for every NSE F&O stock into server/backtest/data/<SYMBOL>.json.
// Uses the access token saved by the backend login flow (.kite-session.json), so log in via
// http://localhost:5000/api/auth/login first. Re-running skips symbols already downloaded.
//
//   node server/backtest/fetchData.js [--years 2] [--symbols RELIANCE,SBIN]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { KiteConnect } from "kiteconnect";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "server", "backtest", "data");
const CHUNK_DAYS = 90; // Kite allows max 100 days per 5minute request
const REQUEST_GAP_MS = 350; // historical API limit is 3 req/s

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx === -1 || line.trim().startsWith("#")) continue;
    const key = line.slice(0, idx).trim();
    if (!(key in process.env)) process.env[key] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
  }
}

function getArg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : fallback;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function createKiteClient() {
  loadEnv();
  const sessionPath = path.join(ROOT, ".kite-session.json");
  const session = fs.existsSync(sessionPath) ? JSON.parse(fs.readFileSync(sessionPath, "utf8")) : {};
  const accessToken = session.accessToken || process.env.KITE_ACCESS_TOKEN;
  const kite = new KiteConnect({ api_key: process.env.KITE_API_KEY });
  kite.setAccessToken(accessToken);
  try {
    await kite.getProfile();
  } catch (error) {
    throw new Error(
      `Kite session is not valid (${error.message}). Start the backend and log in at http://localhost:5000/api/auth/login first.`
    );
  }
  return kite;
}

export async function getFnoStocks(kite) {
  const [nfo, nse] = await Promise.all([kite.getInstruments("NFO"), kite.getInstruments("NSE")]);
  const fnoNames = new Set(nfo.filter((i) => i.instrument_type === "FUT").map((i) => i.name));
  return nse
    .filter((i) => i.segment === "NSE" && i.instrument_type === "EQ" && fnoNames.has(i.tradingsymbol))
    .map((i) => ({ symbol: i.tradingsymbol, token: i.instrument_token }));
}

async function fetchSymbol(kite, stock, from, to) {
  const rows = [];
  for (let start = new Date(from); start < to; ) {
    const end = new Date(Math.min(start.getTime() + CHUNK_DAYS * 86400000, to.getTime()));
    let candles;
    for (let attempt = 1; ; attempt += 1) {
      try {
        candles = await kite.getHistoricalData(stock.token, "5minute", start, end, false, false);
        break;
      } catch (error) {
        if (attempt >= 4) throw error;
        await sleep(2000 * attempt);
      }
    }
    for (const c of candles) {
      rows.push([new Date(c.date).getTime(), c.open, c.high, c.low, c.close, c.volume]);
    }
    start = new Date(end.getTime() + 60000);
    await sleep(REQUEST_GAP_MS);
  }
  return rows;
}

async function main() {
  const years = Number(getArg("years", 2));
  const only = getArg("symbols", "");
  const kite = await createKiteClient();
  let stocks = await getFnoStocks(kite);
  if (only) {
    const wanted = new Set(only.split(",").map((s) => s.trim().toUpperCase()));
    stocks = stocks.filter((s) => wanted.has(s.symbol));
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const to = new Date();
  const from = new Date(to.getTime() - years * 365 * 86400000);
  console.log(`Downloading ${stocks.length} F&O stocks, ${from.toDateString()} -> ${to.toDateString()}`);

  let done = 0;
  for (const stock of stocks) {
    done += 1;
    const file = path.join(DATA_DIR, `${stock.symbol}.json`);
    if (fs.existsSync(file)) continue;
    try {
      const rows = await fetchSymbol(kite, stock, from, to);
      fs.writeFileSync(file, JSON.stringify(rows));
      console.log(`[${done}/${stocks.length}] ${stock.symbol}: ${rows.length} candles`);
    } catch (error) {
      console.error(`[${done}/${stocks.length}] ${stock.symbol} failed: ${error.message}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
