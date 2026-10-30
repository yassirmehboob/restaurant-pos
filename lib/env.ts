import "server-only";
import { z } from "zod";
const envSchema = z.object({ MONGODB_URI: z.string().min(1), AUTH_SECRET: z.string().min(32).refine(value=>!/(replace-with|change-?me|your-secret|example-secret)/i.test(value),"Use a randomly generated AUTH_SECRET, not the example value.") });
let cachedEnv: z.infer<typeof envSchema> | undefined;
export function env() {
  cachedEnv ??= envSchema.parse({ MONGODB_URI: process.env.MONGODB_URI, AUTH_SECRET: process.env.AUTH_SECRET });
  return cachedEnv;
}
// HTTPS-only cookies in production; COOKIE_SECURE=false lets a plain-http LAN server keep logins.
export const secureCookies = () => process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE !== "false" : process.env.NODE_ENV === "production";
