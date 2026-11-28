// Scheduled events for the USA, UK, Japan, the euro area (Germany) and China / Hong Kong, worked
// out locally the way lib/india-calendar.js does for India. They're merged with the live
// economic-calendar feed, which only covers the current week, so a country's calendar is never
// empty on a weekend:
//   • central-bank decisions, from each bank's published schedule (update these lists when the
//     banks publish the next year's dates)
//   • China's Loan Prime Rate, on the 20th of each month
//   • each market's monthly index-derivatives expiry; the quarterly ones (March, June, September,
//     December) also expire futures and are marked High
// Expiry dates skip weekends but not public holidays (an expiry on a holiday moves a day earlier).

// Decision days (the last day of each meeting), from the banks' own pages, read November 2026.
export const CENTRAL_BANKS = {
  US: {
    title: "Fed rate decision (FOMC)", zone: "America/New_York", time: "14:00",
    // federalreserve.gov, revised schedule of 12 November 2026. The 26-27 October 2027 meeting is
    // for strategy only, with no decision, so it isn't listed.
    dates: ["2026-12-09", "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-11-17"],
  },
  GB: {
    title: "Bank of England rate decision", zone: "Europe/London", time: "12:00",
    dates: ["2026-12-17", "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-17", "2027-07-29", "2027-09-16", "2027-11-04", "2027-12-16"],
  },
  DE: {
    title: "ECB rate decision", zone: "Europe/Berlin", time: "14:15",
    dates: ["2026-12-17", "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-10", "2027-07-22", "2027-09-09", "2027-10-28", "2027-12-16"],
  },
  JP: {
    title: "Bank of Japan rate decision", zone: "Asia/Tokyo", time: "12:00", note: "No fixed time; usually around midday Tokyo time",
    dates: ["2026-12-18", "2027-01-22", "2027-03-18", "2027-04-28", "2027-06-11", "2027-07-22", "2027-09-22", "2027-10-29", "2027-12-17"],
  },
};
export const BANK_YEARS = [2026, 2027];

// Monthly index-derivatives expiry per market.
const EXPIRY = {
  // Third Friday; equity options stop at the close.
  US: { zone: "America/New_York", time: "16:00", rule: "3rd-fri", month: "Monthly options expiry (S&P 500, Nasdaq-100, stocks)", quarter: "Quarterly expiry: index futures and options (triple witching)" },
  // ICE Futures Europe: FTSE 100 options and futures settle on the third Friday's 10:15 auction.
  GB: { zone: "Europe/London", time: "10:15", rule: "3rd-fri", month: "FTSE 100 options expiry", quarter: "FTSE 100 futures and options expiry (quarterly)" },
  // Eurex: DAX options and futures settle on the third Friday's 13:00 Xetra auction.
  DE: { zone: "Europe/Berlin", time: "13:00", rule: "3rd-fri", month: "DAX options expiry (Eurex)", quarter: "DAX futures and options expiry (quarterly)" },
  // Osaka Exchange: Nikkei 225 options settle at the second Friday's opening prices (SQ).
  JP: { zone: "Asia/Tokyo", time: "09:00", rule: "2nd-fri", month: "Nikkei 225 options SQ", quarter: "Major SQ: Nikkei 225 futures and options (quarterly)" },
  // HKEX: Hang Seng Index futures and options expire on the second-last business day of the month.
  HK: { zone: "Asia/Hong_Kong", time: "16:00", rule: "2nd-last", month: "Hang Seng Index futures and options expiry", quarter: "Hang Seng Index futures and options expiry (quarter end)" },
};

const DAY = 86400e3;
const iso = (d) => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const weekend = (d) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
const nthWeekday = (y, m, wd, n) => {
  const first = utc(y, m, 1);
  return utc(y, m, 1 + ((wd - first.getUTCDay() + 7) % 7) + (n - 1) * 7);
};
const secondLastWorking = (y, m) => {
  let d = utc(y, m + 1, 0), seen = 0;
  for (;;) {
    if (!weekend(d) && ++seen === 2) return d;
    d = new Date(d - DAY);
  }
};
const nextWorking = (d) => {
  while (weekend(d)) d = new Date(d - -DAY);
  return d;
};

