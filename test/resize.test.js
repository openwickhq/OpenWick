import { test } from "node:test";
import assert from "node:assert/strict";
import { clampSize, LIMITS } from "../public/js/resize.js";

test("panel sizes stay between the minimum and what leaves the chart room", () => {
  const b = LIMITS.bottom;
  assert.equal(clampSize(400, 900, b), 400);
  assert.equal(clampSize(50, 900, b), b.min);
  assert.equal(clampSize(880, 900, b), 900 - b.keepChart);
  assert.equal(clampSize(500, 200, b), b.min); // tiny window: never below the minimum
  assert.equal(clampSize(300.6, 1400, LIMITS.side), 301); // rounds to whole pixels
  assert.equal(clampSize(200, 1400, LIMITS.side), LIMITS.side.min);
});
