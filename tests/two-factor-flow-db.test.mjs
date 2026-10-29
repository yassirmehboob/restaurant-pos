import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "../models/User.ts";
import { Business } from "../models/Business.ts";
import { totpAtStep } from "../lib/auth/totp.ts";

// Exercise real actions and database writes with a request-local cookie jar.
const jar = new Map();
globalThis.__twoFactorTestCookies = {
  get: key => jar.has(key) ? { value: jar.get(key) } : undefined,
  set: (key, value) => jar.set(key, value),
  delete: key => jar.delete(key),
};
registerHooks({
  resolve(specifier, context, next) {
    const mocks = {
      "next/headers": "export async function cookies(){return globalThis.__twoFactorTestCookies;} export async function headers(){return new Headers();}",
      "next/navigation": "export function redirect(path){throw new Error('TEST_REDIRECT:'+path);}",
      "next/cache": "export function revalidatePath(){}",
    };
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return next(specifier, context);
  },
});

test("login and 2FA setup require both factors and revoke old sessions", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async () => {
  const dbName = "restaurant_pos_2fa_flow_test_" + randomUUID().replaceAll("-", "");
  await mongoose.connect(process.env.MONGODB_URI, { dbName, serverSelectionTimeoutMS: 5000 });
  try {
    const { loginAction, verifyLoginAction } = await import("../app/(auth)/actions.ts");
    const { beginTwoFactorSetup, enableTwoFactor, disableTwoFactor } = await import("../app/(dashboard)/security/actions.ts");
    const { createSession } = await import("../lib/auth/session.ts");
    const { getCurrentUser } = await import("../data/auth.ts");
    const business = await Business.create({ name: "2FA test restaurant" });
    const password = "test-password-123";
    const user = await User.create({ businessId: business._id, fullName: "Cashier", username: "flow.cashier", passwordHash: await bcrypt.hash(password, 12), role: "CASHIER" });
    const form = code => { const data = new FormData(); data.set("username", user.username); data.set("password", password); if (code) data.set("twoFactorCode", code); return data; };
    const cookieName = "restaurant_pos_session";
    // Accounts without 2FA continue to log in normally.
    await assert.rejects(loginAction(undefined, form()), /TEST_REDIRECT:\/dashboard/);
    const oldCookie = jar.get(cookieName); assert.ok(oldCookie);
    assert.equal((await beginTwoFactorSetup("wrong-password")).ok, false);
    const setup = await beginTwoFactorSetup(password); assert.equal(setup.ok, true);
    assert.match(setup.qrCodeDataUrl, /^data:image\/png;base64,/);
    const png = Buffer.from(setup.qrCodeDataUrl.split(",")[1], "base64");
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), 256); assert.equal(png.readUInt32BE(20), 256);
    assert.equal((await User.findById(user._id)).twoFactorEnabled, false);
    assert.equal((await enableTwoFactor(password, "invalid")).ok, false);
    const enabled = await enableTwoFactor(password, totpAtStep(setup.secret, Math.floor(Date.now() / 30000)));
    assert.equal(enabled.ok, true); assert.equal(enabled.recoveryCodes.length, 8);
    const enrolledCookie = jar.get(cookieName);
    jar.set(cookieName, oldCookie); assert.equal(await getCurrentUser(), null);
    jar.clear();
    const verifyForm = code => { const data = new FormData(); if (code) data.set("twoFactorCode", code); return data; };
    await assert.rejects(verifyLoginAction(undefined, verifyForm(enabled.recoveryCodes[0])), /TEST_REDIRECT:\/login$/);
    const wrongPassword = form(); wrongPassword.set("password", "wrong-password");
    assert.match((await loginAction(undefined, wrongPassword)).error, /incorrect/);
    assert.equal(jar.get("restaurant_pos_login_challenge"), "");
    await assert.rejects(loginAction(undefined, form()), /TEST_REDIRECT:\/login\/verify/);
    const challenge = jar.get("restaurant_pos_login_challenge");
    assert.ok(challenge);
    assert.equal(jar.has(cookieName), false);
    assert.ok((await verifyLoginAction(undefined, verifyForm())).fieldErrors.twoFactorCode);
    assert.match((await verifyLoginAction(undefined, verifyForm("0000000"))).error, /Invalid/);
    assert.equal(jar.has(cookieName), false);
    await assert.rejects(verifyLoginAction(undefined, verifyForm(enabled.recoveryCodes[0])), /TEST_REDIRECT:\/dashboard/);
    assert.equal(jar.get("restaurant_pos_login_challenge"), "");
    assert.ok(await getCurrentUser());
    jar.clear();
    await assert.rejects(loginAction(undefined, form()), /TEST_REDIRECT:\/login\/verify/);
    assert.match((await verifyLoginAction(undefined, verifyForm(enabled.recoveryCodes[0]))).error, /Invalid/);
    assert.equal(jar.has(cookieName), false);
    jar.set("restaurant_pos_login_challenge", challenge.slice(0, -8) + "tampered");
    await assert.rejects(verifyLoginAction(undefined, verifyForm(enabled.recoveryCodes[1])), /TEST_REDIRECT:\/login$/);
    jar.set("restaurant_pos_login_challenge", challenge);
    await User.updateOne({ _id: user._id }, { $inc: { authVersion: 1 } });
    await assert.rejects(verifyLoginAction(undefined, verifyForm(enabled.recoveryCodes[1])), /TEST_REDIRECT:\/login$/);
    await User.updateOne({ _id: user._id }, { $inc: { authVersion: -1 } });
    jar.set(cookieName, enrolledCookie);
    assert.equal((await disableTwoFactor(password, "invalid")).ok, false);
    assert.equal((await User.findById(user._id)).twoFactorEnabled, true);
    assert.equal((await disableTwoFactor(password, enabled.recoveryCodes[1])).ok, true);
    const stored = await User.findById(user._id).select("+twoFactorSecret +twoFactorRecoveryHashes");
    assert.equal(stored.twoFactorEnabled, false); assert.equal(stored.twoFactorSecret, undefined); assert.equal(stored.twoFactorRecoveryHashes, undefined);
    jar.set(cookieName, enrolledCookie); assert.equal(await getCurrentUser(), null);
    jar.clear();
    await assert.rejects(loginAction(undefined, form()), /TEST_REDIRECT:\/dashboard/);
    // Legacy sessions with an omitted version still work for unchanged accounts.
    const legacy = await User.create({ businessId: business._id, fullName: "Legacy", username: "legacy.cashier", passwordHash: "unused", role: "CASHIER" });
    await User.collection.updateOne({ _id: legacy._id }, { $unset: { authVersion: 1 } });
    await createSession({ userId: String(legacy._id), businessId: String(business._id), role: "CASHIER" });
    assert.equal((await getCurrentUser()).id, String(legacy._id));
  } finally {
    jar.clear();
    assert.match(mongoose.connection.name, /^restaurant_pos_2fa_flow_test_[a-f0-9]+$/);
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  }
});
