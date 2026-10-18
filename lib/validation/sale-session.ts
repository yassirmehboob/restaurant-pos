import { z } from "zod";

export const startSaleSchema = z.object({
  saleDate: z.iso.date("Choose a valid sale date."),
  counterName: z.string().trim().min(1, "Enter a counter name.").max(60),
  openingBalance: z.preprocess(value => value === "" || value === null ? NaN : Number(value), z.number().min(0).max(999999999).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.0001, "Use at most two decimal places.")),
});
