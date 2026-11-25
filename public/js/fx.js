// Showing a chart in another currency (click the currency at the top of the price scale). Prices
// are converted bar by bar with that day's exchange rate, from daily USD rates (FX:USDEUR and so
// on). Stablecoins (USDT, USDC…) count as US dollars. Volume isn't converted.

export const CURRENCIES = [
  ["INR", "Indian rupee"], ["USD", "US dollar"], ["EUR", "Euro"], ["JPY", "Japanese yen"], ["GBP", "British pound"],
  ["CNY", "Chinese yuan"], ["CHF", "Swiss franc"], ["CAD", "Canadian dollar"], ["AUD", "Australian dollar"],
  ["NZD", "New Zealand dollar"], ["HKD", "Hong Kong dollar"], ["SGD", "Singapore dollar"], ["KRW", "South Korean won"],
  ["TWD", "Taiwan dollar"], ["AED", "UAE dirham"], ["SAR", "Saudi riyal"], ["QAR", "Qatari riyal"],
  ["KWD", "Kuwaiti dinar"], ["SEK", "Swedish krona"], ["NOK", "Norwegian krone"], ["DKK", "Danish krone"],
  ["PLN", "Polish złoty"], ["CZK", "Czech koruna"], ["HUF", "Hungarian forint"], ["TRY", "Turkish lira"],
  ["RUB", "Russian rouble"], ["ZAR", "South African rand"], ["BRL", "Brazilian real"], ["MXN", "Mexican peso"],
  ["ILS", "Israeli shekel"], ["THB", "Thai baht"], ["IDR", "Indonesian rupiah"], ["MYR", "Malaysian ringgit"],
  ["PHP", "Philippine peso"],
];
const CODES = new Set(CURRENCIES.map(([c]) => c));
const STABLE = new Set(["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "USDE", "DAI"]);

// The real-world currency behind a quote currency (USDT → USD).
export const fiatOf = (c) => (STABLE.has(c) ? "USD" : c);
// Prices in BTC, ETH or BNB can't be turned into money with exchange rates.
export const canConvert = (native) => !!native && CODES.has(fiatOf(native));

// Units of a currency per US dollar at time t: the last daily close on or before t (the first one
// before the series starts). series: { times, closes } or null for USD itself.
export function rateAt(series, t) {
  if (!series) return 1;
  const T = series.times;
  if (!T.length) return NaN;
  let lo = 0, hi = T.length - 1;
  if (t < T[0]) return series.closes[0];
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (T[m] <= t) lo = m;
    else hi = m - 1;
  }
  return series.closes[lo];
}

// Bars priced in one currency, priced in another: from/to are the USD rate series of each.
export function convertBars(bars, from, to) {
  return bars.map((b) => {
    const k = rateAt(to, b.time) / rateAt(from, b.time);
    return { ...b, open: b.open * k, high: b.high * k, low: b.low * k, close: b.close * k };
  });
}
