export const USER_ROLES = ["OWNER", "ADMIN", "CASHIER", "WAITER", "KITCHEN"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export function hasRole(role: UserRole, allowed: readonly UserRole[]) { return allowed.includes(role); }
