// India events calendar, worked out locally (no website to call, so it never rate-limits):
//   • RBI Monetary Policy decisions, from the RBI's published meeting schedule
//   • GDP (last working day of Feb/May/Aug/Nov), CPI (12th), WPI (14th), IIP (28th): the release
//     days MoSPI and the Commerce Ministry follow, moved to the next working day when they fall on a
//     weekend or holiday
//   • F&O expiries: NIFTY weekly every Tuesday, NSE monthly (NIFTY, BANKNIFTY, stocks) on the last
//     Tuesday, SENSEX weekly and BSE monthly on Thursdays; an expiry on a holiday moves to the trading
//     day before
//   • NSE trading holidays, Muhurat trading and the Union Budget
// Times are IST. Update RBI_MPC and NSE_HOLIDAYS when the RBI and NSE publish next year's lists.

// Decision day (the last day of each meeting); the governor's statement is at 10:00 IST.
export const RBI_MPC = [
  "2025-12-05", "2026-02-06",
  // FY 2026-27, RBI press release of 23 March 2026
  "2026-04-08", "2026-06-05", "2026-08-05", "2026-10-07", "2026-12-04", "2027-02-05",
];

// Weekday closures, equity and equity-derivatives segments (NSE circular for 2026).
export const NSE_HOLIDAYS = {
  "2026-01-26": "Republic Day",
  "2026-03-03": "Holi",
  "2026-03-26": "Shri Ram Navami",
  "2026-03-31": "Shri Mahavir Jayanti",
  "2026-04-03": "Good Friday",
  "2026-04-14": "Dr. Baba Saheb Ambedkar Jayanti",
  "2026-05-01": "Maharashtra Day",
  "2026-05-28": "Bakri Id",
  "2026-06-26": "Muharram",
  "2026-09-14": "Ganesh Chaturthi",
  "2026-10-02": "Mahatma Gandhi Jayanti",
  "2026-10-20": "Dussehra",
  "2026-11-10": "Diwali Balipratipada",
  "2026-11-24": "Guru Nanak Jayanti",
  "2026-12-25": "Christmas",
};
export const HOLIDAY_YEARS = [2026];
const SPECIAL = [
  { date: "2026-11-08", time: "18:00", title: "Muhurat trading (Diwali)", impact: "Low", kind: "market", note: "Exact session timings come in an NSE circular." },
];

const DAY = 86400e3;
const iso = (d) => d.toISOString().slice(0, 10);
const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const isWeekend = (d) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
export const isTradingDay = (d) => !isWeekend(d) && !NSE_HOLIDAYS[iso(d)];
const nextWorking = (d) => { while (!isTradingDay(d)) d = new Date(d - -DAY); return d; };
const prevWorking = (d) => { while (!isTradingDay(d)) d = new Date(d - DAY); return d; };
const lastWeekday = (y, m, wd) => { // last given weekday of month m (0-based)
  const d = utc(y, m + 1, 0);
  return new Date(d - ((d.getUTCDay() - wd + 7) % 7) * DAY);
};
const lastWorking = (y, m) => prevWorking(utc(y, m + 1, 0));
const ev = (d, time, title, impact, kind, note) => ({ date: `${iso(d)}T${time}:00+05:30`, title, country: "IN", impact, kind, ...(note ? { note } : {}) });
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const prevMonthName = (m) => MONTHS[(m + 11) % 12];

// Events from `from` to `to` (Dates or ISO strings), oldest first.
export function indiaEvents(from = new Date(Date.now() - 7 * DAY), to = new Date(Date.now() + 60 * DAY)) {
  const a = new Date(`${iso(new Date(from))}T00:00:00Z`), b = new Date(`${iso(new Date(to))}T23:59:59Z`);
  const out = [];
  const guess = (y) => (HOLIDAY_YEARS.includes(y) ? null : `NSE's ${y} holiday list isn't in the app yet, so this date ignores holidays.`);
  for (const date of RBI_MPC) out.push(ev(new Date(`${date}T00:00:00Z`), "10:00", "RBI policy decision (repo rate)", "High", "rbi"));
  for (const [date, name] of Object.entries(NSE_HOLIDAYS)) out.push(ev(new Date(`${date}T00:00:00Z`), "09:15", `Market holiday: ${name}`, "Medium", "market", "NSE and BSE closed"));
  for (const s of SPECIAL) out.push(ev(new Date(`${s.date}T00:00:00Z`), s.time, s.title, s.impact, s.kind, s.note));
  for (let y = a.getUTCFullYear(); y <= b.getUTCFullYear(); y++) {
    out.push(ev(utc(y, 1, 1), "11:00", "Union Budget", "High", "budget"));
    for (let m = 0; m < 12; m++) {
      const g = guess(y);
      out.push(ev(nextWorking(utc(y, m, 12)), "16:00", `CPI inflation (${prevMonthName(m)})`, "High", "data", g));
      out.push(ev(nextWorking(utc(y, m, 14)), "12:00", `WPI inflation (${prevMonthName(m)})`, "Medium", "data", g));
      out.push(ev(nextWorking(utc(y, m, 28)), "16:00", `Industrial production, IIP (${MONTHS[(m + 11) % 12]})`, "Medium", "data", g));
      if ([1, 4, 7, 10].includes(m)) {
        const q = { 1: "Oct–Dec", 4: "Jan–Mar, and the full year", 7: "Apr–Jun", 10: "Jul–Sep" }[m];
        out.push(ev(lastWorking(y, m), "16:00", `GDP growth (${q})`, "High", "data", g));
      }
      // Expiries: last Tuesday (NSE) and last Thursday (BSE) of the month, earlier on a holiday.
      const nseMonthly = prevWorking(lastWeekday(y, m, 2));
      out.push(ev(nseMonthly, "15:30", "Monthly F&O expiry: NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY and stock F&O (NSE)", "High", "expiry", guess(y)));
      const bseMonthly = prevWorking(lastWeekday(y, m, 4));
      out.push(ev(bseMonthly, "15:30", "Monthly expiry: SENSEX, BANKEX (BSE)", "Medium", "expiry", guess(y)));
      for (let d = utc(y, m, 1); d.getUTCMonth() === m; d = new Date(d - -DAY)) {
        if (d.getUTCDay() === 2) {
          const x = prevWorking(d);
          if (iso(x) !== iso(nseMonthly)) out.push(ev(x, "15:30", "NIFTY weekly expiry", "Low", "expiry", iso(x) !== iso(d) ? `Moved from ${iso(d)} (holiday)` : guess(y)));
        }
        if (d.getUTCDay() === 4) {
          const x = prevWorking(d);
          if (iso(x) !== iso(bseMonthly)) out.push(ev(x, "15:30", "SENSEX weekly expiry (BSE)", "Low", "expiry", iso(x) !== iso(d) ? `Moved from ${iso(d)} (holiday)` : guess(y)));
        }
      }
    }
  }
  // Say when a monthly expiry moved because of a holiday.
  for (const e of out) {
    if (e.kind !== "expiry" || !/^Monthly/.test(e.title)) continue;
    const d = new Date(`${e.date.slice(0, 10)}T00:00:00Z`);
    const wd = /\(NSE\)/.test(e.title) ? 2 : 4;
    if (d.getUTCDay() !== wd) e.note = `Moved from ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][wd]} (holiday)`;
  }
  return out
    .filter((e) => { const t = Date.parse(e.date); return t >= a && t <= b; })
    .sort((x, y) => x.date.localeCompare(y.date) || ({ High: 0, Medium: 1, Low: 2 }[x.impact] - { High: 0, Medium: 1, Low: 2 }[y.impact]));
}
