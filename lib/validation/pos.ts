import { z } from "zod";
import { MAX_WEIGHT_GRAMS,MIN_WEIGHT_GRAMS } from "@/lib/weight";

const objectId=z.string().regex(/^[a-f\d]{24}$/i);
export const posPreviewSchema=z.object({
  paymentMethod:z.enum(["CASH","CARD","BANK","OTHER"]).default("CASH"),
  lines:z.array(z.object({kind:z.enum(["PRODUCT","DEAL"]),id:objectId,variantName:z.string().trim().max(40).optional(),weightGrams:z.number().int().min(MIN_WEIGHT_GRAMS,"The smallest weight is 125 g.").max(MAX_WEIGHT_GRAMS).optional(),quantity:z.number().int().min(1).max(99)})).max(100),
  deliveryCharge:z.number().min(0).max(1000000).default(0),
});

export type PosPreviewInput=z.infer<typeof posPreviewSchema>;
