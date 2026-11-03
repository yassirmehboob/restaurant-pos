import type { Metadata,Viewport } from "next";
import { QrGuestMenu,QrGuestNotice } from "@/components/qr-guest-menu";
import { guestMenu,resolveQrTable } from "@/lib/qr-menu";

export const viewport:Viewport={width:"device-width",initialScale:1,themeColor:"#b4441c"};

export async function generateMetadata({params}:{params:Promise<{token:string}>}):Promise<Metadata>{
 const context=await resolveQrTable((await params).token);
 return{title:context?`${context.business.name} · Menu`:"Menu",robots:{index:false,follow:false}};
}

// Opened by scanning a table's QR code. Everything here is public, so it only shows what a guest may see.
export default async function GuestMenuPage({params}:{params:Promise<{token:string}>}){
 const{token}=await params,context=await resolveQrTable(token);
 if(!context)return <QrGuestNotice code="INVALID"/>;
 if(!context.business.enabled)return <QrGuestNotice code="CLOSED" businessName={context.business.name}/>;
 if(!context.business.countersOpen)return <QrGuestNotice code="COUNTER_CLOSED" businessName={context.business.name}/>;
 const menu=await guestMenu(token,context);
 return <QrGuestMenu token={token} business={context.business} table={context.table} menu={menu}/>;
}
