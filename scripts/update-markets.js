// Builds the stock lists for the countries outside India (lib/universe/markets/<code>.json):
// each country's main stocks with English name, sector, industry and share count, and its indices
// with their member lists. Run by hand when index members change (a few times a year):
//
//   node scripts/update-markets.js            every country
//   node scripts/update-markets.js us gb      just these
//
// Sources: index member tables on Wikipedia (and Nasdaq's own Nasdaq-100 list), then Yahoo's
// search for names and sectors and its fundamentals series for share counts. Company figures and
// logos are not built here: each copy of the app downloads those for a country when it is first
// opened (lib/markets-data.js).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "lib", "universe", "markets");
const WIKI_UA = "OpenWick-list-builder/0.3 (open-source charting app; https://github.com/openwickhq/OpenWick)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { ua = "Mozilla/5.0", json = true, tries = 3 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": ua, Accept: "*/*" }, signal: AbortSignal.timeout(30000) });
      if (r.status === 429) { await sleep(4000 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return json ? await r.json() : await r.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500);
    }
  }
}

// ---------- Wikipedia ----------
const wikiHtml = async (page) =>
  (await get(`https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=text&page=${encodeURIComponent(page)}`, { ua: WIKI_UA })).parse.text["*"];
const text = (h) => h.replace(/<(style|sup)\b[\s\S]*?<\/\1>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#160;|&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
// Every "wikitable" on a page as rows of cell texts; nested tables are kept apart.
function wikiTables(html) {
  const out = [], stack = [];
  const re = /<(\/?)(table|tr|td|th)\b([^>]*)>/g;
  let m, last = 0;
  while ((m = re.exec(html))) {
    const top = stack.at(-1);
    if (top?.cell != null) top.cell += html.slice(last, m.index);
    last = re.lastIndex;
    const [, close, tag, attrs] = m;
    if (tag === "table" && !close) { const t = { cls: /class="([^"]*)"/.exec(attrs)?.[1] || "", rows: [], cell: null }; stack.push(t); out.push(t); }
    else if (tag === "table") stack.pop();
    else if (!top) continue;
    else if (tag === "tr" && !close) top.rows.push([]);
    else if ((tag === "td" || tag === "th") && !close) top.cell = "";
    else if ((tag === "td" || tag === "th") && close && top.cell != null) { top.rows.at(-1)?.push(text(top.cell)); top.cell = null; }
  }
  return out.filter((t) => t.cls.includes("wikitable")).map((t) => t.rows);
}
// The table whose header row has all these column names (case-insensitive, by prefix).
function tableWith(tables, cols) {
  for (const rows of tables) {
    const head = (rows[0] || []).map((h) => h.toLowerCase());
    const idx = cols.map((c) => head.findIndex((h) => h.startsWith(c.toLowerCase())));
    if (idx.every((i) => i >= 0)) return rows.slice(1).filter((r) => r.length >= head.length - 1).map((r) => idx.map((i) => r[i] || ""));
  }
  throw new Error(`no table with ${cols.join(", ")}`);
}

// ---------- Yahoo ----------
// English name, sector and industry for a Yahoo symbol, from its search (no sign-in needed).
async function yahooInfo(symbol) {
  const j = await get(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=5&newsCount=0`);
  const q = (j.quotes || []).find((x) => x.symbol === symbol);
  return q ? { n: q.longname || q.shortname, i: q.sectorDisp || q.sector, ind: q.industryDisp || q.industry } : null;
}
// A company by name on one exchange (for lists that give names only, like the MDAX).
async function yahooFind(name, suffix) {
  const j = await get(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=8&newsCount=0`);
  const q = (j.quotes || []).find((x) => x.quoteType === "EQUITY" && x.symbol?.endsWith(suffix));
  return q?.symbol || null;
}
async function yahooShares(symbol) {
  const now = Math.floor(Date.now() / 1000);
  const j = await get(`https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}?type=quarterlyOrdinarySharesNumber,annualOrdinarySharesNumber&period1=${now - 4 * 365 * 86400}&period2=${now}`);
  let best = null;
  for (const r of j?.timeseries?.result || []) for (const v of r[r.meta?.type?.[0]] || []) if (v?.reportedValue?.raw > 0 && (!best || v.asOfDate > best.asOfDate)) best = v;
  return best ? Math.round(best.reportedValue.raw) : null;
}
const YAHOO_SECTORS = new Set(["Technology", "Financial Services", "Healthcare", "Consumer Cyclical", "Consumer Defensive", "Industrials",
  "Communication Services", "Basic Materials", "Energy", "Utilities", "Real Estate"]);
const SECTOR_FIX = { "Pharmaceuticals and Biotechnology": "Healthcare", "Health Care Equipment & Services": "Healthcare" };
async function mapLimit(items, n, fn) {
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      await fn(items[k], k);
      if (++done % 100 === 0) console.log(`    ${done} of ${items.length}`);
    }
  }));
}
// Fills in name, sector, industry and shares for every stock; keeps a stock even when Yahoo has
// nothing (its list name and sector stay).
async function enrich(items) {
  await mapLimit(items, 4, async (x) => {
    try {
      const info = await yahooInfo(x.s);
      if (info?.n) x.n = info.n;
      if (info?.i) x.i = info.i;
      if (info?.ind) x.ind = info.ind;
    } catch { /* keep the list's own name */ }
    try { x.sh = await yahooShares(x.s); } catch { /* no market cap for this one */ }
    if (!x.sh) delete x.sh;
    // One set of sector names for every country (Yahoo's); list-only names are mapped onto it.
    x.i = SECTOR_FIX[x.i] || (YAHOO_SECTORS.has(x.i) ? x.i : "Other");
  });
  return items;
}

