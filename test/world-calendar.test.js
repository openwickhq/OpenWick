import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduledEvents, mergeCalendar, zoned, CENTRAL_BANKS } from "../lib/world-calendar.js";
import { tidyStat } from "../lib/market-info.js";

test("world calendar: local times become the right instant, summer time included", () => {
  assert.equal(zoned("2026-12-09", "14:00", "America/New_York"), "2026-12-09T19:00:00.000Z");
  assert.equal(zoned("2027-07-28", "14:00", "America/New_York"), "2027-07-28T18:00:00.000Z");
  assert.equal(zoned("2027-06-17", "12:00", "Europe/London"), "2027-06-17T11:00:00.000Z");
  assert.equal(zoned("2027-01-22", "12:00", "Asia/Tokyo"), "2027-01-22T03:00:00.000Z");
});

test("world calendar: expiries follow each market's rule", () => {
  const titles = (cc) => scheduledEvents(cc, "2027-01-01", "2027-03-31").filter((e) => e.kind === "expiry").map((e) => e.date.slice(0, 10));
  assert.deepEqual(titles("US"), ["2027-01-15", "2027-02-19", "2027-03-19"]); // third Fridays
  assert.deepEqual(titles("JP"), ["2027-01-08", "2027-02-12", "2027-03-12"]); // second Fridays
  assert.deepEqual(titles("HK"), ["2027-01-28", "2027-02-25", "2027-03-30"]); // second-last weekday
  const q = scheduledEvents("DE", "2027-03-01", "2027-03-31").find((e) => e.kind === "expiry");
  assert.equal(q.impact, "High");
});

test("world calendar: every country has events in any two-month window, and banks aren't listed twice", () => {
  for (const cc of ["US", "GB", "JP", "DE", "HK"]) assert.ok(scheduledEvents(cc, "2027-05-01", "2027-06-30").length >= 2, cc);
  // No Fed decision for the strategy-only October 2027 meeting.
  assert.ok(!CENTRAL_BANKS.US.dates.includes("2027-10-27"));
  const feed = [{ title: "Federal Funds Rate", country: "USD", date: "2026-12-09T14:00:00-05:00", impact: "High" }];
  const rows = mergeCalendar("US", feed);
  assert.equal(rows.filter((r) => r.date.startsWith("2026-12-09")).length, 1);
  // China's LPR on a Sunday moves to Monday.
  assert.ok(scheduledEvents("HK", "2026-12-01", "2026-12-31").some((e) => /Loan Prime/.test(e.title) && e.date.startsWith("2026-12-21")));
});

test("US stock stats: raw volume and market cap are tidied", () => {
  assert.equal(tidyStat("Share Volume", "21,368,018.437203"), "21,368,018");
  assert.equal(tidyStat("Market Cap", "5,210,368,534,280"), "$5.21T");
  assert.equal(tidyStat("Previous Close", "$355.58"), "$355.58");
});
