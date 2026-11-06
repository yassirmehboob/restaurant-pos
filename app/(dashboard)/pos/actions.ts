"use server";

import { requirePermission } from "@/data/auth";
import { can } from "@/lib/permissions";
import { resolveCoupon } from "@/lib/coupon-service";
import { businessDiscountTypes,rescaleDiscount,resolveInvoiceDiscount,withStoredDiscountType,type AppliedDiscount,type DiscountInput } from "@/lib/invoice-discount";
import { Order } from "@/models/Order";
import { writeAuditLog } from "@/lib/audit";
import { calculateOrderPreview } from "@/lib/order-calculation";
import { Business } from "@/models/Business";
import { businessTaxRates } from "@/lib/tax";
import { connectToDatabase } from "@/lib/db";
import { posPreviewSchema,type PosPreviewInput } from "@/lib/validation/pos";
import { Deal } from "@/models/Deal";
import { Product } from "@/models/Product";
import { Customer } from "@/models/Customer";
import { z } from "zod";
import { productLinePrice } from "@/lib/weight";
import { revalidatePath } from "next/cache";

const posCustomerSchema=z.object({name:z.string().trim().min(2).max(100),phone:z.string().trim().min(1,"Mobile number is required.").max(30),address:z.string().trim().max(500).default(""),area:z.string().trim().max(100).default(""),delivery:z.boolean()}).superRefine((value,ctx)=>{if(value.delivery&&!value.address)ctx.addIssue({code:"custom",path:["address"],message:"Address is required for delivery."});if(value.delivery&&!value.area)ctx.addIssue({code:"custom",path:["area"],message:"Area is required for delivery."})});
type PosCustomerInput=z.infer<typeof posCustomerSchema>;

export async function savePosCustomer(id:string|undefined,input:PosCustomerInput){const user=await requirePermission("customers");if(id&&!/^[a-f\d]{24}$/i.test(id))return{ok:false as const,message:"Invalid customer."};const parsed=posCustomerSchema.safeParse(input);if(!parsed.success)return{ok:false as const,message:parsed.error.issues[0]?.message??"Check the customer details."};await connectToDatabase();const values={name:parsed.data.name,phone:parsed.data.phone,address:parsed.data.address,area:parsed.data.area};const row=id?await Customer.findOneAndUpdate({_id:id,businessId:user.businessId,isActive:true},{$set:values},{returnDocument:"after"}):await Customer.create({...values,businessId:user.businessId});if(!row)return{ok:false as const,message:"Customer not found."};await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:id?"UPDATE_CUSTOMER":"CREATE_CUSTOMER",entityType:"Customer",entityId:String(row._id),description:`${id?"Updated":"Created"} customer ${row.name}`});revalidatePath("/pos");revalidatePath("/customers");return{ok:true as const,customer:{id:String(row._id),name:row.name,phone:row.phone??"",address:row.address??"",area:row.area??""}}}

export async function previewPosTotals(input:PosPreviewInput,options:{discount?:DiscountInput;orderId?:string;customerId?:string}={}){
  const user=await requirePermission("pos");
  const parsed=posPreviewSchema.safeParse(input);
  if(!parsed.success)return{ok:false as const,message:"The cart contains invalid values."};
  await connectToDatabase();
  const productIds=parsed.data.lines.filter(line=>line.kind==="PRODUCT").map(line=>line.id);
  const dealIds=parsed.data.lines.filter(line=>line.kind==="DEAL").map(line=>line.id);
  const[products,deals]=await Promise.all([
    Product.find({_id:{$in:productIds},businessId:user.businessId,isActive:true,isAvailable:true}).lean(),
    Deal.find({_id:{$in:dealIds},businessId:user.businessId,isActive:true,isAvailable:true}).lean(),
  ]);
  const productMap=new Map(products.map(item=>[String(item._id),item]));
  const dealMap=new Map(deals.map(item=>[String(item._id),item]));
  if(productMap.size!==new Set(productIds).size||dealMap.size!==new Set(dealIds).size)return{ok:false as const,message:"An item or deal is no longer available. Remove it and try again."};
  const priced=parsed.data.lines.map(line=>{const record=line.kind==="PRODUCT"?productMap.get(line.id):dealMap.get(line.id);if(!record)throw new Error("Catalog record unavailable");const variant=line.kind==="PRODUCT"&&line.variantName?record.variants?.find((row:{name:string})=>row.name.toLowerCase()===line.variantName!.toLowerCase()):undefined;if(line.kind==="PRODUCT"&&line.variantName&&!variant)throw new Error(`The selected size for ${record.name} is unavailable.`);if(line.kind==="DEAL"&&line.weightGrams!==undefined)throw new Error(`${record.name} is not sold by weight.`);const price=line.kind==="PRODUCT"?productLinePrice(record,variant,line.weightGrams):{name:record.name,unitPrice:record.salePrice};return{key:`${line.kind}:${line.id}:${line.variantName??""}:${line.weightGrams??""}`,name:price.name,quantity:line.quantity,unitPrice:price.unitPrice,taxRate:line.kind==="PRODUCT"?record.taxRate:0,isTaxInclusive:line.kind==="PRODUCT"?record.isTaxInclusive:false}});
  const business=await Business.findOne({_id:user.businessId,isActive:true}).lean();
  if(!business)return{ok:false as const,message:"Business unavailable."};
  const rate=businessTaxRates(business)?.[parsed.data.paymentMethod];
  // When editing, totals also carry the order's coupon and its saved discount, exactly as saving will price them.
  const editing=options.orderId&&/^[a-f\d]{24}$/i.test(options.orderId)?await Order.findOne({_id:options.orderId,businessId:user.businessId,paymentStatus:"UNPAID"}).select("invoiceDiscount couponCode saleDate").lean():null;
  const before=calculateOrderPreview(priced,parsed.data.deliveryCharge,rate);
  let couponDiscount=0;
  if(editing?.couponCode)try{couponDiscount=(await resolveCoupon({businessId:user.businessId,code:editing.couponCode,customerId:options.customerId||null,saleDate:String(editing.saleDate??""),subtotal:before.subtotal,currentOrderId:String(editing._id)})).discountAmount}catch{/* The edited order no longer qualifies, so saving will release the coupon. */}
  const withCoupon=calculateOrderPreview(priced,parsed.data.deliveryCharge,rate,couponDiscount),base=Math.max(0,withCoupon.subtotal-withCoupon.discountAmount),allowed=can(user,"payments");
  const discountTypes=allowed?withStoredDiscountType(businessDiscountTypes(business),editing?.invoiceDiscount):[];
  let invoiceDiscount:AppliedDiscount|null=allowed?null:rescaleDiscount(editing?.invoiceDiscount,base),discountError="";
  // A discount that cannot apply leaves the totals without it and explains why.
  if(allowed&&options.discount)try{invoiceDiscount=resolveInvoiceDiscount(discountTypes,options.discount,base,{requireRemarks:false})}catch(error){discountError=error instanceof Error?error.message:"Could not apply this discount."}
  const totals=calculateOrderPreview(priced,parsed.data.deliveryCharge,rate,withCoupon.discountAmount+(invoiceDiscount?.amount??0));
  return{ok:true as const,taxRate:rate,...totals,discountTypes,invoiceDiscount,discountError};
}
