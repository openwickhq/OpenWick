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
const FILE = /^[sc]\/[A-Za-z0-9&_-]{1,40}\.(png|ico|jpg|webp|svg)$/;

let cache = { mtime: 0, js: "export default {s:{},c:{}};", index: null };
function index() {
  try {
    const m = fs.statSync(INDEX).mtimeMs;
    if (m !== cache.mtime) {
      const i = JSON.parse(fs.readFileSync(INDEX, "utf8"));
      cache = { mtime: m, index: i, js: `export default ${JSON.stringify({ s: i.s || {}, c: i.c || {}, w: i.w || [] })};` };
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
