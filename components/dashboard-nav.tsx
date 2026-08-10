"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BadgePercent,BarChart3,ClipboardList,LayoutDashboard,PackageOpen,Printer,ReceiptText,Settings,ShoppingCart,TableProperties,TrendingUp,UserRound,UsersRound,WalletCards } from "lucide-react";
import type { UserRole } from "@/lib/roles";

const links=[
  ["/dashboard","Dashboard",LayoutDashboard],
  ["/pos","POS",ShoppingCart],
  ["/orders","Orders",ClipboardList],
  ["/sales","Sales",ReceiptText],
  ["/reports","Reports",BarChart3],
  ["/expenses","Expenses",WalletCards],
  ["/reports/profit-loss","Profit & Loss",TrendingUp],
  ["/products","Items",PackageOpen],
  ["/deals","Deals",BadgePercent],
  ["/customers","Customers",UserRound],
  ["/staff","Staff",UsersRound],
  ["/tables","Tables",TableProperties],
  ["/settings/business","Business Profile",Settings],
  ["/settings/printing","Printing",Printer],
] as const;

export function DashboardNav({role}:{role:UserRole}){
  const pathname=usePathname();
  return <nav>{links.filter(([href])=>!["/expenses","/reports/profit-loss"].includes(href)||role==="OWNER"||role==="ADMIN").map(([href,label,Icon])=><Link className={`nav-link ${pathname===href||(href!=="/reports"&&pathname.startsWith(`${href}/`))?"active":""}`} href={href} key={href}><Icon size={19}/><span>{label}</span></Link>)}</nav>;
}
