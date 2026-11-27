#!/usr/bin/env node
// Downloads logos once into data/logos/ so pages show them without going online:
//   • coins (the top-500 list): CoinGecko's 64-pixel coin images
//   • NIFTY 500 companies: Financial Modeling Prep's public logo for SYMBOL.NS. When that's a wide
//     wordmark, a square icon from the company's own website (found through Wikidata, by NSE ticker
//     or company name) is used instead if there is one. Failing both: the company's logo from
//     Wikimedia Commons if roughly square, or a 32px+ site icon. Otherwise no logo, and the app keeps
//     its coloured letter badge.
// data/logos/index.json maps symbols to files. Symbols already done are skipped, so it can be
// stopped and re-run; --force starts over, --only=stocks or --only=crypto does one half.
// Each download is capped at 400 KB and must really be an image (checked by its first bytes).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPath } from "../lib/list-files.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.OW_DATA_DIR || path.join(root, "data");
const DIR = path.join(DATA, "logos");
const INDEX = path.join(DIR, "index.json");
const args = process.argv.slice(2);
const force = args.includes("--force");
const redoWide = args.includes("--redo-wide"); // look again for companies whose saved logo is a wide wordmark
const only = (args.find((a) => a.startsWith("--only=")) || "").slice(7);
// --country=US (GB, JP, DE, HK): just that country's list, into data/logos/g/<code>/ (lib/markets-data.js
// asks for this the first time a country is opened; deleting the folder forgets them).
const country = (args.find((a) => a.startsWith("--country=")) || "").slice(10).toUpperCase();
const limit = Number((args.find((a) => a.startsWith("--limit=")) || "").slice(8)) || Infinity; // for trying it out
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const MAX = 400e3;

fs.mkdirSync(path.join(DIR, "s"), { recursive: true });
fs.mkdirSync(path.join(DIR, "c"), { recursive: true });
let index = { s: {}, c: {}, g: {}, miss: {} };
try {
  if (!force) index = { s: {}, c: {}, g: {}, miss: {}, ...JSON.parse(fs.readFileSync(INDEX, "utf8")) };
} catch { /* first run */ }
index.g ||= {};
const saveIndex = () => {
  index.updated = new Date().toISOString();
  fs.writeFileSync(`${INDEX}.tmp`, JSON.stringify(index));
  fs.renameSync(`${INDEX}.tmp`, INDEX);
};
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- fetching ----------
async function get(url, { accept = "*/*", limit = MAX, timeout = 20000 } = {}) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept }, redirect: "follow", signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.length;
    if (size > limit) { reader.cancel().catch(() => {}); break; }
  }
  return { url: res.url, buf: Buffer.concat(parts), type: res.headers.get("content-type") || "" };
}
// Just the <head> of a homepage (where icons are declared), not the whole page.
async function head(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  let html = "", size = 0;
  const dec = new TextDecoder();
  while (size < 300e3) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    html += dec.decode(value, { stream: true });
    if (/<\/head>/i.test(html)) break;
  }
  reader.cancel().catch(() => {});
  return { url: res.url, html };
}

// ---------- what an image is, and how big ----------
function sniff(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { ext: "png", w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 6 && buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1) {
    // .ico: the largest picture in its directory (0 means 256)
    const n = buf.readUInt16LE(4);
    let w = 0, h = 0;
    for (let k = 0; k < n && 6 + 16 * k + 16 <= buf.length; k++) {
      const ww = buf[6 + 16 * k] || 256, hh = buf[7 + 16 * k] || 256;
      if (ww > w) { w = ww; h = hh; }
    }
    return w ? { ext: "ico", w, h } : null;
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xc3) return { ext: "jpg", h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8X") return { ext: "webp", w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (kind === "VP8 ") return { ext: "webp", w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L") { const b = buf.readUInt32LE(21); return { ext: "webp", w: 1 + (b & 0x3fff), h: 1 + ((b >> 14) & 0x3fff) }; }
  }
  const text = buf.toString("utf8", 0, Math.min(buf.length, 2000)).trim();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(text)) {
    const vb = /viewBox=["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
    return { ext: "svg", w: 512, h: vb ? (512 * Number(vb[2])) / Number(vb[1]) || 512 : 512, svg: true };
  }
  return null;
}
const squareish = (im) => im && im.w > 0 && im.h > 0 && im.w / im.h <= 1.5 && im.h / im.w <= 1.5;
const sizeOf = (im) => Math.min(im.w, im.h);

