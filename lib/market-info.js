// Earnings and dividend calendars, news, financial statements and key stats. Nasdaq's public API
// for US stocks; CoinGecko's public API for coin stats; Cointelegraph's and Decrypt's RSS feeds
// for crypto headlines.
import { getJson, cached, NQ, resolve, kindOf } from "./providers.js";
import { nseBySymbol, indexByYahoo } from "./universe.js";

const OFFLINE = process.env.OW_OFFLINE === "1";
const num = (s) => {
  const v = parseFloat(String(s ?? "").replace(/[$,%\s]/g, ""));
  return Number.isFinite(v) ? v : null;
};
const ymd = (d) => d.toISOString().slice(0, 10);

// The next n weekdays starting today (UTC).
function weekdays(n) {
  const out = [];
  const d = new Date();
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(ymd(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export async function earnings(days = 5) {
  if (OFFLINE) return [];
  const dates = weekdays(Math.min(10, Math.max(1, days)));
  const perDay = await Promise.all(
    dates.map((date) =>
      cached(`earnings:${date}`, 30 * 60e3, async () => {
        const j = await getJson(
          `https://api.nasdaq.com/api/calendar/earnings?date=${date}`,
          NQ,
        );
        return (j?.data?.rows || []).map((r) => ({
          date,
          symbol: `US:${r.symbol}`,
          ticker: r.symbol,
          name: r.name,
          when:
            r.time === "time-pre-market"
              ? "Before the open"
              : r.time === "time-after-hours"
                ? "After the close"
                : "Time not given",
          marketCap: num(r.marketCap),
          epsForecast: r.epsForecast || "",
          quarter: r.fiscalQuarterEnding || "",
          lastYearEps: r.lastYearEPS || "",
        }));
      }).catch(() => []),
    ),
  );
  return perDay.flat();
}

export async function dividends(days = 5) {
  if (OFFLINE) return [];
  const dates = weekdays(Math.min(10, Math.max(1, days)));
  const perDay = await Promise.all(
    dates.map((date) =>
      cached(`dividends:${date}`, 30 * 60e3, async () => {
        const j = await getJson(
          `https://api.nasdaq.com/api/calendar/dividends?date=${date}`,
          NQ,
        );
        return (j?.data?.calendar?.rows || []).map((r) => ({
          date,
          symbol: `US:${r.symbol}`,
          ticker: r.symbol,
          name: r.companyName,
          exDate: r.dividend_Ex_Date,
          payDate: r.payment_Date,
          recordDate: r.record_Date,
          amount: r.dividend_Rate,
          annual: r.indicated_Annual_Dividend,
        }));
      }).catch(() => []),
    ),
  );
  return perDay.flat();
}

// ---------- news ----------
const COIN_NAMES = {
  BTC: ["bitcoin", "btc"],
  ETH: ["ethereum", "ether", "eth"],
  SOL: ["solana", "sol"],
  XRP: ["xrp", "ripple"],
  BNB: ["bnb", "binance coin"],
  DOGE: ["dogecoin", "doge"],
  ADA: ["cardano", "ada"],
  AVAX: ["avalanche", "avax"],
  LINK: ["chainlink", "link"],
  DOT: ["polkadot"],
  LTC: ["litecoin", "ltc"],
  TRX: ["tron", "trx"],
  TON: ["toncoin", "ton"],
  SHIB: ["shiba inu", "shib"],
  PEPE: ["pepe"],
  SUI: ["sui"],
  NEAR: ["near protocol", "near"],
  ZEC: ["zcash", "zec"],
};
const decode = (s) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();

export function parseRss(xml, source) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const pick = (tag) =>
      decode(
        (new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(block) ||
          [])[1] || "",
      );
    const title = pick("title");
    if (!title) continue;
    items.push({
      title,
      url: pick("link"),
      source,
      time: Date.parse(pick("pubDate")) || null,
      summary: pick("description").slice(0, 280),
    });
  }
  return items;
}

// Fetch several RSS feeds, merge them newest first, and drop repeated headlines.
async function readFeeds(feeds) {
  const lists = await Promise.all(
    feeds.map(async ([url, name]) => {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 OpenWick" },
          signal: AbortSignal.timeout(10000),
        });
        return res.ok ? parseRss(await res.text(), name) : [];
      } catch {
        return [];
      }
    }),
  );
  const seen = new Set();
  return lists
    .flat()
    .filter((n) => {
      const k = n.title.toLowerCase().replace(/\W+/g, " ").trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (b.time || 0) - (a.time || 0));
}

