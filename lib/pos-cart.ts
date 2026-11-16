export const CART_INCREASE_MODES = ["SAME_LINE", "NEW_LINE"] as const;
export type CartIncreaseMode = (typeof CART_INCREASE_MODES)[number];
export const cartIncreaseMode = (value: unknown): CartIncreaseMode => value === "NEW_LINE" ? "NEW_LINE" : "SAME_LINE";

export type CartRow = { kind: string; id: string; variantName?: string; weightGrams?: number; lineId: string; quantity: number; note: string };
export const cartItemKey = (line: Pick<CartRow, "kind" | "id" | "variantName" | "weightGrams">) => JSON.stringify([line.kind, line.id, line.variantName ?? "", line.weightGrams ?? null]);

// A saved row keeps its identity. In NEW_LINE mode, additions accumulate on a new,
// unsaved row, leaving the placed quantity intact until explicitly decreased/removed.
export function addCartRow<T extends CartRow>(rows: T[], added: T, mode: CartIncreaseMode, savedIds: ReadonlySet<string>): T[] {
  const target = rows.find(row => cartItemKey(row) === cartItemKey(added) &&
    (mode === "SAME_LINE" || (!savedIds.has(row.lineId) && row.note === added.note && row.quantity + added.quantity <= 99)));
  return target ? rows.map(row => row === target ? { ...row, quantity: Math.min(99, row.quantity + added.quantity) } : row) : [...rows, added];
}

export function changeCartQuantity<T extends CartRow>(rows: T[], lineId: string, change: number, mode: CartIncreaseMode, savedIds: ReadonlySet<string>, newId: string): T[] {
  const row = rows.find(item => item.lineId === lineId);
  if (!row) return rows;
  if (change > 0 && mode === "NEW_LINE" && savedIds.has(lineId)) {
    return addCartRow(rows, { ...row, lineId: newId, quantity: change }, mode, savedIds);
  }
  return rows.map(item => item === row ? { ...item, quantity: Math.max(1, Math.min(99, item.quantity + change)) } : item);
}

export const removeCartRow = <T extends CartRow>(rows: T[], lineId: string): T[] => rows.filter(row => row.lineId !== lineId);

export function changeCartWeight<T extends CartRow & { price: number; pricePerKg?: number }>(rows: T[], lineId: string, grams: number, price: number, mode: CartIncreaseMode, savedIds: ReadonlySet<string>): T[] {
  const row = rows.find(item => item.lineId === lineId);
  if (!row) return rows;
  const next = { ...row, weightGrams: grams, price };
  const target = rows.find(item => item !== row && cartItemKey(item) === cartItemKey(next) && item.quantity + row.quantity <= 99 &&
    (mode === "SAME_LINE" || (!savedIds.has(row.lineId) && !savedIds.has(item.lineId) && item.note === row.note)));
  return target ? rows.filter(item => item !== row).map(item => item === target ? { ...item, quantity: item.quantity + row.quantity } : item) : rows.map(item => item === row ? next : item);
}