// ---------- the countries ----------
const COUNTRY = {
  async US() {
    const sp = tableWith(wikiTables(await wikiHtml("List of S&P 500 companies")), ["Symbol", "Security", "GICS Sector"])
      .map(([s, n, i]) => ({ s: s.replace(/\./g, "-"), n, i }));
    const ndx = (await get("https://api.nasdaq.com/api/quote/list-type/nasdaq100")).data.data.rows
      .map((r) => ({ s: r.symbol.replace(/\./g, "-"), n: r.companyName.replace(/ (Common Stock|Class [A-C].*|Ordinary Shares.*|American Depositary Shares.*)$/i, "") }));
    // The Dow's 30 members are listed by name in the navigation box on its page.
    const dowHtml = await wikiHtml("Dow Jones Industrial Average");
    const at = dowHtml.search(/title="Amgen"/), box = at < 0 ? "" : dowHtml.slice(dowHtml.lastIndexOf("<ul", at), dowHtml.indexOf("</ul>", at));
    const dowNames = [...box.matchAll(/<a [^>]*title="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'"));
    const squash = (s) => s.toLowerCase().replace(/\b(inc|corp|corporation|company|co|the|holdings|group|plc)\b|[^a-z0-9]/g, "");
    const byName = new Map(sp.map((x) => [squash(x.n), x.s]));
    const DOW_KNOWN = { IBM: "IBM", "Alphabet Inc.": "GOOGL", Honeywell: "HON" };
    const dow = dowNames.map((n) => DOW_KNOWN[n] || byName.get(squash(n)) || [...byName].find(([k]) => k.startsWith(squash(n)) || squash(n).startsWith(k))?.[1]).filter(Boolean);
    const spSet = new Set(sp.map((x) => x.s));
    const items = [...sp, ...ndx.filter((x) => !spSet.has(x.s))];
    return {
      list: "S&P 500 + Nasdaq-100",
      items,
      indices: [
        { y: "^GSPC", n: "S&P 500", mem: sp.map((x) => x.s) },
        { y: "^IXIC", n: "Nasdaq Composite" },
        { y: "^NDX", n: "Nasdaq-100", mem: ndx.map((x) => x.s) },
        { y: "^DJI", n: "Dow Jones Industrial Average", mem: [...new Set(dow)] },
        { y: "^RUT", n: "Russell 2000" },
        { y: "^VIX", n: "CBOE Volatility Index (VIX)" },
        // Sector funds stand in for sector indices: the S&P 500's sectors, one fund each.
        ...[["XLK", "Technology"], ["XLF", "Financials"], ["XLV", "Health Care"], ["XLY", "Consumer Discretionary"], ["XLP", "Consumer Staples"],
          ["XLE", "Energy"], ["XLI", "Industrials"], ["XLB", "Materials"], ["XLU", "Utilities"], ["XLRE", "Real Estate"], ["XLC", "Communication Services"]]
          .map(([t, n]) => ({ id: `US:${t}`, n: `S&P 500 ${n} (${t})`, sector: true })),
      ],
    };
  },
  async GB() {
    const fix = (t) => `${t.replace(/\.$/, "").replace(/\./g, "-")}.L`;
    const f100 = tableWith(wikiTables(await wikiHtml("FTSE 100 Index")), ["Company", "Ticker", "FTSE industry"]).map(([n, t, i]) => ({ s: fix(t), n, i }));
    const f250 = tableWith(wikiTables(await wikiHtml("FTSE 250 Index")), ["Company", "Ticker", "FTSE Industry"]).map(([n, t, i]) => ({ s: fix(t), n, i }));
    const seen = new Set();
    const items = [...f100, ...f250].filter((x) => x.s.length > 2 && !seen.has(x.s) && seen.add(x.s));
    return {
      list: "FTSE 350",
      items,
      indices: [
        { y: "^FTSE", n: "FTSE 100", mem: f100.map((x) => x.s) },
        { y: "^FTMC", n: "FTSE 250", mem: f250.map((x) => x.s) },
        { y: "^FTAS", n: "FTSE All-Share" },
      ],
    };
  },
  async JP() {
    const html = await wikiHtml("Nikkei 225");
    const seg = html.slice(html.indexOf('id="Components"'));
    const seen = new Set();
    const items = [...seg.matchAll(/<li>([\s\S]*?)<\/li>/g)]
      .map((m) => /^(.*?)\s*\(\s*TYO\s*:\s*(\d{4})\s*\)/.exec(text(m[1])))
      .filter(Boolean)
      .map(([, n, code]) => ({ s: `${code}.T`, n }))
      .filter((x) => !seen.has(x.s) && seen.add(x.s));
    return {
      list: "Nikkei 225",
      items,
      indices: [
        { y: "^N225", n: "Nikkei 225", mem: items.map((x) => x.s) },
        { y: "1306.T", n: "TOPIX (index fund)" },
      ],
    };
  },
  async DE() {
    const dax = tableWith(wikiTables(await wikiHtml("DAX")), ["Ticker", "Company", "Prime Standard"]).map(([s, n, i]) => ({ s: s.trim(), n, i }));
    const mdaxNames = tableWith(wikiTables(await wikiHtml("MDAX")), ["Name", "Industry"]);
    const mdax = [];
    // Names Yahoo's search doesn't find as written on the list.
    const KNOWN = { "Fuchs Petrolub": "FPE3.DE", "K+S": "SDF.DE", Nemetschek: "NEM.DE", "Ströer": "SAX.DE", "TAG Tegernsee Immobilien und Beteiligung": "TEG.DE", Scout24: "G24.DE" };
    await mapLimit(mdaxNames, 3, async ([n, i]) => {
      const s = KNOWN[n] || (await yahooFind(n, ".DE").catch(() => null));
      if (s) mdax.push({ s, n, i });
      else console.log(`    MDAX: no Yahoo symbol found for ${n}`);
    });
    const seen = new Set();
    const items = [...dax, ...mdax].filter((x) => /\.DE$/.test(x.s) && !seen.has(x.s) && seen.add(x.s));
    return {
      list: "DAX and MDAX",
      items,
      indices: [
        { y: "^GDAXI", n: "DAX", mem: dax.map((x) => x.s) },
        { y: "^MDAXI", n: "MDAX", mem: mdax.map((x) => x.s) },
        { y: "^SDAXI", n: "SDAX" },
        { y: "^TECDAX", n: "TecDAX" },
      ],
    };
  },
  async HK() {
    const items = tableWith(wikiTables(await wikiHtml("Hang Seng Index")), ["Ticker", "Name", "Sub-index"])
      .map(([t, n, i]) => ({ s: `${String(/(\d+)/.exec(t)?.[1] || "").padStart(4, "0")}.HK`, n, i }))
      .filter((x) => x.s !== "0000.HK");
    return {
      list: "Hang Seng Index",
      items,
      indices: [
        { y: "^HSI", n: "Hang Seng Index", mem: items.map((x) => x.s) },
        { y: "^HSCE", n: "Hang Seng China Enterprises" },
        { y: "HSTECH.HK", n: "Hang Seng TECH" },
      ],
    };
  },
};

