import assert from "node:assert/strict";
import test from "node:test";
import { amountInWords, caretAfterFormatting, groupAmount, normalizeAmount } from "../lib/amount-format.ts";

test("typed or pasted amounts become plain numbers", () => {
  for (const [typed, expected] of [["", ""], ["125000", "125000"], ["125,000", "125000"], ["1,25,000", "125000"], ["Rs 5000", "5000"], ["007", "7"], ["0", "0"], ["00", "0"], [".", "0."], [".5", "0.5"], ["12.", "12."], ["12.345", "12.34"], ["1.2.3", "1.23"], ["abc", ""]])
    assert.equal(normalizeAmount(typed), expected, typed);
});

test("amounts are grouped in thousands, keeping decimals as typed", () => {
  for (const [amount, expected] of [["", ""], ["999", "999"], ["1000", "1,000"], ["100000", "100,000"], ["999999999", "999,999,999"], ["1234.", "1,234."], ["1234.5", "1,234.5"], ["0.50", "0.50"]])
    assert.equal(groupAmount(amount), expected, amount);
});

test("amounts read in rupees, lakh and crore", () => {
  for (const [amount, expected] of [
    ["0", "Zero rupees"], ["1", "One rupee"], ["21", "Twenty-one rupees"], ["500", "Five hundred rupees"],
    ["1000", "One thousand rupees"], ["5050", "Five thousand fifty rupees"], ["100000", "One lakh rupees"],
    ["125000", "One lakh twenty-five thousand rupees"], ["1000000", "Ten lakh rupees"], ["10000000", "One crore rupees"],
    ["999999999", "Ninety-nine crore ninety-nine lakh ninety-nine thousand nine hundred ninety-nine rupees"],
    ["12.5", "Twelve rupees and fifty paisa"], ["12.05", "Twelve rupees and five paisa"], ["12.", "Twelve rupees"], ["0.75", "Zero rupees and seventy-five paisa"],
  ]) assert.equal(amountInWords(amount), expected, amount);
});

test("the caret stays after the same digit when commas appear or move", () => {
  assert.equal(caretAfterFormatting("1,000", 4), 5);
  assert.equal(caretAfterFormatting("1,000", 1), 1);
  assert.equal(caretAfterFormatting("1,000", 2), 3);
  assert.equal(caretAfterFormatting("1,000", 0), 0);
  assert.equal(caretAfterFormatting("1,234.5", 6), 7);
});
