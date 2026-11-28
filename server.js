#!/usr/bin/env node
// OpenWick server. Node 18+ and nothing else: no npm install, no build step.
//   node server.js            start on http://localhost:3777 (or the next free port)
//   node server.js --open     start and open your browser
//   PORT=4000 node server.js  pick a port

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as data from "./lib/providers.js";
import * as feeds from "./lib/feeds.js";
import * as imports from "./lib/imports.js";
import * as alerts from "./lib/alerts.js";
import * as screenAlerts from "./lib/screener-alerts.js";
import * as company from "./lib/company.js";
import { INDICES, listsUpdated } from "./lib/universe.js";
import { symbolIndex } from "./lib/symbol-index.js";
import * as refresh from "./lib/refresh.js";

// Yahoo's index codes (^NSEI, NIFTY_FIN_SERVICE.NS…) mapped to the names people know, for the pages.
// The other countries' indices (^GSPC -> S&P 500) are added too.
const INDEX_NAMES_JS = `export default ${JSON.stringify(Object.fromEntries([
  ...INDICES.items.map((x) => [x.y, x.n]),
  ...markets.CODES.flatMap((c) => markets.list(c).indices.filter((x) => x.y).map((x) => [x.y, x.n])),
]))};\n`;
import * as store from "./lib/store.js";
import * as info from "./lib/market-info.js";
import { registerIndicator, INDICATORS } from "./public/lib/indicators.js";
import { conditionFn, backtest, magnifierTf } from "./public/lib/backtest.js";
import { quantChecks } from "./public/lib/quant.js";
import { parseTf } from "./public/lib/series.js";
import { relaunchForProxy, proxyNote } from "./lib/proxy.js";
import { indiaEvents } from "./lib/india-calendar.js";
import { mergeCalendar, scheduledEvents } from "./lib/world-calendar.js";
import * as logos from "./lib/logos.js";
import * as notes from "./lib/notes.js";
import * as markets from "./lib/markets-data.js";
import { stockId, COUNTRIES } from "./public/lib/markets.js";

// Screener data by market (also what screener alerts check).
const SCREENS = {
  crypto: () => data.cryptoScreener(),
  nse: () => data.nseScreener(),
  indices: () => data.indicesScreener(),
  crypto500: () => data.cryptoTop500(),
  // Each country outside India: its main list (us, gb, jp, de, hk) and its indices (us-indices…).
  ...Object.fromEntries(markets.CODES.flatMap((c) => [
    [c.toLowerCase(), () => data.countryScreener(c)],
    [`${c.toLowerCase()}-indices`, () => data.countryIndices(c)],
  ])),
};

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
// Your own indicators. The desktop app points OW_CUSTOM_DIR at a folder it can write to.
const CUSTOM = process.env.OW_CUSTOM_DIR || path.join(ROOT, "custom");
const VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
).version;
const HOST = process.env.HOST || "127.0.0.1";
const START_PORT = Number(process.env.PORT) || 3777;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

// ---------- helpers ----------
const httpError = (status, message) => Object.assign(new Error(message), { status });

function send(res, status, body, headers = {}) {
  const isStr = typeof body === "string" || Buffer.isBuffer(body);
  res.writeHead(status, {
    "Content-Type": isStr ? "text/plain; charset=utf-8" : "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(isStr ? body : JSON.stringify(body));
}

async function readBody(req, limit = 2e6) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit)
      throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw httpError(400, "The request body isn't valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw httpError(400, "The request body must be a JSON object");
  return body;
}

// A raw text body (CSV imports), up to `limit` bytes.
async function readText(req, limit = 300e6) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw httpError(413, `The file is over ${Math.round(limit / 1e6)} MB`);
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// The server only answers to this machine's browser. Writes need a custom header, which a random
// website can't add to a cross-site request, so other pages can't drive your terminal.
function allowed(req) {
  const host = (req.headers.host || "")
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "");
  const okHosts = new Set(["localhost", "127.0.0.1", "::1", ...lanAddresses()]);
  if (!okHosts.has(host)) return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    if (req.headers["x-ow"] !== "1") return false;
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) return false;
      } catch {
        return false; // "null" and other opaque origins
      }
    }
  }
  return true;
}