const want = process.argv.slice(2).map((a) => a.toUpperCase()).filter((a) => COUNTRY[a]);
fs.mkdirSync(outDir, { recursive: true });
for (const code of want.length ? want : Object.keys(COUNTRY)) {
  console.log(`${code}: reading index members…`);
  try {
    const c = await COUNTRY[code]();
    if (c.items.length < 20) throw new Error(`only ${c.items.length} stocks found; the source page may have changed`);
    console.log(`  ${c.items.length} stocks; names, sectors and share counts from Yahoo…`);
    await enrich(c.items);
    const file = path.join(outDir, `${code.toLowerCase()}.json`);
    fs.writeFileSync(file, JSON.stringify({ updated: new Date().toISOString().slice(0, 10), code, list: c.list, source: "Wikipedia index member tables, Nasdaq, Yahoo", items: c.items, indices: c.indices }));
    const sized = c.items.filter((x) => x.sh).length;
    console.log(`  saved ${path.relative(root, file)}: ${c.items.length} stocks (${sized} with share counts), ${c.indices.length} indices${c.indices.filter((x) => x.mem).map((x) => `, ${x.n} ${x.mem.length} members`).join("")}`);
  } catch (e) {
    console.log(`  ${code}: not updated (${e.message}). The old list stays.`);
  }
}
