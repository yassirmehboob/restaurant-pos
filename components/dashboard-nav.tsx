"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck,ScrollText,ChevronDown,BadgePercent,BarChart3,ChefHat,ClipboardList,LayoutDashboard,PackageOpen,Printer,ReceiptText,Settings,ShoppingCart,TableProperties,TrendingUp,UserRound,UsersRound,WalletCards } from "lucide-react";
import type { UserRole } from "@/lib/roles";
import { can,routePrivilege,type Privilege } from "@/lib/permissions";

const links=[
  ["/dashboard","Dashboard",LayoutDashboard],
  ["/pos","Start Orders",ShoppingCart],
  ["/orders","Placed Orders",ClipboardList],
  ["/kitchen","Kitchen Display",ChefHat],
  ["/sales","Sales",ReceiptText],
  ["/sale-sessions","Start / Close Sale",WalletCards],
  ["/reports","Reports",BarChart3],
  ["/audit","Audit Log",ScrollText],
  ["/expenses","Expenses",WalletCards],
  ["/reports/profit-loss","Profit & Loss",TrendingUp],
  ["/products","Items",PackageOpen],
  ["/deals","Deals",BadgePercent],
  ["/customers","Customers",UserRound],
  ["/staff","Staff",UsersRound],
  ["/users","User Accounts",UsersRound],
  ["/tables","Tables",TableProperties],
  ["/security","Security / 2FA",ShieldCheck],
  ["/settings/business","Business Profile",Settings],
  ["/settings/printing","Printing",Printer],
  ["/settings/kitchen","Kitchen Timing",ChefHat],
] as const;

export function DashboardNav({role,privileges}:{role:UserRole;privileges:Privilege[]}){
  const pathname=usePathname();
  const visible=links.filter(([href])=>{if(href==="/settings/kitchen"&&role!=="OWNER")return false;if(href==="/sale-sessions"&&pathname.startsWith("/kitchen"))return false;const permission=routePrivilege(href);return permission==="owner"?role==="OWNER":!permission||can({role,privileges},permission)});
  const setupPaths=["/products","/deals","/staff","/users","/tables","/settings/business","/settings/printing","/settings/kitchen"];
  const setup=visible.filter(([href])=>setupPaths.includes(href));
  const renderLink=([href,label,Icon]:(typeof links)[number])=><Link className={`nav-link ${pathname===href||(href!=="/reports"&&pathname.startsWith(href+"/"))?"active":""}`} href={href} key={href}><Icon size={19}/><span>{label}</span></Link>;
  return <nav>{visible.filter(([href])=>!setupPaths.includes(href)).map(renderLink)}{setup.length>0&&<details className="setup-nav" open={setupPaths.some(path=>pathname===path||pathname.startsWith(path+"/"))}><summary><Settings size={19}/><span>Setup</span><ChevronDown size={17}/></summary><div className="setup-links">{setup.map(renderLink)}</div></details>}</nav>;
}
