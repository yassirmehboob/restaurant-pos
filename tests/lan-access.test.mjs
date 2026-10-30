import assert from "node:assert/strict";
import test from "node:test";
import { secureCookies } from "../lib/env.ts";
import { randomId } from "../lib/random-id.ts";

const withEnv = (vars, run) => {
  const saved = Object.fromEntries(Object.keys(vars).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(vars)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  try { return run(); } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
};

test("login cookies are HTTPS-only in production unless a plain-http LAN server opts out", () => {
  assert.equal(withEnv({ NODE_ENV: "production", COOKIE_SECURE: undefined }, secureCookies), true);
  assert.equal(withEnv({ NODE_ENV: "production", COOKIE_SECURE: "false" }, secureCookies), false);
  assert.equal(withEnv({ NODE_ENV: "production", COOKIE_SECURE: "true" }, secureCookies), true);
  assert.equal(withEnv({ NODE_ENV: "development", COOKIE_SECURE: undefined }, secureCookies), false);
});

test("random ids work on plain-http pages where crypto.randomUUID is missing", () => {
  const original = crypto.randomUUID;
  Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true, writable: true });
  try {
    const ids = new Set(Array.from({ length: 500 }, randomId));
    assert.equal(ids.size, 500);
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally { Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true, writable: true }); }
  assert.match(randomId(), /^[0-9a-f-]{36}$/);
});