function cryptoNews() {
  return cached("news:crypto", 10 * 60e3, () =>
    readFeeds([
      ["https://cointelegraph.com/rss", "Cointelegraph"],
      ["https://decrypt.co/feed", "Decrypt"],
    ]),
  );
}

// Indian market news from the big business papers' public feeds.
export const INDIA_FEEDS = [
  ["https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms", "Economic Times"],
  ["https://www.livemint.com/rss/markets", "Mint"],
  ["https://www.business-standard.com/rss/markets-106.rss", "Business Standard"],
  ["https://www.moneycontrol.com/rss/marketreports.xml", "Moneycontrol"],
];
// These feeds also carry Wall Street stories. A headline about US markets or US companies is left
// out unless it also says how it touches India ("Fed cut: what it means for Nifty" stays).
const US_TOPIC = /\b(nasdaq|dow( jones)?|s&p ?500|wall street|us (stocks?|markets?|economy|jobs|inflation|cpi|gdp|treasur(y|ies)|bonds?|futures|fed)|federal reserve|powell|treasury yields?|nvidia|apple|tesla|microsoft|amazon|alphabet|google|meta platforms|netflix|intel|amd|broadcom|oracle|hewlett packard|ibm|boeing|walmart|jpmorgan|goldman sachs|morgan stanley|berkshire|warren buffett|elon musk|jensen huang|openai|anthropic|palantir|coinbase)\b|\$\s?\d/i;
const INDIA_TOPIC = /\b(india|indian|sensex|nifty|rupee|rbi|sebi|nse|bse|dalal street|d-street|fii|fpi|dii|crore|lakh|mumbai|it stocks|infosys|tcs|wipro|hcl|tech mahindra|adani|reliance|tata)\b|₹|\brs\.? ?\d/i;
export const isUsOnlyHeadline = (n) => US_TOPIC.test(n.title || "") && !INDIA_TOPIC.test(`${n.title || ""} ${n.summary || ""}`);
function indiaNews() {
  return cached("news:india", 10 * 60e3, async () => (await readFeeds(INDIA_FEEDS)).filter((n) => !isUsOnlyHeadline(n)));
}

// Google News search (India edition) for one company. Its titles end in " - Publisher".
export function parseGoogleNews(xml) {
  return parseRss(xml, "").map((n, i) => {
    const src = [...xml.matchAll(/<source[^>]*>([\s\S]*?)<\/source>/g)][i]?.[1];
    const source = src ? decode(src) : n.title.split(" - ").at(-1);
    return {
      ...n,
      title: n.title.endsWith(` - ${source}`) ? n.title.slice(0, -(source.length + 3)) : n.title,
      source,
      summary: "",
    };
  });
}
function companyNews(query) {
  return cached(`news:co:${query}`, 15 * 60e3, async () => {
    try {
      const res = await fetch(
        `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`,
        { headers: { "User-Agent": "Mozilla/5.0 OpenWick" }, signal: AbortSignal.timeout(10000) },
      );
      return res.ok ? parseGoogleNews(await res.text()) : [];
    } catch {
      return [];
    }
  });
}
const companyName = (n) =>
  n.replace(/\s*\b(Ltd\.?|Limited|Corporation|Company|Co\.)\s*$/i, "").replace(/\s+\(.*\)$/, "").trim();