// A wall-clock time in a time zone, as an ISO instant (handles summer time).
export function zoned(day, time, zone) {
  const [h, min] = time.split(":").map(Number);
  const [y, mo, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, min);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(guess)).map((p) => [p.type, p.value]),
  );
  const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  return new Date(guess - (shown - guess)).toISOString();
}

const ev = (day, time, zone, title, impact, kind, cc, note) => ({ date: zoned(day, time, zone), title, country: cc, impact, kind, ...(note ? { note } : {}) });

// Scheduled events for a country (US, GB, JP, DE, HK) from `from` to `to`, oldest first.
export function scheduledEvents(cc, from = new Date(Date.now() - 7 * DAY), to = new Date(Date.now() + 60 * DAY)) {
  const a = Date.parse(`${iso(new Date(from))}T00:00:00Z`), b = Date.parse(`${iso(new Date(to))}T23:59:59Z`);
  const out = [];
  const bank = CENTRAL_BANKS[cc];
  if (bank) for (const d of bank.dates) out.push(ev(d, bank.time, bank.zone, bank.title, "High", "bank", cc, bank.note));
  const x = EXPIRY[cc];
  for (let y = new Date(a).getUTCFullYear(); y <= new Date(b).getUTCFullYear(); y++) {
    for (let m = 0; m < 12; m++) {
      if (x) {
        const d = x.rule === "3rd-fri" ? nthWeekday(y, m, 5, 3) : x.rule === "2nd-fri" ? nthWeekday(y, m, 5, 2) : secondLastWorking(y, m);
        const q = [2, 5, 8, 11].includes(m);
        out.push(ev(iso(d), x.time, x.zone, q ? x.quarter : x.month, q ? "High" : "Medium", "expiry", cc, "Moves a day earlier when it falls on a holiday"));
      }
      // China: the People's Bank's Loan Prime Rate, 09:00 Beijing time on the 20th.
      if (cc === "HK") out.push(ev(iso(nextWorking(utc(y, m, 20))), "09:00", "Asia/Shanghai", "China Loan Prime Rate (PBoC)", "High", "bank", cc, "On the 20th; later when that's a weekend or holiday"));
    }
  }
  if (cc === "HK" && bank == null) {
    // Hong Kong's base rate follows the Fed (the currency is pegged to the dollar), set the morning after.
    for (const d of CENTRAL_BANKS.US.dates) {
      const next = iso(new Date(Date.parse(`${d}T00:00:00Z`) + DAY));
      out.push(ev(next, "09:00", "Asia/Hong_Kong", "HKMA base rate (follows the Fed)", "Medium", "bank", cc));
    }
  }
  return out
    .filter((e) => { const t = Date.parse(e.date); return t >= a && t <= b; })
    .sort((p, q) => p.date.localeCompare(q.date));
}

// The live feed's rows plus the scheduled ones. A central-bank decision the feed already lists
// (its "Federal Funds Rate", "Official Bank Rate"…) isn't added twice.
const BANK_ROW = /rate|policy|statement|monetary|lpr/i;
export function mergeCalendar(cc, feedRows) {
  const feed = feedRows.map((r) => ({ ...r, country: cc, cur: r.country }));
  const days = new Set(feed.filter((r) => r.impact === "High" && BANK_ROW.test(r.title)).map((r) => r.date.slice(0, 10)));
  const local = scheduledEvents(cc).filter((e) => !(e.kind === "bank" && days.has(e.date.slice(0, 10))));
  return [...feed, ...local].sort((p, q) => Date.parse(p.date) - Date.parse(q.date));
}