function lanAddresses() {
  if (HOST === "127.0.0.1" || HOST === "localhost") return [];
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(Boolean)
    .map((i) => i.address);
}

function serveStatic(res, baseDir, rel) {
  const file = path.normalize(path.join(baseDir, rel));
  if (!file.startsWith(baseDir + path.sep)) return send(res, 403, "Forbidden");
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "Not found");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": rel.startsWith("vendor/")
        ? "public, max-age=86400"
        : "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- custom indicators (your own "Pine scripts", as plain JS files in /custom) ----------
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "indicator";
const customErrors = {};

function listCustom() {
  fs.mkdirSync(CUSTOM, { recursive: true });
  return fs
    .readdirSync(CUSTOM)
    .filter((f) => f.endsWith(".js"))
    .map((f) => ({
      file: f,
      id: `custom:${f.replace(/\.js$/, "")}`,
      mtime: fs.statSync(path.join(CUSTOM, f)).mtimeMs,
      error: customErrors[f] || null,
    }));
}

async function loadCustom(file) {
  try {
    const full = path.join(CUSTOM, file);
    const mod = await import(
      `${pathToFileURL(full).href}?v=${fs.statSync(full).mtimeMs}`
    );
    registerIndicator({
      ...mod.default,
      id: `custom:${file.replace(/\.js$/, "")}`,
    });
    delete customErrors[file];
  } catch (e) {
    customErrors[file] = e.message;
  }
}

// ---------- server-sent events (alerts pop up in the browser) ----------
const clients = new Set();
function broadcast(type, payload) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(msg);
}
alerts.onFire((e) => broadcast("alert", e));
setInterval(() => {
  for (const res of clients) res.write(": keep-alive\n\n");
}, 25000).unref();

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