export async function news(symbol) {
  if (OFFLINE) return { items: [], note: "" };
  if (/^(india|market:india)$/i.test(String(symbol || "")))
    return { items: (await indiaNews()).slice(0, 60), note: "Latest Indian market headlines" };
  if (/^(crypto|market:crypto)$/i.test(String(symbol || "")))
    return { items: (await cryptoNews()).slice(0, 60), note: "Latest crypto headlines" };
  const sym = await resolve(symbol);
  // Indian stocks: headlines about the company, topped up with the general market feed.
  const nse = sym.exchange === "YAHOO" && /\.(NS|BO)$/.test(sym.ticker) && nseBySymbol.get(sym.ticker.replace(/\.(NS|BO)$/, ""));
  if (nse) {
    const name = companyName(nse.n);
    const tick = nse.s;
    const re = new RegExp(`\\b(${[name, tick].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
    const [own, market] = await Promise.all([companyNews(`"${name}" share`), indiaNews()]);
    const mentions = market.filter((n) => re.test(`${n.title} ${n.summary}`));
    const seen = new Set();
    const items = [...mentions, ...own]
      .filter((n) => {
        const k = n.title.toLowerCase().slice(0, 60);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => (b.time || 0) - (a.time || 0))
      .slice(0, 30);
    return items.length
      ? { items, note: `Headlines about ${name}` }
      : { items: market.slice(0, 30), note: `No recent headlines about ${name}, so these are the latest Indian market headlines` };
  }
  // Indian indices, other Indian symbols and the rupee: the Indian market feed.
  if (sym.exchange === "YAHOO" || sym.exchange === "FX") {
    const idx = indexByYahoo.get(sym.ticker);
    return { items: (await indiaNews()).slice(0, 30), note: idx ? `Indian market headlines (for ${idx.n})` : "Latest Indian market headlines" };
  }
  if (["BINANCE", "COINBASE", "KRAKEN", "BYBIT", "BLOFIN"].includes(sym.exchange)) {
    const base =
      sym.ticker
        .replace(/-|\.P$/g, "")
        .replace(/(USDT|USDC|FDUSD|USD|BTC|ETH|EUR)$/, "")
        .replace(/^XBT$/, "BTC") || "BTC";
    const all = await cryptoNews();
    const words = COIN_NAMES[base] || [base.toLowerCase()];
    const re = new RegExp(
      `\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
      "i",
    );
    const hits = all.filter((n) => re.test(`${n.title} ${n.summary}`));
    return hits.length >= 3
      ? { items: hits.slice(0, 30), note: `Headlines mentioning ${base}` }
      : {
          items: all.slice(0, 30),
          note: `Few headlines mention ${base} right now, so these are the latest crypto headlines`,
        };
  }
  if (sym.exchange === "US") {
    const items = await cached(`news:${sym.ticker}`, 10 * 60e3, async () => {
      for (const cls of ["stocks", "etf", "index"]) {
        const j = await getJson(
          `https://api.nasdaq.com/api/news/topic/articlebysymbol?q=${encodeURIComponent(`${sym.ticker.toLowerCase()}|${cls}`)}&offset=0&limit=30&fallback=true`,
          NQ,
        ).catch(() => null);
        const rows = j?.data?.rows || [];
        if (rows.length)
          return rows.map((r) => ({
            title: r.title,
            url: r.url?.startsWith("http")
              ? r.url
              : `https://www.nasdaq.com${r.url}`,
            source: r.publisher,
            time: Date.parse(r.created) || null,
            ago: r.ago,
            summary: r.description || "",
          }));
      }
      return [];
    });
    return {
      items,
      note: items.length
        ? `Headlines for ${sym.ticker} from Nasdaq`
        : `No headlines found for ${sym.ticker}`,
    };
  }
  return {
    items: [],
    note: "No headlines for this symbol.",
  };
}

// ---------- fundamentals ----------
function table(t) {
  if (!t?.headers || !t?.rows) return null;
  const keys = Object.keys(t.headers).filter((k) => k !== "value1");
  return {
    periods: keys.map((k) => t.headers[k]),
    rows: t.rows.map((r) => ({
      label: r.value1,
      values: keys.map((k) => r[k] ?? ""),
    })),
  };
}

// The coin behind a crypto pair: SOLUSDT, SOL-USD, SOLUSD, SOLUSDT.P -> SOL.
export const coinOf = (ticker) =>
  String(ticker)
    .toUpperCase()
    .replace(/\.P$/, "")
    .replace(/[-/]/g, "")
    .replace(/^(.+?)(USDT|USDC|FDUSD|BUSD|TUSD|USD|EUR|GBP|BTC|ETH)$/, "$1") || null;

const big = (v) =>
  v == null
    ? null
    : v >= 1e12
      ? `$${(v / 1e12).toFixed(2)}T`
      : v >= 1e9
        ? `$${(v / 1e9).toFixed(2)}B`
        : v >= 1e6
          ? `$${(v / 1e6).toFixed(2)}M`
          : `$${Math.round(v).toLocaleString("en-US")}`;