async function tryImage(url, { anyShape = false } = {}) {
  try {
    const r = await get(url, { accept: "image/*,*/*;q=0.5" });
    const im = sniff(r.buf);
    return im && (anyShape || squareish(im)) ? { ...im, buf: r.buf, from: url } : null;
  } catch {
    return null;
  }
}

// Icons a homepage declares, biggest first, plus the usual /apple-touch-icon.png.
function declaredIcons(html, base) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (/\brel=["']?([^"'>]+)/i.exec(tag)?.[1] || "").toLowerCase();
    if (!/icon/.test(rel) || /mask-icon/.test(rel)) continue;
    const href = /\bhref=["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!href || href.startsWith("data:")) continue;
    let url;
    try { url = new URL(href.replace(/&amp;/g, "&"), base).href; } catch { continue; }
    const sizes = /\bsizes=["']?([^"'>]+)/i.exec(tag)?.[1] || "";
    const declared = Math.max(0, ...sizes.split(/\s+/).map((s) => parseInt(s, 10) || 0));
    const svg = /\.svg(\?|$)/i.test(url) || /svg/i.test(/\btype=["']?([^"'>]+)/i.exec(tag)?.[1] || "");
    out.push({ url, score: svg ? 600 : /apple-touch/.test(rel) ? Math.max(declared, 180) : declared || 32 });
  }
  out.push({ url: new URL("/apple-touch-icon.png", base).href, score: 170 });
  const seen = new Set();
  return out.sort((a, b) => b.score - a.score).filter((x) => !seen.has(x.url) && seen.add(x.url));
}

// ---------- stocks ----------
// Company websites and logos from Wikidata: by NSE ticker, and by name for Indian companies.
const normName = (s) => String(s).toLowerCase().replace(/&/g, " and ").replace(/\b(limited|ltd|the|india|of|company|co|corporation|corp|inc)\b\.?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
// Rows as {name: {value}} objects. Asked for as tab-separated text and read line by line, because
// Wikidata sometimes cuts a slow reply short; the complete lines are still used.
async function sparql(q) {
  const r = await get(`https://query.wikidata.org/sparql?query=${encodeURIComponent(q)}`, { accept: "text/tab-separated-values", limit: 30e6, timeout: 120000 });
  const [top, ...lines] = r.buf.toString("utf8").split("\n");
  const names = top.split("\t").map((h) => h.trim().replace(/^\?/, ""));
  const plain = (v) => {
    v = v.trim();
    if (v.startsWith("<") && v.endsWith(">")) return v.slice(1, -1);
    const m = /^"((?:[^"\\]|\\.)*)"(?:@[\w-]+|\^\^<[^>]*>)?$/.exec(v);
    return m ? m[1].replace(/\\(.)/g, (_, c) => ({ n: "\n", t: "\t", r: "" })[c] ?? c) : v;
  };
  const rows = [];
  for (const line of lines) {
    const cells = line.split("\t");
    if (cells.length !== names.length) continue;
    const row = {};
    cells.forEach((c, i) => { if (c.trim()) row[names[i]] = { value: plain(c) }; });
    rows.push(row);
  }
  return rows;
}
async function websites(stocks) {
  const out = {};
  const add = (sym, b) => {
    const x = (out[sym] ||= { sites: [], logos: [] });
    if (b.website && !x.sites.includes(b.website.value)) x.sites.push(b.website.value);
    if (b.logo && !x.logos.includes(b.logo.value)) x.logos.push(b.logo.value);
  };
  try {
    for (const b of await sparql(`SELECT ?ticker ?website ?logo WHERE {
      ?ex rdfs:label "National Stock Exchange of India"@en .
      ?c p:P414 ?st . ?st ps:P414 ?ex ; pq:P249 ?ticker .
      OPTIONAL { ?c wdt:P856 ?website } OPTIONAL { ?c wdt:P154 ?logo } }`))
      add(b.ticker.value.trim().toUpperCase().replace(/^NSE:/, ""), b);
  } catch (e) {
    log("Wikidata (tickers):", e.message);
  }
  try {
    const byName = new Map(stocks.map((x) => [normName(x.n), x.s]));
    for (const b of await sparql(`SELECT ?label ?website ?logo WHERE {
      VALUES ?t { wd:Q4830453 wd:Q891723 wd:Q6881511 wd:Q783794 wd:Q167037 wd:Q22687 wd:Q1137109 wd:Q2085381 }
      ?c wdt:P31 ?t ; wdt:P17 wd:Q668 ; wdt:P856 ?website . OPTIONAL { ?c wdt:P154 ?logo }
      ?c rdfs:label ?label . FILTER(LANG(?label) = "en") }`)) {
      const sym = byName.get(normName(b.label.value));
      if (sym) add(sym, b);
    }
  } catch (e) {
    log("Wikidata (names):", e.message);
  }
  return out;
}

async function stockLogo(sym, info) {
  // A square logo from FMP is the best case; a wide one is kept for later.
  const fmp = await tryImage(`https://financialmodelingprep.com/image-stock/${encodeURIComponent(sym)}.NS.png`, { anyShape: true });
  if (fmp && squareish(fmp) && sizeOf(fmp) >= 48) return fmp;
  // Otherwise any square mark beats a wide wordmark, which is unreadable in a small round badge.
  const fromSite = await siteLogo(info);
  if (fromSite && sizeOf(fromSite) >= 48) return fromSite;
  for (const logo of (info?.logos || []).slice(0, 1)) {
    const url = logo.replace(/^http:/, "https:") + (logo.includes("?") ? "&" : "?") + "width=128";
    const im = await tryImage(url);
    if (im) return im;
  }
  if (fromSite && sizeOf(fromSite) >= 32) return fromSite;
  const site = info?.sites?.[0];
  if (site) {
    try {
      const im = await tryImage(`https://www.google.com/s2/favicons?domain=${new URL(site).hostname}&sz=128`);
      if (im && sizeOf(im) >= 32) return im;
    } catch { /* bad URL */ }
  }
  return fmp;
}
// The largest roughly square icon a company's homepage declares.
async function siteLogo(info) {
  let best = null;
  const keep = (im) => { if (im && (!best || sizeOf(im) > sizeOf(best))) best = im; };
  for (const site of (info?.sites || []).slice(0, 2)) {
    let h;
    try { h = await head(site); } catch { continue; }
    for (const c of declaredIcons(h.html, h.url).slice(0, 5)) {
      keep(await tryImage(c.url));
      if (best && (best.svg || sizeOf(best) >= 96)) return best;
    }
    if (best && sizeOf(best) >= 48) return best;
  }
  return best;
}

// ---------- coins ----------
async function coinImages(items) {
  const out = {};
  const ids = [...new Set(items.map((x) => x.cg).filter(Boolean))];
  for (let i = 0; i < ids.length; i += 250) {
    const r = await get(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&ids=${ids.slice(i, i + 250).join(",")}`, { accept: "application/json", limit: 10e6, timeout: 60000 });
    for (const c of JSON.parse(r.buf.toString("utf8"))) if (c.image) out[c.id] = c.image.replace("/large/", "/small/");
    await new Promise((r2) => setTimeout(r2, 3000)); // CoinGecko's free API is rate limited
  }
  return out;
}

// ---------- run ----------
async function pool(list, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) await fn(list[i++]); }));
}
const write = (kind, key, im) => {
  const file = `${kind}/${key.replace(/[^A-Za-z0-9&_-]/g, "_")}.${im.ext}`;
  fs.writeFileSync(path.join(DIR, file), im.buf);
  index[kind][key] = file;
};

if (country) {
  // Another country: Financial Modeling Prep's public logo for the Yahoo symbol (AAPL, SHEL.L, 7203.T).
  const code = country.replace(/[^A-Z]/g, "").slice(0, 2);
  const stocks = JSON.parse(fs.readFileSync(path.join(root, "lib", "universe", "markets", `${code.toLowerCase()}.json`), "utf8")).items;
  const sub = `g/${code.toLowerCase()}`;
  fs.mkdirSync(path.join(DIR, sub), { recursive: true });
  const have = (index.g[code] ||= {});
  const misses = (index.miss[`g:${code}`] ||= {});
  const retryAfter = Date.now() - 25 * 86400e3;
  const todo = stocks.filter((x) => !have[x.s] && !(misses[x.s] > retryAfter)).slice(0, limit);
  log(`${code}: ${stocks.length} companies, ${todo.length} logos to fetch`);
  let n = 0;
  await pool(todo, 6, async (x) => {
    const im = await tryImage(`https://financialmodelingprep.com/image-stock/${encodeURIComponent(x.s)}.png`, { anyShape: true }).catch(() => null);
    if (im) {
      const file = `${sub}/${x.s.replace(/[^A-Za-z0-9&_-]/g, "_")}.${im.ext}`;
      fs.writeFileSync(path.join(DIR, file), im.buf);
      have[x.s] = file;
      delete misses[x.s];
      n++;
    } else misses[x.s] = Date.now();
  });
  // Merged into the index as it is now on disk, in case the main logo download saved meanwhile.
  try { index = { s: {}, c: {}, g: {}, miss: {}, ...JSON.parse(fs.readFileSync(INDEX, "utf8")) }; } catch { /* first run */ }
  index.g = { ...(index.g || {}), [code]: have };
  index.miss = { ...(index.miss || {}), [`g:${code}`]: misses };
  index.w = (index.w || []).filter((f) => !f.startsWith(`${sub}/`));
  for (const f of Object.values(have)) {
    try { if (!squareish(sniff(fs.readFileSync(path.join(DIR, f))))) index.w.push(f); } catch { /* gone */ }
  }
  saveIndex();
  log(`Done: ${n} new ${code} logos (${Object.keys(have).length} in all)`);
  process.exit(0);
}
if (only !== "stocks") {
  const coins = JSON.parse(fs.readFileSync(listPath("crypto500.json"), "utf8")).items;
  const todo = coins.filter((x) => x.b && !index.c[x.b]).slice(0, limit);
  log(`Coins: ${coins.length}, ${todo.length} to fetch`);
  if (todo.length) {
    const imgs = await coinImages(todo).catch((e) => (log("CoinGecko:", e.message), {}));
    let n = 0;
    await pool(todo, 6, async (x) => {
      const url = imgs[x.cg];
      const im = url && (await tryImage(url));
      if (im) { write("c", x.b, im); n++; }
    });
    saveIndex();
    log(`Coins: ${n} logos saved`);
  }
}
if (only !== "crypto") {
  const stocks = JSON.parse(fs.readFileSync(listPath("nse500.json"), "utf8")).items;
  const retryAfter = Date.now() - 25 * 86400e3; // don't keep asking sites that had nothing
  if (redoWide) {
    for (const [sym, f] of Object.entries(index.s)) {
      try {
        if (!squareish(sniff(fs.readFileSync(path.join(DIR, f))))) delete index.s[sym];
      } catch { delete index.s[sym]; }
    }
  }
  const todo = stocks.filter((x) => !index.s[x.s] && !(index.miss[x.s] > retryAfter)).slice(0, limit);
  log(`Stocks: ${stocks.length}, ${todo.length} to fetch`);
  if (todo.length) {
    const info = await websites(stocks);
    log(`Wikidata: websites for ${Object.keys(info).length} of the NIFTY 500`);
    let n = 0, done = 0;
    await pool(todo, 6, async (x) => {
      const im = await stockLogo(x.s, info[x.s]).catch(() => null);
      if (im) { write("s", x.s, im); delete index.miss[x.s]; n++; }
      else index.miss[x.s] = Date.now();
      if (++done % 25 === 0) { saveIndex(); log(`Stocks: ${done}/${todo.length} checked, ${n} logos`); }
    });
    saveIndex();
    log(`Stocks: ${n} of ${todo.length} found`);
  }
}
saveIndex();
// Remove files no longer listed (a logo replaced by one of another type), and note which logos are
// wide wordmarks: the app shows the left end of those (usually the company's mark) instead.
index.w = (index.w || []).filter((f) => f.startsWith("g/"));
for (const kind of ["s", "c"]) {
  const used = new Set(Object.values(index[kind]));
  for (const f of fs.readdirSync(path.join(DIR, kind))) {
    if (!used.has(`${kind}/${f}`)) fs.rmSync(path.join(DIR, kind, f));
    else if (!squareish(sniff(fs.readFileSync(path.join(DIR, kind, f))))) index.w.push(`${kind}/${f}`);
  }
}
saveIndex();
log(`Done: ${Object.keys(index.s).length} company logos, ${Object.keys(index.c).length} coin logos in ${DIR}`);
