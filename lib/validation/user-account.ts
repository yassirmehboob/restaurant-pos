import { z } from "zod";
import { PRIVILEGE_KEYS } from "@/lib/permissions";
import { passwordSchema } from "@/lib/validation/password";
import { USER_ROLES } from "@/lib/roles";
export const userAccountSchema=z.object({
 fullName:z.string().trim().min(2,"Enter the user's name.").max(100),
 phone:z.string().trim().min(7,"Enter a valid mobile number.").max(25).regex(/^[+0-9 ()-]+$/,"Enter a valid mobile number."),
 username:z.string().trim().toLowerCase().min(3).max(40).regex(/^[a-z0-9._-]+$/,"Use letters, numbers, dots, dashes or underscores."),
 role:z.enum(USER_ROLES),
 password:z.union([z.literal(""),passwordSchema]),
 isActive:z.boolean(),privileges:z.array(z.enum(PRIVILEGE_KEYS)).max(PRIVILEGE_KEYS.length)
});
/** The acting owner's own credentials, required for sensitive changes. */
export const ownerConfirmationSchema=z.object({currentPassword:z.string().max(72).optional(),twoFactorCode:z.string().trim().max(64).optional()});
export const ownerProfileSchema=userAccountSchema.pick({fullName:true,phone:true,username:true,password:true}).extend(ownerConfirmationSchema.shape);