const count = (v) =>
  v == null ? null : Math.round(v).toLocaleString("en-US");
const usd = (v) =>
  v == null
    ? null
    : `$${v.toLocaleString("en-US", { maximumSignificantDigits: 6 })}`;

// Coin stats in place of company statements: market cap, supply, volume, all-time high.
async function coinFinancials(sym, frequency) {
  const coin = coinOf(sym.ticker);
  return cached(`fin:coin:${coin}`, 10 * 60e3, async () => {
    const rows = await getJson(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&symbols=${encodeURIComponent(coin.toLowerCase())}`,
    );
    const c = (Array.isArray(rows) ? rows : []).sort(
      (a, b) => (b.market_cap || 0) - (a.market_cap || 0),
    )[0];
    if (!c)
      throw Object.assign(new Error(`CoinGecko has no stats for ${coin}.`), {
        status: 404,
      });
    const pct = (v) => (v == null ? null : `${v.toFixed(1)}%`);
    const day = (d) => (d ? String(d).slice(0, 10) : "");
    const stats = [
      ["Name", c.name],
      ["Market cap rank", c.market_cap_rank && `#${c.market_cap_rank}`],
      ["Market cap", big(c.market_cap)],
      ["Fully diluted value", big(c.fully_diluted_valuation)],
      ["24h volume", big(c.total_volume)],
      ["Price", usd(c.current_price)],
      ["24h change", pct(c.price_change_percentage_24h)],
      ["Circulating supply", count(c.circulating_supply)],
      ["Total supply", count(c.total_supply)],
      ["Max supply", c.max_supply ? count(c.max_supply) : "No cap"],
      ["All-time high", c.ath && `${usd(c.ath)} (${day(c.ath_date)})`],
      ["From all-time high", pct(c.ath_change_percentage)],
      ["All-time low", c.atl && `${usd(c.atl)} (${day(c.atl_date)})`],
    ]
      .filter(([, v]) => v)
      .map(([label, value]) => ({ label, value }));
    return {
      symbol: sym.id,
      frequency,
      kind: "crypto",
      coin,
      stats,
      nextEarnings: "",
      income: null,
      balance: null,
      cashflow: null,
      ratios: null,
      note: "Coins don't file income statements or balance sheets, so these are the coin's market stats in US dollars.",
      source: "CoinGecko",
    };
  });
}

export async function financials(symbol, frequency = "annual") {
  if (OFFLINE) return null;
  const sym = await resolve(symbol);
  if (kindOf(sym.id) === "crypto" && coinOf(sym.ticker))
    return coinFinancials(sym, frequency);
  if (sym.exchange !== "US")
    throw Object.assign(
      new Error("Financial statements are for US-listed stocks."),
      { status: 422 },
    );
  const f = frequency === "quarterly" ? 2 : 1;
  return cached(`fin:${sym.ticker}:${f}`, 6 * 3600e3, async () => {
    const [fin, sum, ed] = await Promise.all([
      getJson(
        `https://api.nasdaq.com/api/company/${sym.ticker}/financials?frequency=${f}`,
        NQ,
      ).catch(() => null),
      getJson(
        `https://api.nasdaq.com/api/quote/${sym.ticker}/summary?assetclass=stocks`,
        NQ,
      ).catch(() => null),
      getJson(
        `https://api.nasdaq.com/api/analyst/${sym.ticker}/earnings-date`,
        NQ,
      ).catch(() => null),
    ]);
    const d = fin?.data || {};
    const stats = Object.values(sum?.data?.summaryData || {})
      .map((x) => ({ label: x.label, value: x.value }))
      .filter((x) => x.value && x.value !== "N/A");
    const out = {
      symbol: sym.id,
      frequency,
      stats,
      nextEarnings: (ed?.data?.reportText || "").replace(/\s+/g, " ").trim(),
      income: table(d.incomeStatementTable),
      balance: table(d.balanceSheetTable),
      cashflow: table(d.cashFlowTable),
      ratios: table(d.financialRatiosTable),
      note: "Statement figures are in thousands of US dollars, as Nasdaq reports them.",
      source: "Nasdaq",
    };
    if (!out.income && !stats.length)
      throw Object.assign(
        new Error(
          `Nasdaq has no financials for ${sym.ticker} (ETFs and funds don't file them).`,
        ),
        { status: 404 },
      );
    return out;
  });
}
