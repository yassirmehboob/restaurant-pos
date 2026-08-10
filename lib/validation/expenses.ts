import { z } from "zod";

const optionalText=z.preprocess(value=>String(value??"").trim()||undefined,z.string().max(500).optional());
export const expenseCategorySchema=z.object({name:z.string().trim().min(2,"Category name is required.").max(80),description:optionalText});
export const expenseSchema=z.object({
  categoryId:z.string().regex(/^[a-f\d]{24}$/i,"Select an expense category."),
  title:z.string().trim().min(2,"Expense title is required.").max(120),
  amount:z.coerce.number().positive("Amount must be greater than zero."),
  expenseDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/,"Select a valid date."),
  paymentMethod:z.enum(["CASH","CARD","BANK","OTHER"]),
  reference:optionalText,
  notes:optionalText,
});
