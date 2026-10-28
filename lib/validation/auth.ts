import { z } from "zod";
import { passwordSchema as password } from "@/lib/validation/password";
const username=z.string().trim().toLowerCase().min(3,"Use at least 3 characters").max(40).regex(/^[a-z0-9._-]+$/,"Use letters, numbers, dots, dashes, or underscores only");
export const registrationSchema=z.object({businessName:z.string().trim().min(2,"Enter the restaurant name").max(120),fullName:z.string().trim().min(2,"Enter your full name").max(100),username,password});
export const loginSchema=z.object({username,password});
