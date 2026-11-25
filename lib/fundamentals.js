// Screener metrics: company ratios from saved fundamentals plus the live price, and performance /
// technical figures from a year of daily closes. Pure functions (no network), so they are easy to test.

const pct = (a, b) => (a != null && b != null && b !== 0 ? (a / b - 1) * 100 : null);
const ratio = (a, b, k = 1) => (a != null && b != null && b !== 0 ? (a / b) * k : null);
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
// Growth needs a positive base: -10 -> +5 is a turnaround, not a percentage.
const growth = (now, before) => (now != null && before > 0 ? (now / before - 1) * 100 : null);

// f: saved fundamentals for one company (see scripts/update-lists.js); sh: shares outstanding.
// Per-share figures are worked out from totals and the share count, so splits and bonus issues
// don't throw them off (Yahoo's EPS isn't always adjusted for them).
export function companyRatios(f, price, sh) {
  if (!f) return {};
  const mcap = price != null && sh ? price * sh : null;
  const ni = f.tNi ?? f.ni?.at(-1) ?? null;
  const rev = f.tRev ?? f.rev?.at(-1) ?? null;
  const ebitda = f.tEbitda ?? f.ebitda ?? null;
  const annRev = f.rev?.at(-1) ?? null;
  const ev = mcap != null ? mcap + (f.debt || 0) - (f.cash || 0) : null;
  const q = f.qRev || [];
  const qn = f.qNi || [];
  const years = (f.rev?.length || 0) - 1;
  return {
    pe: ni > 0 ? r2(mcap / ni) : null,
    pb: f.eq > 0 ? r2(ratio(mcap, f.eq)) : null,
    ps: rev > 0 ? r2(ratio(mcap, rev)) : null,
    evEbitda: ebitda > 0 && ev != null ? r2(ev / ebitda) : null,
    eps: ni != null && sh ? r2(ni / sh) : null,
    bvps: f.eq != null && sh ? r2(f.eq / sh) : null,
    roe: f.eq > 0 ? r2(ratio(ni, f.eq, 100)) : null,
    roa: f.assets > 0 ? r2(ratio(ni, f.assets, 100)) : null,
    netMargin: rev > 0 ? r2(ratio(ni, rev, 100)) : null,
    opMargin: annRev > 0 && f.op != null ? r2(ratio(f.op, annRev, 100)) : null,
    grossMargin: annRev > 0 && f.gp != null ? r2(ratio(f.gp, annRev, 100)) : null,
    revenue: rev,
    netIncome: ni,
    revGrowth: r2(growth(f.rev?.at(-1), f.rev?.at(-2))),
    profitGrowth: r2(growth(f.ni?.at(-1), f.ni?.at(-2))),
    revGrowthQ: q.length >= 5 ? r2(growth(q.at(-1), q.at(-5))) : null,
    profitGrowthQ: qn.length >= 5 ? r2(growth(qn.at(-1), qn.at(-5))) : null,
    revCagr3: years >= 3 && f.rev[f.rev.length - 4] > 0 ? r2((Math.pow(f.rev.at(-1) / f.rev[f.rev.length - 4], 1 / 3) - 1) * 100) : null,
    de: f.eq > 0 && f.debt != null ? r2(f.debt / f.eq) : null,
    currentRatio: f.cl > 0 && f.ca != null ? r2(f.ca / f.cl) : null,
    divYield: mcap > 0 && f.div != null ? r2((f.div / mcap) * 100) : null,
    payout: f.ni?.at(-1) > 0 && f.div != null ? r2((f.div / f.ni.at(-1)) * 100) : null,
    fcfYield: mcap > 0 && f.fcf != null ? r2((f.fcf / mcap) * 100) : null,
    fy: f.fy || null,
  };
}

const sma = (xs, n) => (xs.length >= n ? xs.slice(-n).reduce((a, b) => a + b, 0) / n : null);
function rsi(closes, n = 14) {
  if (closes.length <= n) return null;
  let up = 0, dn = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) up += d; else dn -= d;
  }
  up /= n; dn /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    up = (up * (n - 1) + Math.max(d, 0)) / n;
    dn = (dn * (n - 1) + Math.max(-d, 0)) / n;
  }
  return dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
}

// times: unix seconds; closes: daily closes (oldest first); price: the live price (optional).
export function performance(times, closes, price) {
  const pts = [];
  for (let i = 0; i < closes.length; i++) if (closes[i] != null) pts.push([times[i], closes[i]]);
  if (pts.length < 2) return {};
  const cl = pts.map((p) => p[1]);
  const last = price ?? cl.at(-1);
  const back = (n) => (cl.length > n ? cl[cl.length - 1 - n] : null);
  // YTD: the last close of the previous year (IST), else the first close this year.
  const yearStart = Date.UTC(new Date(Date.now() + 5.5 * 3600e3).getUTCFullYear(), 0, 1) / 1000 - 5.5 * 3600;
  const before = pts.filter((p) => p[0] < yearStart);
  const ytdBase = before.length ? before.at(-1)[1] : pts.find((p) => p[0] >= yearStart)?.[1];
  const hi = Math.max(...cl, last), lo = Math.min(...cl, last);
  const s50 = sma(cl, 50), s200 = sma(cl, 200);
  const rets = [];
  for (let i = Math.max(1, cl.length - 63); i < cl.length; i++) rets.push(Math.log(cl[i] / cl[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const vol = rets.length > 5 ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252) * 100 : null;
  return {
    perfW: r2(pct(last, back(5))),
    perfM: r2(pct(last, back(21))),
    perf3M: r2(pct(last, back(63))),
    perf6M: r2(pct(last, back(126))),
    perfYTD: r2(pct(last, ytdBase)),
    perfY: r2(pct(last, cl[0])),
    high52: r2(hi),
    low52: r2(lo),
    fromHigh: r2(pct(last, hi)),
    fromLow: r2(pct(last, lo)),
    rsi: r2(rsi([...cl.slice(0, -1), last])),
    vsSma50: r2(pct(last, s50)),
    vsSma200: r2(pct(last, s200)),
    volatility: r2(vol),
  };
}

// SEBI's size classes go by market-cap rank: 1-100 large, 101-250 mid, the rest small.
export function capClasses(rows) {
  const ranked = rows.filter((r) => r.marketCap > 0).sort((a, b) => b.marketCap - a.marketCap);
  ranked.forEach((r, i) => {
    r.capRank = i + 1;
    r.capClass = i < 100 ? "Large cap" : i < 250 ? "Mid cap" : "Small cap";
  });
  return rows;
}