// ---------- routes ----------
async function handle(req, res) {
  if (!allowed(req))
    return send(
      res,
      403,
      "Forbidden: OpenWick only answers to this computer.",
    );
  const url = new URL(req.url, "http://localhost");
  let p;
  try {
    p = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, "Bad URL");
  }
  const q = Object.fromEntries(url.searchParams);

  if (!p.startsWith("/api/")) {
    // Home page at /, the charting app at /chart.
    if (p === "/" || p === "/home") return serveStatic(res, PUBLIC, "home.html");
    // Stock and index pages: /symbol/RELIANCE, /symbol/NIFTY-50.
    if (p.startsWith("/symbol/") || p === "/symbol") return serveStatic(res, PUBLIC, "symbol.html");
    if (p === "/js/index-names.js") return send(res, 200, INDEX_NAMES_JS, { "Content-Type": "text/javascript; charset=utf-8" });
    // Logos saved on this computer (see lib/logos.js).
    if (p === "/js/symbol-index.js") return send(res, 200, symbolIndex(), { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    if (p === "/js/logo-index.js") return send(res, 200, logos.indexJs(), { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    if (p.startsWith("/logos/")) {
      const f = logos.file(decodeURIComponent(p.slice(7)));
      if (!f) return send(res, 404, "No logo");
      res.writeHead(200, f.headers);
      return res.end(f.body);
    }
    if (p === "/portfolio") return serveStatic(res, PUBLIC, "portfolio.html");
    if (p === "/screener" || p === "/heatmap" || p === "/news" || p === "/movers" || p === "/breadth")
      return serveStatic(res, PUBLIC, `${p.slice(1)}.html`);
    if (p === "/markets") return serveStatic(res, PUBLIC, "movers.html");
    if (p === "/notes") return serveStatic(res, PUBLIC, "notes.html");
    if (p === "/chart" || p === "/chart/" || p === "/index.html")
      return serveStatic(res, PUBLIC, "index.html");
    if (p.startsWith("/custom/")) return serveStatic(res, CUSTOM, p.slice(8));
    return serveStatic(res, PUBLIC, p.slice(1));
  }

  try {
    if (p === "/api/health") {
      return send(res, 200, {
        ok: true,
        app: "openwick",
        root: ROOT,
        data: store.DATA_DIR,
        version: VERSION,
        node: process.version,
        platform: process.platform,
        providers: data.health,
        feeds: feeds.configured(),
        yahoo: data.yahooAvailable() ? "available" : "rate limited",
        alerts: alerts.list().filter((a) => a.active).length,
      });
    }
    if (p === "/api/probe") return send(res, 200, await data.probeAll());
    if (p === "/api/resolve") {
      return send(res, 200, await data.resolve(q.symbol));
    }
    if (p === "/api/search") return send(res, 200, await data.search(q.q));
    if (p === "/api/spread") return send(res, 200, await data.getSpread(q.symbol));
    if (p === "/api/candles")
      return send(
        res,
        200,
        await data.getCandles(q.symbol, q.tf || "1D", q.limit),
      );
    // The indices whose member stocks we know (for breadth and movers within an index).
    // ?country=US (GB, JP, DE, HK) for another country's; India's otherwise.
    if (p === "/api/index-members") {
      const c = String(q.country || "IN").toUpperCase();
      if (markets.isCountry(c)) {
        markets.touch(c);
        const l = markets.list(c);
        const out = l.indices.filter((x) => x.mem?.length).map((x) => ({ symbol: markets.indexId(x), name: x.n, members: x.mem.map((s) => stockId(c, s)) }));
        // The whole main list first when it's more than one index (S&P 500 + Nasdaq-100, FTSE 350, DAX + MDAX).
        if (!out.some((x) => x.members.length >= l.items.length)) out.unshift({ symbol: "", name: l.list, members: l.items.map((x) => stockId(c, x.s)), all: true });
        return send(res, 200, out);
      }
      return send(res, 200, INDICES.items.filter((x) => x.mem?.length).map((x) => ({ symbol: `YAHOO:${x.y}`, name: x.n, members: x.mem })));
    }
    // The countries outside India: when each was last opened, and its company figures' state.
    if (p === "/api/markets") return send(res, 200, markets.info());
    if (p === "/api/quotes")
      return send(
        res,
        200,
        await data.getQuotes(
          (q.symbols || "").split(",").filter(Boolean).slice(0, 600),
        ),
      );
    // India's events are worked out locally; ?region=world is the whole week's world feed.
    // ?country=US (GB, JP, DE, HK): that country's rows from the world feed (this week only), plus
    // its central-bank decisions and expiries worked out locally (lib/world-calendar.js), so it
    // isn't empty at a weekend or when the feed is down.
    const CAL_CUR = { US: ["USD"], GB: ["GBP"], JP: ["JPY"], DE: ["EUR"], HK: ["CNY", "HKD"] };
    if (p === "/api/calendar") {
      const c = String(q.country || "").toUpperCase();
      if (CAL_CUR[c]) {
        const feed = await data.economicCalendar(CAL_CUR[c]).catch(() => []);
        return send(res, 200, feed.length ? mergeCalendar(c, feed) : scheduledEvents(c));
      }
      return send(res, 200, q.region === "world" ? await data.economicCalendar() : indiaEvents());
    }
    if (p === "/api/news") return send(res, 200, await info.news(q.symbol));
    if (p === "/api/financials") return send(res, 200, await info.financials(q.symbol, q.frequency));
    // Portfolio page: your holdings (imported from a Zerodha CSV/XLSX in the browser) stay in data/portfolio.json.
    if (p === "/api/portfolio") {
      if (req.method === "GET") return send(res, 200, store.read("portfolio", { holdings: [], source: null }));
      if (req.method === "PUT") {
        const b = await readBody(req, 5e6);
        if (!Array.isArray(b.holdings)) throw httpError(400, "Send { holdings: [...] }");
        const holdings = b.holdings.slice(0, 2000).map((h) => ({
          symbol: String(h.symbol || "").toUpperCase().slice(0, 40),
          qty: Number(h.qty) || 0,
          avg: Number(h.avg) || 0,
          ...(h.sector ? { sector: String(h.sector).slice(0, 80) } : {}),
        })).filter((h) => h.symbol && h.qty);
        const out = { holdings, source: b.source ? String(b.source).slice(0, 200) : null, realised: Number(b.realised) || 0, updated: new Date().toISOString() };
        store.write("portfolio", out);
        return send(res, 200, out);
      }
    }
    // Notes from the chart page's Notes panel (data/notes.json).
    if (p === "/api/notes") return send(res, 200, { notes: notes.all() });
    if (p.startsWith("/api/notes/")) {
      const id = decodeURIComponent(p.slice(11));
      if (req.method === "PUT") return send(res, 200, notes.save({ ...(await readBody(req, 1e6)), id }));
      if (req.method === "DELETE") return send(res, 200, { removed: notes.remove(id) });
    }
    if (p === "/api/portfolio/info") return send(res, 200, company.describe(String(q.symbols || "").split(",").filter(Boolean).slice(0, 2000)));
    // How fresh the saved company figures are, and a "refresh now" for the screener page.
    if (p === "/api/data-status") return send(res, 200, { ...listsUpdated(), ageDays: refresh.ageDays(), ...refresh.status });
    if (p === "/api/data-refresh" && req.method === "POST")
      return send(res, 200, { started: refresh.refreshNow((m) => console.log(m)), ...refresh.status });
    if (p === "/api/company" || p === "/api/company/live") {
      const out = p === "/api/company" ? company.page(q.id) : await company.live(q.id);
      if (!out) throw httpError(404, `No stock or index called ${String(q.id || "").slice(0, 40)} on OpenWick's lists`);
      return send(res, 200, out);
    }
    if (p === "/api/screener") {
      const u = q.universe || "crypto";
      if (!SCREENS[u]) throw httpError(400, `Pick one of ${Object.keys(SCREENS).join(", ")}`);
      const rows = await SCREENS[u]();
      return send(res, 200, rows);
    }
    if (p === "/api/scan" && req.method === "POST") {
      const body = await readBody(req);
      if (!Array.isArray(body.symbols) || !Array.isArray(body.rules ?? []))
        throw httpError(400, "Send { symbols: [...], rules: [...] }");
      const symbols = body.symbols.slice(0, 150);
      const rules = body.rules || [];
      const results = await mapLimit(symbols, 4, async (symbol) => {
        try {
          const { candles } = await data.getCandles(
            symbol,
            body.tf || "1D",
            400,
          );
          const make = conditionFn(candles, body.indicators || {});
          const i = candles.length - 1;
          const passes = rules.map((r) => make(r)(i));
          return {
            symbol,
            pass: passes.every(Boolean),
            passes,
            close: candles[i].close,
          };
        } catch (e) {
          return { symbol, error: e.message };
        }
      });
      return send(res, 200, results);
    }
    // The strategy tester on the server, for your own code (docs/api.md). Same rule format as the tester.
    if (p === "/api/backtest" && req.method === "POST") {
      const body = await readBody(req);
      const strategy = body.strategy;
      if (!body.symbol || !strategy || typeof strategy !== "object" || Array.isArray(strategy))
        throw httpError(400, "Send { symbol, tf, strategy: { indicators, entryLong, exitLong, ... } }");
      const tf = body.tf || "1D";
      const { symbol, provider, candles } = await data.getCandles(body.symbol, tf, body.limit || 1500);
      if (candles.length < 2) throw httpError(422, "Not enough bars to test on");
      let subBars = null;
      if (strategy.intrabar === "magnifier") {
        const sec = parseTf(tf).seconds;
        const span = candles.at(-1).time - candles[0].time + sec;
        const m = magnifierTf(sec, span);
        if (m) {
          const r = await data.getCandles(symbol, m.tf, Math.ceil(span / m.seconds) + 10);
          subBars = r.candles.filter((c) => c.time >= candles[0].time && c.time < candles.at(-1).time + sec);
        }
      }
      let r, q;
      try {
        r = backtest(candles, strategy, { subBars });
        if (body.quantChecks) q = quantChecks(candles, strategy, { subBars });
      } catch (e) {
        throw httpError(400, e.message);
      }
      return send(res, 200, {
        symbol,
        tf,
        provider,
        bars: candles.length,
        from: candles[0].time,
        to: candles.at(-1).time,
        stats: r.stats,
        trades: r.trades,
        ...(body.equity ? { equity: r.equity } : {}),
        ...(q
          ? {
              quantChecks: {
                passed: q.passed,
                total: q.gates.length,
                gates: q.gates.map(({ label, value, pass }) => ({ label, value, pass })),
                walkForward: q.walkForward,
                monteCarlo: q.monteCarlo,
              },
            }
          : {}),
      });
    }
    // Your own data files (lib/imports.js): bars chart as CSV:<NAME>; a signal becomes an indicator.
    if (p === "/api/imports") return send(res, 200, imports.listImports());
    if (p === "/api/import/bars" && req.method === "POST")
      return send(res, 200, imports.importBars(q.name, await readText(req)));
    if (p === "/api/import/signal" && req.method === "POST") {
      const name = imports.cleanName(q.name);
      const sig = imports.parseSignals(await readText(req, 100e6));
      const file = `signal-${name.toLowerCase()}.js`;
      const full = path.join(CUSTOM, file);
      fs.mkdirSync(CUSTOM, { recursive: true });
      const before = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
      fs.writeFileSync(full, imports.signalIndicatorSource(name, sig, q.name));
      await loadCustom(file);
      const error = customErrors[file];
      if (error) {
        if (before == null) fs.rmSync(full, { force: true });
        else fs.writeFileSync(full, before);
        delete customErrors[file];
        throw httpError(400, error);
      }
      const id = `custom:${file.replace(/\.js$/, "")}`;
      return send(res, 200, { ok: true, name, id, file, rows: sig.rows, changes: sig.changes.length, from: sig.from, to: sig.to, strategy: imports.signalStrategy(id) });
    }
    if (p === "/api/indicators")
      return send(
        res,
        200,
        INDICATORS.map((d) => ({
          id: d.id,
          name: d.name,
          inputs: (d.inputs || []).map(({ key, type, default: def, options }) => ({ key, type, default: def, ...(options ? { options } : {}) })),
          outputs: (d.outputs || []).map((o) => o.key),
        })),
      );
    // The first-run setup: the markets ticked and the home market. `needed` is true only on a new
    // install (no setup saved and no watchlists yet), so people who already use OpenWick never see it.
    if (p === "/api/setup") {
      const saved = store.read("setup", null);
      if (req.method === "GET") {
        const st = store.read("state", null);
        return send(res, 200, { ...(saved || {}), needed: !saved && !st?.watchlists });
      }
      if (req.method === "POST") {
        const b = await readBody(req);
        const codes = COUNTRIES.filter((c) => c.ex).map((c) => c.code);
        const next = { ...(saved || {}) };
        if (codes.includes(b.home)) next.home = b.home;
        if (Array.isArray(b.countries)) next.countries = b.countries.filter((c) => codes.includes(c));
        if (typeof b.crypto === "boolean") next.crypto = b.crypto;
        next.updated = new Date().toISOString();
        store.write("setup", next);
        return send(res, 200, { ok: true });
      }
    }
    if (p === "/api/state") {
      if (req.method === "GET") return send(res, 200, store.read("state", {}));
      if (req.method === "PUT") {
        const patch = await readBody(req, 20e6);
        const before = store.read("state", {});
        const next = { ...before, ...patch };
        store.write("state", next);
        // Other open tabs reload their watchlists when one tab changes them.
        if (patch.watchlists && JSON.stringify(patch.watchlists) !== JSON.stringify(before.watchlists))
          broadcast("watchlists", { from: req.headers["x-tab"] || "" });
        return send(res, 200, { ok: true });
      }
    }
    // One change to one watchlist, from any page (stock pages, screener, heatmap): add, remove, new list.
    if (p === "/api/watchlist" && req.method === "POST") {
      const b = await readBody(req);
      const st = store.read("state", {});
      const lists = st.watchlists || (st.watchlists = { Main: [] });
      const name = String(b.list || st.activeWatchlist || "Main").trim().slice(0, 60);
      const sym = b.symbol == null ? null : String(b.symbol).slice(0, 80);
      if (!name) throw httpError(400, "Give the list a name");
      if (b.action === "create") {
        if (lists[name]) throw httpError(409, `There's already a list called ${name}`);
        lists[name] = sym ? [sym] : [];
      } else if (b.action === "add" || b.action === "remove") {
        if (!sym) throw httpError(400, "Which symbol?");
        if (!lists[name]) throw httpError(404, `No list called ${name}`);
        lists[name] = lists[name].filter((x) => x !== sym);
        if (b.action === "add") lists[name].push(sym);
      } else throw httpError(400, "Use add, remove or create");
      store.write("state", st);
      broadcast("watchlists", {});
      return send(res, 200, { watchlists: lists, activeWatchlist: st.activeWatchlist });
    }
    if (p === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("retry: 3000\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (p === "/api/alerts") {
      if (req.method === "GET") return send(res, 200, alerts.list());
      if (req.method === "POST")
        return send(res, 200, alerts.add(await readBody(req)));
    }
    if (p === "/api/alerts/log") return send(res, 200, alerts.history());
    // Screener alerts: a saved screen that alerts when a stock newly matches it.
    if (p === "/api/screen-alerts") {
      if (req.method === "GET") return send(res, 200, screenAlerts.list());
      if (req.method === "POST") return send(res, 200, screenAlerts.add(await readBody(req)));
    }
    if (p.startsWith("/api/screen-alerts/")) {
      const id = p.split("/")[3];
      if (req.method === "DELETE") {
        screenAlerts.remove(id);
        return send(res, 200, { ok: true });
      }
      if (req.method === "PATCH") {
        screenAlerts.setActive(id, (await readBody(req)).active);
        return send(res, 200, { ok: true });
      }
    }
    if (p === "/api/alerts/check" && req.method === "POST") {
      await alerts.evaluate();
      return send(res, 200, { ok: true });
    }
    if (p.startsWith("/api/alerts/")) {
      const id = p.split("/")[3];
      if (req.method === "DELETE") {
        alerts.remove(id);
        return send(res, 200, { ok: true });
      }
      if (req.method === "PATCH")
        return send(res, 200, alerts.update(id, await readBody(req)));
    }
    if (p === "/api/webhook-test" && req.method === "POST") {
      const { url: hook } = await readBody(req);
      if (!/^https?:\/\/[^\s]+$/i.test(String(hook || "")))
        throw httpError(400, "Webhook must be an http(s) URL");
      const r = await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "OpenWick test alert",
          content: "OpenWick test alert",
        }),
        signal: AbortSignal.timeout(10000),
      });
      return send(res, 200, { ok: r.ok, status: r.status });
    }
    if (p === "/api/custom") {
      if (req.method === "GET") return send(res, 200, listCustom());
      if (req.method === "POST") {
        let { name, code } = await readBody(req);
        code = String(code || "");
        // Agents often write CommonJS; it means the same thing, so take it.
        if (!/export\s+default/.test(code) && /module\.exports\s*=/.test(code))
          code = code.replace(/module\.exports\s*=/, "export default");
        if (!/export\s+default/.test(code))
          throw httpError(
            400,
            /\/\/\s*@version|^\s*(indicator|study|strategy)\s*\(/m.test(code)
              ? "This is Pine Script. OpenWick indicators are JavaScript, so it can't run as is. Ask your Claude or Codex: \"turn this Pine Script into an OpenWick custom indicator\" and paste the code it writes here, or let it save the file for you."
              : "The file must `export default { name, calc(bars, params, ta) { ... } }`. Start from the template (New indicator), or ask your Claude or Codex to write it in the format in docs/custom-indicators.md.",
          );
        const file = `${slug(name)}.js`;
        const full = path.join(CUSTOM, file);
        fs.mkdirSync(CUSTOM, { recursive: true });
        const before = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
        fs.writeFileSync(full, code);
        await loadCustom(file);
        const error = customErrors[file];
        if (error) {
          // Refused: put back what was there (or nothing), so a broken save never replaces a working file.
          // The refused code never registered, so the working version is still the one loaded.
          if (before == null) fs.rmSync(full, { force: true });
          else fs.writeFileSync(full, before);
          delete customErrors[file];
          return send(res, 400, { error, file });
        }
        return send(res, 200, { ok: true, file, id: `custom:${file.replace(/\.js$/, "")}` });
      }
    }
    if (p.startsWith("/api/custom/") && req.method === "DELETE") {
      const file = path.basename(p.slice(12));
      fs.rmSync(path.join(CUSTOM, file), { force: true });
      return send(res, 200, { ok: true });
    }
    if (p === "/api/shutdown" && req.method === "POST") {
      // Lets the installer stop a running copy before updating it, on any OS.
      send(res, 200, { ok: true });
      setTimeout(() => process.exit(0), 100);
      return;
    }
    return send(res, 404, { error: "Unknown endpoint" });
  } catch (e) {
    // Upstream failures are a bad gateway, whatever status the provider used.
    const code = e.upstream ? 502 : e.status >= 400 && e.status < 600 ? e.status : 500;
    return send(res, code, { error: e.message });
  }
}

// ---------- start ----------
function openBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", '""', url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* no desktop: the URL is printed anyway */
  }
}

