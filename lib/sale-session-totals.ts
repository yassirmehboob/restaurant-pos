export type SessionEntry = { amount: number; method: string };
export type SessionTotals = {
  sales: number; expenses: number; cashSales: number; cashExpenses: number;
  balance: number; expectedCash: number; paymentCount: number; expenseCount: number;
  reversals: number; cashReversals: number; reversalCount: number;
  // Discounts on the orders this shift collected: coupons and each invoice discount type.
  discounts?: number; couponDiscounts?: number; couponCount?: number; invoiceDiscounts?: DiscountLine[];
};
export type DiscountLine = { name: string; amount: number; count: number };
// discountAmount holds the coupon discount plus the invoice discount, so the coupon part is what is left after the invoice one.
export type DiscountedOrder = { discountAmount?: number | null; invoiceDiscount?: { name?: string | null; amount?: number | null } | null };

export const cents = (amount: number) => Math.round((amount + Number.EPSILON) * 100);
export const uncollectedTotal = (orders: { dueAmount: number }[]) => orders.reduce((total, order) => total + cents(order.dueAmount), 0) / 100;
// Sales are net of reversals: money handed back from this drawer, whichever shift first took it.
export function sessionDiscounts(orders: DiscountedOrder[]) {
  let coupons = 0, couponCount = 0;
  const byName = new Map<string, { amount: number; count: number }>();
  for (const order of orders) {
    const invoice = Math.max(0, cents(order.invoiceDiscount?.amount ?? 0)), coupon = Math.max(0, cents(order.discountAmount ?? 0) - invoice);
    if (coupon > 0) { coupons += coupon; couponCount++; }
    if (invoice > 0) { const name = order.invoiceDiscount?.name?.trim() || "Discount", row = byName.get(name) ?? { amount: 0, count: 0 }; row.amount += invoice; row.count++; byName.set(name, row); }
  }
  const invoiceDiscounts = [...byName].map(([name, row]) => ({ name, amount: row.amount / 100, count: row.count })).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  const invoiceTotal = [...byName.values()].reduce((total, row) => total + row.amount, 0);
  return { discounts: (coupons + invoiceTotal) / 100, couponDiscounts: coupons / 100, couponCount, invoiceDiscounts };
}

export function calculateSessionTotals(openingBalance: number, payments: SessionEntry[], expenses: SessionEntry[], reversed: SessionEntry[] = [], discounted: DiscountedOrder[] = []): SessionTotals {
  const sum = (rows: SessionEntry[], cashOnly = false) => rows.reduce((total, row) => total + ((!cashOnly || row.method === "CASH") ? cents(row.amount) : 0), 0);
  const reversals = sum(reversed), cashReversals = sum(reversed, true);
  const sales = sum(payments) - reversals, costs = sum(expenses), cashSales = sum(payments, true) - cashReversals, cashExpenses = sum(expenses, true);
  return { sales: sales / 100, expenses: costs / 100, cashSales: cashSales / 100, cashExpenses: cashExpenses / 100,
    balance: (cents(openingBalance) + sales - costs) / 100,
    expectedCash: (cents(openingBalance) + cashSales - cashExpenses) / 100,
    paymentCount: payments.length, expenseCount: expenses.length,
    reversals: reversals / 100, cashReversals: cashReversals / 100, reversalCount: reversed.length, ...sessionDiscounts(discounted) };
}
