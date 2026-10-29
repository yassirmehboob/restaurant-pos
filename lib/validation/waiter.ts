import { z } from "zod";
import { orderInputSchema, orderIdSchema } from "@/lib/validation/order";

export const waiterRequestSchema = z.object({
  id: orderIdSchema.optional(),
  revision: z.number().int().min(0),
  submissionKey: z.string().uuid(),
  input: orderInputSchema,
}).superRefine(({ input }, ctx) => {
  if (input.orderType !== "DINE_IN" || !input.tableId)
    ctx.addIssue({ code: "custom", path: ["input", "tableId"], message: "Select a table for this order." });
});
