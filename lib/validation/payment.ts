import { z } from "zod";
import { discountInputSchema } from "@/lib/invoice-discount";
const amount = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER / 100)
  .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.0001, "Use at most two decimal places.");
export const paymentInputSchema = z.object({
  idempotencyKey: z.string().uuid(),
  method: z.enum(["CASH", "CARD", "BANK", "OTHER"]),
  expectedGrandTotal: amount,
  tenderedAmount: amount.refine(value => value > 0, "Payment must be greater than zero."),
  reference: z.string().trim().max(100), notes: z.string().trim().max(300),
  discount: discountInputSchema.optional(),
});
