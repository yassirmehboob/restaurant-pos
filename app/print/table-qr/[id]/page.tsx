import { headers } from "next/headers";
import { notFound,redirect } from "next/navigation";
import Image from "next/image";
import QRCode from "qrcode";
import { requirePagePermission } from "@/data/auth";
import { connectToDatabase } from "@/lib/db";
import { newQrToken } from "@/lib/qr-menu";
import { ReceiptToolbar } from "@/components/receipt-toolbar";
import { Business } from "@/models/Business";
import { RestaurantTable } from "@/models/RestaurantTable";
import "@/app/table-qr.css";

export const metadata={title:"Table QR codes"};

// 4×6 inch cards for the tables: business name, the QR code, the table number. id is a table id or "all".
export default async function TableQrPage({params}:{params:Promise<{id:string}>}){
 const user=await requirePagePermission("tables"),{id}=await params;
 if(!["OWNER","ADMIN"].includes(user.role))redirect("/access-denied");
 if(id!=="all"&&!/^[a-f\d]{24}$/i.test(id))notFound();
 await connectToDatabase();
 const filter={businessId:user.businessId,isActive:true,...(id==="all"?{}:{_id:id})};
 // A table gets its secret code the first time its card is printed.
 for(const row of await RestaurantTable.find({...filter,qrToken:{$exists:false}}).select("_id").lean())await RestaurantTable.updateOne({_id:row._id,qrToken:{$exists:false}},{$set:{qrToken:newQrToken()}});
 const[business,tables]=await Promise.all([Business.findOne({_id:user.businessId,isActive:true}).select("name logoUrl qrMenuBaseUrl qrOrderingEnabled").lean(),RestaurantTable.find(filter).sort({sortOrder:1,number:1,name:1}).lean()]);
 if(!business||!tables.length)notFound();
 const requestHeaders=await headers(),host=requestHeaders.get("x-forwarded-host")??requestHeaders.get("host")??"localhost:3000";
 const base=(business.qrMenuBaseUrl||`${requestHeaders.get("x-forwarded-proto")??"http"}://${host}`).replace(/\/+$/,"");
 const local=/^https?:\/\/(localhost|127\.|\[::1\])/i.test(base);
 const cards=await Promise.all(tables.map(async table=>{const url=`${base}/menu/${table.qrToken}`;return{id:String(table._id),name:String(table.name),number:table.number==null?null:Number(table.number),area:String(table.area??""),url,svg:await QRCode.toString(url,{type:"svg",margin:0,errorCorrectionLevel:"Q",color:{dark:"#2b1a12",light:"#ffffff"}})}}));
 return <main className="table-qr-page">
  <ReceiptToolbar orderId="" backHref="/tables" backLabel="Tables" auto={!local&&business.qrOrderingEnabled===true}/>
  {(local||business.qrOrderingEnabled!==true)&&<div className="table-qr-warning" role="alert">
   {local&&<p><b>Phones cannot open {base}.</b> Set the menu web address in Business settings → QR table ordering (your domain, or this computer’s Wi-Fi address such as http://192.168.1.10:3000), then print again.</p>}
   {business.qrOrderingEnabled!==true&&<p><b>QR ordering is turned off.</b> Guests who scan will be asked to call a waiter until you switch it on in Business settings.</p>}
  </div>}
  {cards.map(card=><article className="table-qr-card" key={card.id}>
   <header>{business.logoUrl&&<Image src={business.logoUrl} alt="" width={58} height={58} unoptimized/>}<h1>{business.name}</h1></header>
   <div className="table-qr-scan"><strong>Scan to order</strong><span lang="ur" dir="rtl">اسکین کریں اور آرڈر دیں</span><span lang="sd" dir="rtl">اسڪين ڪريو ۽ آرڊر ڏيو</span></div>
   <div className="table-qr-code" dangerouslySetInnerHTML={{__html:card.svg}}/>
   <div className="table-qr-table"><span>TABLE</span><b>{card.number??card.name}</b>{(card.number!==null&&card.name!==String(card.number))&&<small>{card.name}{card.area?` · ${card.area}`:""}</small>}</div>
   <ol className="table-qr-steps"><li><i>1</i>Scan</li><li><i>2</i>Choose food</li><li><i>3</i>Confirm</li></ol>
   <footer>Software developed by: Cubedevsys.com · Contact 03113809764</footer>
  </article>)}
 </main>;
}
