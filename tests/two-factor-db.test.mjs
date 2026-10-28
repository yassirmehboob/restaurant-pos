import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { User } from "../models/User.ts";
import { AuthThrottle } from "../models/AuthThrottle.ts";
import { allowAuthAttempt, consumeSecondFactor } from "../lib/auth/two-factor.ts";
import { generateTotpSecret, encryptTotpSecret, totpAtStep, generateRecoveryCodes, recoveryCodeHash } from "../lib/auth/totp.ts";

test("2FA database enforces single-use factors and shared attempt limits", { skip: !process.env.MONGODB_URI || !process.env.AUTH_SECRET }, async () => {
  const dbName = "restaurant_pos_2fa_test_" + randomUUID().replaceAll("-", "");
  await mongoose.connect(process.env.MONGODB_URI, { dbName, serverSelectionTimeoutMS: 5000 });
  try {
    await User.init(); await AuthThrottle.init();
    const userId = new mongoose.Types.ObjectId(), secret = generateTotpSecret(), recovery = generateRecoveryCodes();
    await User.create({ _id: userId, businessId: new mongoose.Types.ObjectId(), fullName: "Test cashier", username: "test.2fa", passwordHash: "test-only", role: "CASHIER", authVersion: 1, twoFactorEnabled: true, twoFactorSecret: encryptTotpSecret(secret, process.env.AUTH_SECRET, String(userId)), twoFactorRecoveryHashes: recovery.map(recoveryCodeHash) });
    const visible = await User.findById(userId).lean();
    assert.equal(visible.twoFactorSecret, undefined); assert.equal(visible.twoFactorRecoveryHashes, undefined);
    const user = await User.findById(userId).select("+twoFactorSecret +twoFactorLastStep +twoFactorRecoveryHashes");
    const code = totpAtStep(secret, Math.floor(Date.now() / 30000));
    const outcomes = await Promise.all([consumeSecondFactor(user, code), consumeSecondFactor(user, code)]);
    assert.equal(outcomes.filter(Boolean).length, 1);
    assert.equal(await consumeSecondFactor(user, code), false);
    const recoveries = await Promise.all([consumeSecondFactor(user, recovery[0]), consumeSecondFactor(user, recovery[0])]);
    assert.equal(recoveries.filter(Boolean).length, 1);
    assert.equal(await consumeSecondFactor(user, recovery[0]), false);
    const saved = await User.findById(userId).select("+twoFactorRecoveryHashes");
    assert.equal(saved.twoFactorRecoveryHashes.length, 7);
    const scope = "test:" + randomUUID();
    for (let i = 0; i < 10; i++) assert.equal(await allowAuthAttempt(scope), true);
    assert.equal(await allowAuthAttempt(scope), false);
    assert.equal(await allowAuthAttempt(scope + ":other"), true);
  } finally {
    assert.match(mongoose.connection.name, /^restaurant_pos_2fa_test_[a-f0-9]+$/);
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
  }
});
