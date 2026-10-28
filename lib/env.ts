import "server-only";
import { z } from "zod";
const envSchema = z.object({ MONGODB_URI: z.string().min(1), AUTH_SECRET: z.string().min(32).refine(value=>!/(replace-with|change-?me|your-secret|example-secret)/i.test(value),"Use a randomly generated AUTH_SECRET, not the example value.") });
let cachedEnv: z.infer<typeof envSchema> | undefined;
export function env() {
  cachedEnv ??= envSchema.parse({ MONGODB_URI: process.env.MONGODB_URI, AUTH_SECRET: process.env.AUTH_SECRET });
  return cachedEnv;
}
