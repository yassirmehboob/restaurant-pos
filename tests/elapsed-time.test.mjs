import assert from "node:assert/strict";
import test from "node:test";
import { formatElapsedTime } from "../lib/elapsed-time.ts";

test("elapsed time scales from minutes to hours, days and months", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  for (const [minutes, expected] of [
    [0, "Just now"], [1, "1 minute"], [59, "59 minutes"],
    [60, "1 hour"], [61, "1 hour 1 minute"], [1439, "23 hours 59 minutes"],
    [1440, "1 day"], [1500, "1 day 1 hour"], [43200, "1 month"],
    [44640, "1 month 1 day"], [1870 * 60 + 48, "2 months 17 days"],
  ]) {
    assert.equal(formatElapsedTime(new Date(now - minutes * 60000).toISOString(), now), expected);
  }
  assert.equal(formatElapsedTime("invalid", now), "Just now");
  assert.equal(formatElapsedTime(new Date(now + 60000).toISOString(), now), "Just now");
});
