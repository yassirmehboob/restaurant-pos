import "server-only";
import { z } from "zod";
const envSchema = z.object({ MONGODB_URI: z.string().min(1), AUTH_SECRET: z.string().min(32) });
let cachedEnv: z.infer<typeof envSchema> | undefined;
export function env() {
  cachedEnv ??= envSchema.parse({ MONGODB_URI: process.env.MONGODB_URI, AUTH_SECRET: process.env.AUTH_SECRET });
  return cachedEnv;
}
