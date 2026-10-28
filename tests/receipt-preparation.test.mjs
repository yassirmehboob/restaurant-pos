import assert from "node:assert/strict";
import test from "node:test";
import { maxPreparationMinutes, readyTimeMessage } from "../lib/preparation-time.ts";

test("receipt uses the longest configured preparation time, not the sum", () => {
  assert.equal(maxPreparationMinutes([15, 25, null, undefined]), 25);
  assert.equal(maxPreparationMinutes([15, maxPreparationMinutes([20, 45])]), 45);
  assert.equal(maxPreparationMinutes([null, undefined, 0, -1, NaN, Infinity]), null);
});

test("ready time prints only when enabled and a preparation time exists", () => {
  assert.equal(readyTimeMessage(false, 25), null);
  assert.equal(readyTimeMessage(true, null), null);
  assert.equal(readyTimeMessage(true, 0), null);
  assert.equal(readyTimeMessage(true, 1), "Your order will be ready in 1 minute.");
  assert.equal(readyTimeMessage(true, 25), "Your order will be ready in 25 minutes.");
  assert.equal(readyTimeMessage(true, 60), "Your order will be ready in 1 hour.");
  assert.equal(readyTimeMessage(true, 90), "Your order will be ready in 1 hour 30 minutes.");
  assert.equal(readyTimeMessage(true, 120), "Your order will be ready in 2 hours.");
});
