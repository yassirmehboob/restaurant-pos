// Dine-in and takeaway "order placed" / "order ready" texts. Plain JS with the raw driver so the
// kitchen timer worker can queue them too; the web app passes its transaction session.
export const ORDER_SMS_KEYS={ORDER_PLACED:"placed",ORDER_READY:"ready"};
const ORDER_TYPES={DINE_IN:"dineIn",TAKEAWAY:"takeaway"};

export function normalizeSmsPhone(phone){
 const clean=String(phone??"").trim().replace(/[\s().-]/g,"");
 const international=clean.startsWith("00")?"+"+clean.slice(2):/^03\d{9}$/.test(clean)?"+92"+clean.slice(1):/^923\d{9}$/.test(clean)?"+"+clean:clean;
 return /^\+[1-9]\d{7,14}$/.test(international)?international:null;
}

export async function queueOrderStageSms(db,order,type,occurredAt=new Date(),session){
 const key=ORDER_SMS_KEYS[type],typeKey=ORDER_TYPES[order?.orderType];
 if(!key||!typeKey||order.status==="CANCELLED")return;
 // Walk-in orders have no customer number, so nothing is logged for them.
 if(!order.customerSnapshot?.phone)return;
 const business=await db.collection("businesses").findOne({_id:order.businessId,isActive:true},{session,projection:{name:1,phone:1,currency:1,timezone:1,smsEnabled:1,smsEvidenceReference:1,smsOrderMessages:1}});
 const config=business?.smsOrderMessages?.[key];
 if(!business?.smsEnabled||!config?.enabled||config[typeKey]===false||!config.template)return;
 const to=normalizeSmsPhone(order.customerSnapshot.phone);let body="",failureCode;
 if(!to)failureCode="NO_VALID_CUSTOMER_PHONE";
 else{
  const date=value=>new Intl.DateTimeFormat("en-GB",{timeZone:business.timezone||"Asia/Karachi",dateStyle:"short",timeStyle:"short",hour12:true}).format(value);
  const payment=order.paymentStatus==="PAID"?await db.collection("payments").findOne({businessId:order.businessId,orderId:order._id},{session,sort:{paidAt:-1},projection:{paidAt:1}}):null;
  const values={
   customer_name:order.customerSnapshot.name||"Customer",business_name:business.name,business_phone:business.phone||"",order_number:order.orderNumber,currency:business.currency||"PKR",
   amount_paid:Number(order.paidAmount??0).toFixed(2),order_total:Number(order.grandTotal??0).toFixed(2),payment_method:order.taxPaymentMethod||"CASH",customer_phone:to,table_name:order.tableNameSnapshot||"Not applicable",
   paid_at:payment?.paidAt?date(payment.paidAt):"Not paid",event_at:date(occurredAt),
   delivery_address:"Not applicable",delivery_area:"",delivery_charge:"0.00",delivery_status:"Not applicable",
  };
  // Templates are checked when saved; only the finished length can still be wrong here.
  body=config.template.replace(/\{\{([a-z_]+)\}\}/g,(_,field)=>values[field]??"").trim();
  if(!body||body.length>1600){body="";failureCode="INVALID_MESSAGE_TEMPLATE"}
 }
 const now=new Date();
 await db.collection("smsmessages").updateOne({_id:`${order.businessId}:${order._id}:${type}`},{$setOnInsert:{businessId:order.businessId,orderId:order._id,orderNumber:order.orderNumber,messageType:type,to:to??"",body,includeOptOut:config.includeOptOut!==false,evidenceReference:business.smsEvidenceReference||"customer-acknowledgement",status:failureCode?"SKIPPED":"PENDING",...(failureCode?{failureCode,finishedAt:now}:{}),createdAt:now,updatedAt:now}},{upsert:true,session});
}
