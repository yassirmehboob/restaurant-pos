import assert from "node:assert/strict";
import test from "node:test";
import { dateISO, formatDate, formatDateTime, isISODate, parseDisplayDate } from "../lib/dates.ts";

test("all dates display as DD/MM/YYYY without changing stored business dates", () => {
  assert.equal(formatDate("2026-01-31"), "31/01/2026");
  assert.equal(formatDate("2026-02-01"), "01/02/2026");
  assert.equal(parseDisplayDate("31/01/2026"), "2026-01-31");
  assert.equal(dateISO("2026-01-31"), "2026-01-31");
});

test("typed dates reject impossible days and accept leap days", () => {
  for (const value of ["31/02/2026", "29/02/2026", "01/31/2026", "2026-01-31", "1/1/2026"]) assert.equal(parseDisplayDate(value), "");
  assert.equal(parseDisplayDate("29/02/2028"), "2028-02-29");
  assert.equal(isISODate("2026-02-30"), false);
});

test("timestamps use the restaurant timezone across midnight and year boundaries", () => {
  assert.equal(formatDateTime("2025-12-31T20:05:00Z"), "01/01/2026 01:05 AM");
  assert.equal(formatDate("2026-01-31T20:00:00Z"), "01/02/2026");
  assert.equal(formatDate(null), "—");
  assert.equal(formatDateTime("invalid"), "—");
});

test("time displays use 12 hours with uppercase AM/PM, including midnight and noon", () => {
  assert.equal(formatDateTime("2026-10-17T00:00:00+05:00"), "17/10/2026 12:00 AM");
  assert.equal(formatDateTime("2026-10-17T12:00:00+05:00"), "17/10/2026 12:00 PM");
  assert.equal(formatDateTime("2026-10-17T14:35:00+05:00"), "17/10/2026 02:35 PM");
  assert.equal(formatDateTime("2026-10-17T23:59:00+05:00"), "17/10/2026 11:59 PM");
});
