"use client";
import { usePathname } from "next/navigation";
export function SaleBannerVisibility({children}:{children:React.ReactNode}){const pathname=usePathname();return pathname==="/kitchen"||pathname.startsWith("/kitchen/")?null:children;}