export function start(port = START_PORT, tries = 20) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handle(req, res).catch((e) => {
        if (!res.headersSent) send(res, 500, { error: e.message });
      });
    });
    server.once("error", (e) => {
      if (e.code === "EADDRINUSE" && tries > 0)
        resolve(start(port + 1, tries - 1));
      else reject(e);
    });
    server.listen(port, HOST, () => resolve({ server, port }));
  });
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const relaunched = isMain ? relaunchForProxy() : null;
if (relaunched) process.exit(await relaunched);
if (isMain) {
  for (const c of listCustom()) await loadCustom(c.file);
  const { port } = await start();
  const url = `http://localhost:${port}`;
  alerts.start();
  if (!process.env.OW_OFFLINE) screenAlerts.start((u) => SCREENS[u]());
  refresh.startAutoRefresh((m) => console.log(`  ${m}`));
  logos.startAutoDownload((m) => console.log(`  ${m}`));
  markets.setHooks({
    fx: async (pairs) => Object.fromEntries(Object.entries(await data.yahooSpark(pairs)).map(([k, v]) => [k, v.price])),
    logos: (c) => logos.countryNow(c, (m) => console.log(`  ${m}`)),
    forgetLogos: (c) => logos.forgetCountry(c),
  });
  markets.startUpkeep((m) => console.log(`  ${m}`));
  console.log(
    `\n  OpenWick ${VERSION} is running\n\n  Open:  ${url}\n  Stop:  Ctrl+C\n  Data:  ${store.DATA_DIR}\n`,
  );
  if (proxyNote()) console.log(`  ${proxyNote()}\n`);
  if (HOST !== "127.0.0.1" && HOST !== "localhost")
    console.log(
      `  Also on your network: ${lanAddresses()
        .filter((a) => a.includes(".") && a !== "127.0.0.1")
        .map((a) => `http://${a}:${port}`)
        .join("  ")}\n`,
    );
  if (process.argv.includes("--open") || process.env.OW_OPEN === "1")
    openBrowser(url);
  const bye = () => {
    console.log("\n  Stopped.");
    process.exit(0);
  };
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);
}
