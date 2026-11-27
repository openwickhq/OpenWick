// Company and coin logos saved by scripts/update-logos.js in data/logos/ (index.json maps symbols to
// files). Pages load /js/logo-index.js to know which logos exist, then ask for /logos/<file>.
// The download runs on its own in the background when there are no logos yet, and once a month.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "./store.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(DATA_DIR, "logos");
const INDEX = path.join(DIR, "index.json");
const TYPES = { png: "image/png", ico: "image/x-icon", jpg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml" };
const FILE = /^([sc]|g\/[a-z]{2})\/[A-Za-z0-9&_-]{1,40}\.(png|ico|jpg|webp|svg)$/;

let cache = { mtime: 0, js: "export default {s:{},c:{},g:{}};", index: null };
function index() {
  try {
    const m = fs.statSync(INDEX).mtimeMs;
    if (m !== cache.mtime) {
      const i = JSON.parse(fs.readFileSync(INDEX, "utf8"));
      cache = { mtime: m, index: i, js: `export default ${JSON.stringify({ s: i.s || {}, c: i.c || {}, g: i.g || {}, w: i.w || [] })};` };
    }
  } catch { /* no logos yet */ }
  return cache;
}
export const indexJs = () => index().js;

// A saved logo file, or null. Served so that an SVG can't run anything even if opened directly.
export function file(name) {
  if (!FILE.test(name)) return null;
  try {
    return {
      body: fs.readFileSync(path.join(DIR, name)),
      headers: {
        "Content-Type": TYPES[name.split(".").pop()],
        "Cache-Control": "public, max-age=604800",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    };
  } catch {
    return null;
  }
}

export const status = { running: false, lastRun: null, lastResult: null };
export function downloadNow(log = () => {}) {
  if (status.running) return false;
  status.running = true;
  status.lastRun = new Date().toISOString();
  log("Downloading company and coin logos in the background (update-logos.js)…");
  const child = spawn(process.execPath, [path.join(root, "scripts", "update-logos.js")], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  const keep = (b) => (out = (out + b).slice(-2000));
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  child.on("close", (code) => {
    status.running = false;
    status.lastResult = code === 0 ? "ok" : "failed";
    log(code === 0 ? `Logos: ${out.trim().split("\n").at(-1)?.replace(/^\S+\s/, "")}` : `Logo download failed: ${out.trim().split("\n").slice(-2).join(" ")}`);
  });
  child.on("error", () => { status.running = false; status.lastResult = "failed"; });
  return true;
}
export function startAutoDownload(log) {
  if (process.env.OW_OFFLINE === "1" || process.env.OW_NO_AUTO_REFRESH === "1") return;
  const check = () => {
    const updated = Date.parse(index().index?.updated || "");
    if (!Number.isFinite(updated) || Date.now() - updated > 30 * 86400e3) downloadNow(log);
  };
  setTimeout(check, 2 * 60e3).unref();
  setInterval(check, 24 * 3600e3).unref();
}

// Another country's logos (US, GB, JP, DE, HK), the first time it's opened and then monthly.
const countryRuns = new Map();
export function countryNow(code, log = () => {}) {
  if (process.env.OW_OFFLINE === "1" || process.env.OW_NO_AUTO_REFRESH === "1") return false;
  code = String(code).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  // Once a day at most: the script skips logos it already has, so a re-run only fills gaps.
  const last = countryRuns.get(code);
  if (last && (last.running || Date.now() - last.at < 86400e3)) return false;
  const run = { running: true, at: Date.now() };
  countryRuns.set(code, run);
  const child = spawn(process.execPath, [path.join(root, "scripts", "update-logos.js"), `--country=${code}`], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (b) => (out = (out + b).slice(-1000)));
  child.on("close", (c) => {
    run.running = false;
    if (c === 0) log(`Logos: ${out.trim().split("\n").at(-1)?.replace(/^\S+\s/, "")}`);
  });
  child.on("error", () => (run.running = false));
  return true;
}
// Deletes a country's logos (it hasn't been opened for 30 days).
export function forgetCountry(code) {
  code = String(code).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  const dir = path.join(DIR, "g", code.toLowerCase());
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
  try {
    const i = JSON.parse(fs.readFileSync(INDEX, "utf8"));
    if (i.g) delete i.g[code];
    if (i.miss) delete i.miss[`g:${code}`];
    i.w = (i.w || []).filter((f) => !f.startsWith(`g/${code.toLowerCase()}/`));
    fs.writeFileSync(`${INDEX}.tmp`, JSON.stringify(i));
    fs.renameSync(`${INDEX}.tmp`, INDEX);
  } catch { /* no index */ }
}
