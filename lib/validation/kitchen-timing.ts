import { z } from "zod";
export const kitchenTimingSchema=z.object({enabled:z.boolean(),preparingSeconds:z.number().int().min(1).max(3600),readyMinutes:z.number().int().min(1).max(1440)});
