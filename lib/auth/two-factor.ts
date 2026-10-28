import "server-only";
import { createHash } from "node:crypto";
import { AuthThrottle } from "@/models/AuthThrottle";
import { User } from "@/models/User";
import { env } from "@/lib/env";
import { decryptTotpSecret, recoveryCodeHash, verifyTotp } from "@/lib/auth/totp";

// Database-backed limit applies across app processes and server restarts.
export async function allowAuthAttempt(scope: string) {
  const window = Math.floor(Date.now() / 300000);
  const id = createHash("sha256").update(`${scope}:${window}`).digest("hex");
  const row = await AuthThrottle.findOneAndUpdate({ _id: id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 2) * 300000) } }, { upsert: true, returnDocument: "after" });
  return row.count <= 10;
}

type FactorUser = { _id: unknown; businessId: unknown; authVersion?: number; twoFactorSecret?: string; twoFactorLastStep?: number; twoFactorRecoveryHashes?: string[] };
export async function consumeSecondFactor(user: FactorUser, code: string) {
  const filter = { _id: user._id, businessId: user.businessId, isActive: true, twoFactorEnabled: true, authVersion: user.authVersion ?? 0, twoFactorSecret: user.twoFactorSecret };
  if (!user.twoFactorSecret) return false;
  if (/^\d{6}$/.test(code)) {
    const secret = decryptTotpSecret(user.twoFactorSecret, env().AUTH_SECRET, String(user._id));
    const step = verifyTotp(secret, code, user.twoFactorLastStep ?? -1);
    if (step === null) return false;
    const result = await User.updateOne({ ...filter, $or: [{ twoFactorLastStep: { $lt: step } }, { twoFactorLastStep: { $exists: false } }] }, { $set: { twoFactorLastStep: step } });
    return result.modifiedCount === 1;
  }
  const hash = recoveryCodeHash(code);
  if (!hash || !user.twoFactorRecoveryHashes?.includes(hash)) return false;
  const result = await User.updateOne({ ...filter, twoFactorRecoveryHashes: hash }, { $pull: { twoFactorRecoveryHashes: hash } });
  return result.modifiedCount === 1;
}
