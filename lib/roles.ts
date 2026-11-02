export const USER_ROLES = ["OWNER", "ADMIN", "MANAGER", "SUPERVISOR", "CASHIER", "WAITER", "KITCHEN", "CHEF"] as const;
export type UserRole = (typeof USER_ROLES)[number];
/** Roles that run a counter: confirm waiter orders and create backups (still gated by privileges). */
export const COUNTER_ROLES: readonly UserRole[] = ["OWNER", "ADMIN", "MANAGER", "SUPERVISOR", "CASHIER"];
/** Roles that see every account's shift history, not only their own. */
export const SHIFT_MANAGER_ROLES: readonly UserRole[] = ["OWNER", "ADMIN", "MANAGER"];
export function hasRole(role: UserRole, allowed: readonly UserRole[]) { return allowed.includes(role); }
/** Staff records (Staff page). These people do not need a login, e.g. cleaners. */
export const STAFF_ROLES = ["MANAGER", "SUPERVISOR", "CASHIER", "WAITER", "CHEF", "KITCHEN", "CLEANER", "OTHER"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = { MANAGER: "Manager", SUPERVISOR: "Supervisor", CASHIER: "Cashier", WAITER: "Waiter", CHEF: "Chef", KITCHEN: "Kitchen", CLEANER: "Cleaner", OTHER: "Other" };
