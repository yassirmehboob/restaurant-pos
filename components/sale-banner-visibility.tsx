"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight } from "lucide-react";
export function SaleBannerVisibility({children}:{children:React.ReactNode}){const pathname=usePathname();return pathname==="/kitchen"||pathname.startsWith("/kitchen/")?null:children;}
// On the POS screen an open sale is left via Exit; sale management stays on other pages.
export function SaleBannerLink({open}:{open:boolean}){const pos=usePathname()==="/pos";return open&&pos?<Link href="/dashboard">Exit<ArrowRight size={17}/></Link>:<Link href="/sale-sessions">{open?"Manage sale":"Start Sale"}<ArrowRight size={17}/></Link>;}
