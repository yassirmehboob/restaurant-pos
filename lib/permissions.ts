import type { UserRole } from "@/lib/roles";
export const PRIVILEGES=[
 ["audit","View audit log"],["pos","Use POS / create orders"],["orders","View orders"],["edit_orders","Edit unpaid orders"],["cancel_orders","Cancel unpaid orders"],["kitchen","View kitchen / update order stages"],["payments","Receive payments"],["printing","Print invoices / kitchen slips"],["sale_sessions","Start / close own sale"],["sales","View sales history"],["reports","View sales reports / export CSV"],["profit","View profit, costs and loss"],["expenses","Manage expenses"],["catalog","Manage categories, items and deals"],["customers","Add / update customers"],["staff","Manage staff / waiters"],["tables","Manage tables"],["settings","Manage business / printing settings"]
] as const;
export type Privilege=(typeof PRIVILEGES)[number][0];
export const PRIVILEGE_KEYS=PRIVILEGES.map(([key])=>key);
export const ROLE_PRIVILEGES:Record<UserRole,readonly Privilege[]>={OWNER:PRIVILEGE_KEYS,ADMIN:PRIVILEGE_KEYS,CASHIER:["pos","orders","edit_orders","payments","printing","sale_sessions","sales","customers"],WAITER:["pos","orders","edit_orders","printing","sale_sessions","customers"],KITCHEN:["kitchen"]};
export type PermissionUser={role:UserRole;privileges?:readonly string[]};
export function can(user:PermissionUser,permission:Privilege){return user.role==="OWNER"||(user.privileges??ROLE_PRIVILEGES[user.role]??[]).includes(permission)}
export function permissionsFor(user:PermissionUser):Privilege[]{return PRIVILEGE_KEYS.filter(key=>can(user,key))}
export function routePrivilege(path:string):Privilege|"owner"|undefined{
 if(path.startsWith("/settings/kitchen"))return "owner";
 if(path.startsWith("/users"))return "owner";
 if(path.startsWith("/reports/profit-loss"))return "profit";
 const prefix=path.split("/")[1];
 return ({audit:"audit",pos:"pos",orders:"orders",kitchen:"kitchen",sales:"sales","sale-sessions":"sale_sessions",reports:"reports",expenses:"expenses",products:"catalog",categories:"catalog",deals:"catalog",customers:"customers",staff:"staff",tables:"tables",settings:"settings"} as Record<string,Privilege>)[prefix];
}
