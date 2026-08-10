"use client";
import Link from "next/link";import { usePathname } from "next/navigation";
import { BadgePercent,ClipboardList,LayoutDashboard,PackageOpen,Printer,Settings,ShoppingCart,TableProperties,UserRound,UsersRound } from "lucide-react";
const links=[["/dashboard","Dashboard",LayoutDashboard],["/pos","POS",ShoppingCart],["/orders","Orders",ClipboardList],["/products","Items",PackageOpen],["/deals","Deals",BadgePercent],["/customers","Customers",UserRound],["/staff","Staff",UsersRound],["/tables","Tables",TableProperties],["/settings/business","Business Profile",Settings],["/settings/printing","Printing",Printer]] as const;
export function DashboardNav(){const pathname=usePathname();return <nav>{links.map(([href,label,Icon])=><Link className={`nav-link ${pathname===href?"active":""}`} href={href} key={href}><Icon size={19}/><span>{label}</span></Link>)}</nav>}
