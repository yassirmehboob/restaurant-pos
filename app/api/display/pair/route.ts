import { randomBytes, randomInt } from "node:crypto";
import { connectToDatabase } from "@/lib/db";
import { allowAuthAttempt } from "@/lib/auth/two-factor";
import { hashSecret } from "@/lib/signage-server";
import { SignagePairing } from "@/models/SignagePairing";

const PAIRING_MINUTES = 15;
const noStore = { "Cache-Control": "no-store" };
const clientAddress = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";

// A TV asks for a 6-digit code to show on screen. The secret proves it is the same TV when it collects its key.
export async function POST(request: Request) {
  await connectToDatabase();
  if (!(await allowAuthAttempt("display-pair:" + clientAddress(request), 30))) return Response.json({ message: "Too many requests. Wait five minutes." }, { status: 429, headers: noStore });
  const secret = randomBytes(32).toString("base64url"), expiresAt = new Date(Date.now() + PAIRING_MINUTES * 60000);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = String(randomInt(100000, 1000000));
    try {
      const pairing = await SignagePairing.create({ code, secretHash: hashSecret(secret), expiresAt });
      return Response.json({ id: String(pairing._id), code, secret, expiresAt: expiresAt.toISOString() }, { headers: noStore });
    } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
  }
  return Response.json({ message: "Could not create a code. Try again." }, { status: 503, headers: noStore });
}

// The TV checks until the owner has entered its code; the access key is handed over once, then deleted.
export async function GET(request: Request) {
  const url = new URL(request.url), id = url.searchParams.get("id") ?? "", secret = url.searchParams.get("secret") ?? "";
  if (!/^[a-f\d]{24}$/i.test(id) || !/^[\w-]{43}$/.test(secret)) return Response.json({ status: "EXPIRED" }, { status: 404, headers: noStore });
  await connectToDatabase();
  const pairing = await SignagePairing.findOne({ _id: id, secretHash: hashSecret(secret), expiresAt: { $gt: new Date() } }).lean();
  if (!pairing) return Response.json({ status: "EXPIRED" }, { status: 404, headers: noStore });
  if (pairing.status !== "APPROVED" || !pairing.token) return Response.json({ status: "PENDING" }, { headers: noStore });
  const claimed = await SignagePairing.findOneAndDelete({ _id: pairing._id, status: "APPROVED" }).lean();
  if (!claimed?.token) return Response.json({ status: "EXPIRED" }, { status: 404, headers: noStore });
  return Response.json({ status: "PAIRED", token: claimed.token }, { headers: noStore });
}
