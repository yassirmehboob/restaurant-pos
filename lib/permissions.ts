import type { UserRole } from "@/lib/roles";
export const PRIVILEGES=[
 ["waiter","Take waiter orders"],["audit","View audit log"],["pos","Use POS / create orders"],["orders","View orders"],["edit_orders","Edit unpaid orders"],["cancel_orders","Cancel unpaid orders"],["kitchen","View kitchen / update order stages"],["payments","Receive payments"],["printing","Print invoices / kitchen slips"],["sale_sessions","Start / close own sale"],["sales","View sales history"],["reports","View sales reports / export CSV"],["profit","View profit, costs and loss"],["expenses","Manage expenses"],["catalog","Manage categories, items and deals"],["customers","Add / update customers"],["staff","Manage staff / waiters"],["tables","Manage tables"],["settings","Manage business / printing settings"],["backups","Create restaurant backups"]
] as const;
export type Privilege=(typeof PRIVILEGES)[number][0];
export const PRIVILEGE_KEYS=PRIVILEGES.map(([key])=>key);
export const ROLE_PRIVILEGES:Record<UserRole,readonly Privilege[]>={OWNER:PRIVILEGE_KEYS,ADMIN:PRIVILEGE_KEYS,MANAGER:PRIVILEGE_KEYS.filter(key=>key!=="waiter"&&key!=="settings"),SUPERVISOR:["pos","orders","edit_orders","cancel_orders","kitchen","payments","printing","sale_sessions","sales","reports","customers","tables","backups"],CASHIER:["pos","orders","edit_orders","payments","printing","sale_sessions","sales","customers","backups"],WAITER:["waiter"],KITCHEN:["kitchen"],CHEF:["kitchen","printing"]};
export type PermissionUser={role:UserRole;privileges?:readonly string[]};
export function can(user:PermissionUser,permission:Privilege){return user.role==="WAITER"?permission==="waiter":user.role==="OWNER"||(user.privileges??ROLE_PRIVILEGES[user.role]??[]).includes(permission)}
export function permissionsFor(user:PermissionUser):Privilege[]{return PRIVILEGE_KEYS.filter(key=>can(user,key))}
export function routePrivilege(path:string):Privilege|"owner"|undefined{
 if(path==="/settings/backups"||path.startsWith("/settings/backups/"))return "backups";
 if(path==="/settings/sms"||path.startsWith("/settings/sms/"))return "owner";
 if(path.startsWith("/settings/sms-messaging"))return "owner";
 if(path.startsWith("/settings/discounts"))return "owner";
 if(path.startsWith("/settings/kitchen"))return "owner";
 if(path.startsWith("/users"))return "owner";
 if(path.startsWith("/coupons"))return "owner";
 if(path.startsWith("/settings/signage"))return "owner";
 if(path.startsWith("/reports/profit-loss"))return "profit";
 const prefix=path.split("/")[1];
 return ({waiter:"waiter","waiter-requests":"pos",audit:"audit",pos:"pos",orders:"orders",kitchen:"kitchen",sales:"sales","sale-sessions":"sale_sessions",reports:"reports",expenses:"expenses",products:"catalog",categories:"catalog",deals:"catalog",customers:"customers",staff:"staff",tables:"tables",settings:"settings"} as Record<string,Privilege>)[prefix];
}
