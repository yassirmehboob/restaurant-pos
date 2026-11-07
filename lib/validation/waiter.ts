import { z } from "zod";
import { orderInputSchema, orderIdSchema } from "@/lib/validation/order";

export const waiterRequestSchema = z.object({
  id: orderIdSchema.optional(),
  revision: z.number().int().min(0),
  submissionKey: z.string().uuid(),
  input: orderInputSchema,
}).superRefine(({ input }, ctx) => {
  // Waiter orders are dine-in; the table is optional (for example a guest waiting at the counter).
  if (input.orderType !== "DINE_IN")
    ctx.addIssue({ code: "custom", path: ["input", "orderType"], message: "Waiter orders are dine-in only." });
});
