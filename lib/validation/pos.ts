import { z } from "zod";

const objectId=z.string().regex(/^[a-f\d]{24}$/i);
export const posPreviewSchema=z.object({
  paymentMethod:z.enum(["CASH","CARD","BANK","OTHER"]).default("CASH"),
  lines:z.array(z.object({kind:z.enum(["PRODUCT","DEAL"]),id:objectId,variantName:z.string().trim().max(40).optional(),quantity:z.number().int().min(1).max(99)})).max(100),
  deliveryCharge:z.number().min(0).max(1000000).default(0),
});

export type PosPreviewInput=z.infer<typeof posPreviewSchema>;
