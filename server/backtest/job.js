// Runs fetchData.js then run.js as child processes so the UI can trigger a backtest and poll progress.

import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const BACKTEST_DIR = path.join(process.cwd(), "server", "backtest");
const RESULTS_PATH = path.join(BACKTEST_DIR, "results.json");

const job = {
  running: false,
  stage: null,
  startedAt: null,
  finishedAt: null,
  error: null,
  log: [],
};

function appendLog(chunk) {
  for (const line of String(chunk).split(/\r?\n/)) {
    if (!line.trim()) continue;
    job.log.push(line);
  }
  if (job.log.length > 300) job.log.splice(0, job.log.length - 300);
}

function runScript(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(BACKTEST_DIR, script), ...args], { cwd: process.cwd() });
    child.stdout.on("data", appendLog);
    child.stderr.on("data", appendLog);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited with code ${code}`))));
  });
}

function readResults() {
  if (!fs.existsSync(RESULTS_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8"));
  } catch {
    return null;
  }
}

export function getBacktestStatus() {
  return { ...job, log: job.log.slice(-60), results: readResults() };
}

export function startBacktest({ years = 2, skipDownload = false } = {}) {
  if (job.running) return getBacktestStatus();

  Object.assign(job, { running: true, stage: "download", startedAt: new Date().toISOString(), finishedAt: null, error: null, log: [] });

  (async () => {
    if (!skipDownload) {
      appendLog("Downloading 5-minute candles from Kite (already-downloaded stocks are skipped)...");
      // the 100 most liquid F&O stocks, the same ones the signals scan
      await runScript("fetchData.js", ["--years", String(years), "--limit", "100"]);
    }
    job.stage = "backtest";
    appendLog("Running backtest...");
    await runScript("run.js");
  })()
    .catch((error) => {
      job.error = error.message;
      appendLog(`ERROR: ${error.message}`);
    })
    .finally(() => {
      job.running = false;
      job.stage = job.error ? "failed" : "done";
      job.finishedAt = new Date().toISOString();
    });

  return getBacktestStatus();
}
