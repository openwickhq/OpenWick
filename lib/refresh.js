// Weekly background refresh of company results, share counts and index sizes
// (the same as running `node scripts/update-lists.js --fundamentals` by hand).
// Checks a few minutes after start and then every 6 hours; runs when the saved figures are
// 7 days old or more, and loads the new ones without a restart.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listsUpdated, reloadLists } from "./universe.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(root, "scripts", "update-lists.js");
const MAX_AGE_DAYS = 7;

export const status = { running: false, lastRun: null, lastResult: null, lastError: null };

export const ageDays = () => {
  const d = Date.parse(listsUpdated().fundamentals || "");
  return Number.isFinite(d) ? (Date.now() - d) / 86400e3 : Infinity;
};

// India's figures now, if this copy has never had them (an India page was just opened).
export function ensure(log = () => {}) {
  if (process.env.OW_OFFLINE === "1" || process.env.OW_NO_AUTO_REFRESH === "1") return false;
  return ageDays() === Infinity ? refreshNow(log) : false;
}

export function refreshNow(log = () => {}) {
  if (status.running) return false;
  status.running = true;
  status.lastRun = new Date().toISOString();
  status.lastError = null;
  log("Refreshing company results in the background (update-lists.js --fundamentals)…");
  const child = spawn(process.execPath, [SCRIPT, "--fundamentals"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  const keep = (b) => (out = (out + b).slice(-4000));
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  child.on("close", (code) => {
    status.running = false;
    if (code === 0) {
      reloadLists();
      status.lastResult = "ok";
      log(`Company results refreshed (${listsUpdated().fundamentals}).`);
    } else {
      status.lastResult = "failed";
      status.lastError = out.trim().split("\n").slice(-3).join(" ") || `exit code ${code}`;
      log(`Company results refresh failed: ${status.lastError}`);
    }
  });
  child.on("error", (e) => {
    status.running = false;
    status.lastResult = "failed";
    status.lastError = e.message;
  });
  return true;
}

// India's figures, first fetched for a new install only when India is one of its markets
// (`india()`); otherwise the first time an India page is opened (ensure below).
export function startAutoRefresh(log, india = () => true) {
  if (process.env.OW_OFFLINE === "1" || process.env.OW_NO_AUTO_REFRESH === "1") return;
  const check = () => {
    if ((ageDays() !== Infinity || india()) && ageDays() >= MAX_AGE_DAYS) refreshNow(log);
  };
  // After the first charts and quotes have loaded. On a fresh install there are no company figures
  // yet (they aren't shipped: they're Yahoo's data), so fetch them sooner.
  setTimeout(check, ageDays() === Infinity ? 20e3 : 3 * 60e3).unref();
  setInterval(check, 6 * 3600e3).unref();
}
