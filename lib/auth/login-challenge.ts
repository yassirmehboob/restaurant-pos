import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

const COOKIE_NAME = "restaurant_pos_login_challenge";
const secretKey = () => new TextEncoder().encode(env().AUTH_SECRET);
const credentialFingerprint = (passwordHash: string) => createHash("sha256").update(passwordHash).digest("hex");
type ChallengeUser = { _id: unknown; passwordHash: string; authVersion?: number };

export async function createLoginChallenge(user: ChallengeUser) {
  const token = await new SignJWT({ credential: credentialFingerprint(user.passwordHash), authVersion: user.authVersion ?? 0 })
    .setProtectedHeader({ alg: "HS256" }).setSubject(String(user._id)).setAudience("restaurant-pos:login-2fa")
    .setJti(randomUUID()).setIssuedAt().setExpirationTime("5m").sign(secretKey());
  (await cookies()).set(COOKIE_NAME, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/login", maxAge: 300 });
}

export async function readLoginChallenge() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"], audience: "restaurant-pos:login-2fa" });
    if (typeof payload.sub !== "string" || !/^[a-f\d]{24}$/i.test(payload.sub) || typeof payload.credential !== "string" || !Number.isSafeInteger(payload.authVersion) || Number(payload.authVersion) < 0) return null;
    return { userId: payload.sub, credential: payload.credential, authVersion: Number(payload.authVersion) };
  } catch { return null; }
}

export function matchesLoginChallenge(challenge: NonNullable<Awaited<ReturnType<typeof readLoginChallenge>>>, user: ChallengeUser) {
  return challenge.userId === String(user._id) && challenge.authVersion === (user.authVersion ?? 0) && challenge.credential === credentialFingerprint(user.passwordHash);
}

export async function clearLoginChallenge() {
  (await cookies()).set(COOKIE_NAME, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/login", maxAge: 0 });
}
