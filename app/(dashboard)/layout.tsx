import { SaleBannerVisibility } from "@/components/sale-banner-visibility";
import { PermissionProvider } from "@/components/permission-provider";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { activeSaleSession } from "@/lib/sale-sessions";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CircleDot, LogOut, Play, UtensilsCrossed } from "lucide-react";
import { requireUser } from "@/data/auth";
import { logoutAction } from "@/app/(auth)/actions";
import { DashboardNav } from "@/components/dashboard-nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(), sale = await activeSaleSession(user);
  return <PermissionProvider privileges={user.privileges}><div className="dashboard-shell">
    <aside className="sidebar">
      <Link className="sidebar-brand" href="/dashboard"><span>{user.businessLogoUrl ? <Image className="sidebar-logo" src={user.businessLogoUrl} alt="" width={42} height={42}/> : <UtensilsCrossed size={22}/>}</span><div>{user.businessName}<small>Restaurant POS</small></div></Link>
      <DashboardNav role={user.role} privileges={user.privileges}/>
      <div className="sidebar-account"><div className="user-block"><div className="avatar">{user.fullName.charAt(0).toUpperCase()}</div><div><strong title={user.fullName}>{user.fullName}</strong><small>{user.role} / {user.username}</small></div></div><form action={logoutAction}><button className="logout-button" type="submit" title="Log out" aria-label="Log out"><LogOut size={19}/><span>Log out</span></button></form></div>
    </aside>
    <div className="dashboard-main">
      <SaleBannerVisibility><div className={`session-banner ${sale ? "is-open" : "is-closed"}`}>
        <div className="session-banner-info"><span className="session-banner-icon">{sale ? <CircleDot size={19}/> : <Play size={18}/>}</span><div><strong>{sale ? sale.counterName : "Ready for your next shift?"}</strong><span>{sale ? `Sale date ${formatDate(sale.saleDate)} / ${user.fullName}` : "Set your sale date and opening cash to begin."}</span></div></div>
        {can(user,"sale_sessions")&&<Link href="/sale-sessions">{sale ? "Manage sale" : "Start Sale"}<ArrowRight size={17}/></Link>}
      </div>
      </SaleBannerVisibility>
      {children}
    </div>
  </div></PermissionProvider>;
}
