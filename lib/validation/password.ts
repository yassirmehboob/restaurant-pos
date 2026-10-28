import { z } from "zod";
// bcrypt ignores bytes after the 72nd; reject them rather than accept collisions.
export const passwordSchema = z.string().min(8, "Use at least 8 characters.").max(72, "Password must be at most 72 characters.")
  .refine(value => new TextEncoder().encode(value).length <= 72, "Password must be at most 72 bytes.");
