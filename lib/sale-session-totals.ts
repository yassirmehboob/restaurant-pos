export type SessionEntry = { amount: number; method: string };
export type SessionTotals = {
  sales: number; expenses: number; cashSales: number; cashExpenses: number;
  balance: number; expectedCash: number; paymentCount: number; expenseCount: number;
};

export const cents = (amount: number) => Math.round((amount + Number.EPSILON) * 100);
export const uncollectedTotal = (orders: { dueAmount: number }[]) => orders.reduce((total, order) => total + cents(order.dueAmount), 0) / 100;
export function calculateSessionTotals(openingBalance: number, payments: SessionEntry[], expenses: SessionEntry[]): SessionTotals {
  const sum = (rows: SessionEntry[], cashOnly = false) => rows.reduce((total, row) => total + ((!cashOnly || row.method === "CASH") ? cents(row.amount) : 0), 0);
  const sales = sum(payments), costs = sum(expenses), cashSales = sum(payments, true), cashExpenses = sum(expenses, true);
  return { sales: sales / 100, expenses: costs / 100, cashSales: cashSales / 100, cashExpenses: cashExpenses / 100,
    balance: (cents(openingBalance) + sales - costs) / 100,
    expectedCash: (cents(openingBalance) + cashSales - cashExpenses) / 100,
    paymentCount: payments.length, expenseCount: expenses.length };
}
