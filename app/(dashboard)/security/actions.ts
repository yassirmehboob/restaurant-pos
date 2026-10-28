"use server";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/data/auth";
import { User } from "@/models/User";
import { env } from "@/lib/env";
import { createSession } from "@/lib/auth/session";
import { allowAuthAttempt, consumeSecondFactor } from "@/lib/auth/two-factor";
import { decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes, generateTotpSecret, recoveryCodeHash, totpSetupUri, verifyTotp } from "@/lib/auth/totp";
import { writeAuditLog } from "@/lib/audit";

const passwordSchema = z.string().min(8).max(128);
const codeSchema = z.string().trim().min(1).max(64);
async function accountWithPassword(password: string) {
  const current = await requireUser();
  if (!passwordSchema.safeParse(password).success) throw new Error("Enter your current password.");
  if (!(await allowAuthAttempt("security:" + current.id))) throw new Error("Too many attempts. Wait five minutes and try again.");
  const account = await User.findOne({ _id: current.id, businessId: current.businessId, isActive: true })
    .select("+passwordHash +twoFactorSecret +twoFactorPendingSecret +twoFactorPendingExpiresAt +twoFactorLastStep +twoFactorRecoveryHashes");
  if (!account || !(await bcrypt.compare(password, account.passwordHash))) throw new Error("Your current password is incorrect.");
  return { current, account };
}
export async function beginTwoFactorSetup(password: string) {
  try {
    const { current, account } = await accountWithPassword(password);
    if (account.twoFactorEnabled) throw new Error("Two-factor authentication is already enabled.");
    const secret = generateTotpSecret(), pending = encryptTotpSecret(secret, env().AUTH_SECRET, current.id);
    const qrCodeDataUrl = await QRCode.toDataURL(totpSetupUri(secret, current.username), { width: 256, margin: 4, errorCorrectionLevel: "M" });
    const result = await User.updateOne({ _id: account._id, isActive: true, twoFactorEnabled: { $ne: true }, passwordHash: account.passwordHash }, {
      $set: { twoFactorPendingSecret: pending, twoFactorPendingExpiresAt: new Date(Date.now() + 600000) },
    });
    if (!result.modifiedCount) throw new Error("Your account changed. Start setup again.");
    return { ok: true as const, secret, qrCodeDataUrl, accountName: `Restaurant POS (${current.username})` };
  } catch (error) { return { ok: false as const, message: error instanceof Error ? error.message : "Could not start setup." }; }
}
export async function enableTwoFactor(password: string, inputCode: string) {
  try {
    const { current, account } = await accountWithPassword(password), code = codeSchema.parse(inputCode);
    if (account.twoFactorEnabled || !account.twoFactorPendingSecret || !account.twoFactorPendingExpiresAt || account.twoFactorPendingExpiresAt.getTime() <= Date.now()) throw new Error("Setup expired. Start setup again.");
    const secret = decryptTotpSecret(account.twoFactorPendingSecret, env().AUTH_SECRET, current.id), step = verifyTotp(secret, code);
    if (step === null) throw new Error("The authenticator code is incorrect. Try a fresh code.");
    const recoveryCodes = generateRecoveryCodes();
    const saved = await User.findOneAndUpdate({ _id: account._id, isActive: true, twoFactorEnabled: { $ne: true }, passwordHash: account.passwordHash, twoFactorPendingSecret: account.twoFactorPendingSecret, twoFactorPendingExpiresAt: { $gt: new Date() } }, {
      $set: { twoFactorEnabled: true, twoFactorSecret: account.twoFactorPendingSecret, twoFactorLastStep: step, twoFactorRecoveryHashes: recoveryCodes.map(recoveryCodeHash) },
      $unset: { twoFactorPendingSecret: 1, twoFactorPendingExpiresAt: 1 }, $inc: { authVersion: 1 },
    }, { returnDocument: "after" });
    if (!saved) throw new Error("Your account changed. Start setup again.");
    await createSession({ userId: current.id, businessId: current.businessId, role: saved.role, authVersion: saved.authVersion });
    await writeAuditLog({ businessId: current.businessId, userId: current.id, userName: current.fullName, action: "ENABLE_TWO_FACTOR", entityType: "User", entityId: current.id, description: "Enabled two-factor authentication" });
    revalidatePath("/security"); return { ok: true as const, recoveryCodes };
  } catch (error) { return { ok: false as const, message: error instanceof Error ? error.message : "Could not enable two-factor authentication." }; }
}
export async function disableTwoFactor(password: string, inputCode: string) {
  try {
    const { current, account } = await accountWithPassword(password), code = codeSchema.parse(inputCode);
    if (!account.twoFactorEnabled || !(await consumeSecondFactor(account, code))) throw new Error("Invalid or already used verification code. Try a fresh code.");
    const saved = await User.findOneAndUpdate({ _id: account._id, isActive: true, twoFactorEnabled: true, passwordHash: account.passwordHash, authVersion: account.authVersion }, {
      $set: { twoFactorEnabled: false }, $unset: { twoFactorSecret: 1, twoFactorRecoveryHashes: 1, twoFactorLastStep: 1, twoFactorPendingSecret: 1, twoFactorPendingExpiresAt: 1 }, $inc: { authVersion: 1 },
    }, { returnDocument: "after" });
    if (!saved) throw new Error("Your account changed. Please refresh and try again.");
    await createSession({ userId: current.id, businessId: current.businessId, role: saved.role, authVersion: saved.authVersion });
    await writeAuditLog({ businessId: current.businessId, userId: current.id, userName: current.fullName, action: "DISABLE_TWO_FACTOR", entityType: "User", entityId: current.id, description: "Disabled two-factor authentication" });
    revalidatePath("/security"); return { ok: true as const };
  } catch (error) { return { ok: false as const, message: error instanceof Error ? error.message : "Could not disable two-factor authentication." }; }
}
