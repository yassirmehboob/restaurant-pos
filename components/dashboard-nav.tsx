"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText,MessageSquare,MessageSquareText,ShieldCheck,ScrollText,ChevronDown,BadgePercent,TicketPercent,Monitor,BarChart3,ChefHat,ClipboardList,LayoutDashboard,PackageOpen,Printer,ReceiptText,Settings,ShoppingCart,SlidersHorizontal,TableProperties,TrendingUp,UserRound,UsersRound,WalletCards } from "lucide-react";
import { COUNTER_ROLES,type UserRole } from "@/lib/roles";
import { can,routePrivilege,type Privilege } from "@/lib/permissions";

const links=[
  ["/dashboard","Dashboard",LayoutDashboard],
  ["/pos","Start Orders",ShoppingCart],
  ["/waiter","Waiter Orders",ShoppingCart],
  ["/waiter/my-orders","My Orders",ClipboardList],
  ["/waiter-requests","Waiter Approval",ClipboardList],
  ["/orders","Placed Orders",ClipboardList],
  ["/kitchen","Kitchen Display",ChefHat],
  ["/sale-sessions","Start / Close Sale",WalletCards],
  ["/reports","Sales Report",FileText],
  ["/sales","Sale History",ReceiptText],
  ["/reports/discounts","Discounted Invoices",BadgePercent],
  ["/reports/profit-loss","Profit & Loss",TrendingUp],
  ["/expenses","Expenses",WalletCards],
  ["/products","Items",PackageOpen],
  ["/deals","Deals",BadgePercent],
  ["/coupons","Coupons",TicketPercent],
  ["/customers","Customers",UserRound],
  ["/staff","Staff",UsersRound],
  ["/users","User Accounts",UsersRound],
  ["/tables","Tables",TableProperties],
  ["/settings/business","Business Profile",Settings],
  ["/settings/backups","Backups & Restore",ShieldCheck],
  ["/settings/discounts","Discounts",BadgePercent],
  ["/settings/sms-messaging","SMS Messaging",MessageSquareText],
  ["/settings/sms","SMS History",MessageSquare],
  ["/settings/printing","Printing",Printer],
  ["/settings/kitchen","Kitchen Timing",ChefHat],
  ["/audit","Audit Log",ScrollText],
  ["/settings/signage","Display Screens",Monitor],
] as const;

export function DashboardNav({role,privileges}:{role:UserRole;privileges:Privilege[]}){
  const pathname=usePathname();
  const visible=links.filter(([href])=>{if((href==="/waiter"||href==="/waiter/my-orders")&&role!=="WAITER")return false;if(href==="/waiter-requests"&&!COUNTER_ROLES.includes(role))return false;if(href==="/settings/kitchen"&&role!=="OWNER")return false;if(href==="/sale-sessions"&&pathname.startsWith("/kitchen"))return false;const permission=routePrivilege(href);return permission==="owner"?role==="OWNER":!permission||can({role,privileges},permission)});
  const setupPaths=["/products","/deals","/staff","/users","/tables","/settings/backups","/settings/sms","/settings/signage"],settingsPaths=["/settings/business","/settings/discounts","/settings/sms-messaging","/settings/printing","/settings/kitchen","/audit"],reportPaths=["/reports","/sales","/reports/discounts","/reports/profit-loss"],groupedPaths=[...setupPaths,...settingsPaths,...reportPaths];
  const firstReport=visible.find(([href])=>reportPaths.includes(href))?.[0];
  const renderLink=([href,label,Icon]:(typeof links)[number])=><Link className={`nav-link ${pathname===href||(!["/reports","/waiter"].includes(href)&&pathname.startsWith(href+"/"))?"active":""}`} href={href} key={href}><Icon size={19}/><span>{label}</span></Link>;
  const renderGroup=(label:string,Icon:typeof Settings,paths:string[])=>{const items=visible.filter(([href])=>paths.includes(href));return items.length>0&&<details className="setup-nav" key={label} open={paths.some(path=>pathname===path||pathname.startsWith(path+"/"))}><summary><Icon size={19}/><span>{label}</span><ChevronDown size={17}/></summary><div className="setup-links">{items.map(renderLink)}</div></details>};
  // The Reports group sits where its first report link would be; Setup and Settings close the menu.
  return <nav>{visible.filter(([href])=>!groupedPaths.includes(href)||href===firstReport).map(link=>link[0]===firstReport?renderGroup("Reports",BarChart3,reportPaths):renderLink(link))}{renderGroup("Setup",Settings,setupPaths)}{renderGroup("Settings",SlidersHorizontal,settingsPaths)}</nav>;
}
