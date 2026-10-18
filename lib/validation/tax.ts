import { z } from "zod";
const rate=z.number().finite().min(0).max(100);
export const businessTaxSchema=z.object({rate,overrides:z.object({CASH:rate.nullable(),CARD:rate.nullable(),BANK:rate.nullable(),OTHER:rate.nullable()})});
