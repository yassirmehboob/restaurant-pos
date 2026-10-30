import { z } from "zod";
import { isISODate } from "@/lib/dates";

export const COUPON_CODE_PATTERN=/^[1-9]\d{9}$/;
export const MAX_COUPONS_PER_BATCH=10000;
export type CouponUsage="INSTANT"|"NEXT_VISIT";
export type CouponRules={discountType:"PERCENT"|"FIXED";discountValue:number;maxDiscount?:number|null;minOrderAmount?:number|null};
export type CouponBatchRules=CouponRules&{name:string;usage:CouponUsage;validFrom?:string|null;expiresOn?:string|null;isActive?:boolean};

const money=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const amount=z.number().finite().nonnegative().max(100000000).refine(value=>Math.abs(value*100-Math.round(value*100))<0.0001,"Use at most two decimal places.");
const optionalDate=z.string().trim().refine(value=>!value||isISODate(value),"Choose a valid date.").transform(value=>value||null);

export function normalizeCouponCode(value:unknown){const code=String(value??"").replace(/[\s-]/g,"");return COUPON_CODE_PATTERN.test(code)?code:null}

export const couponBatchSchema=z.object({
 name:z.string().trim().min(2,"Enter a coupon name, e.g. Azadi Offer.").max(80),
 discountType:z.enum(["PERCENT","FIXED"]),
 discountValue:amount.refine(value=>value>0,"Enter the discount."),
 maxDiscount:amount.nullable().default(null),
 minOrderAmount:amount.default(0),
 usage:z.enum(["INSTANT","NEXT_VISIT"]),
 validFrom:optionalDate.default(""),expiresOn:optionalDate.default(""),
 autoIssueEnabled:z.boolean().default(false),autoIssueMinSpend:amount.default(0),
 quantity:z.number().int("Quantity must be a whole number.").min(1,"Create at least one coupon.").max(MAX_COUPONS_PER_BATCH,`Create at most ${MAX_COUPONS_PER_BATCH.toLocaleString()} coupons at a time.`),
}).superRefine((value,ctx)=>{
 if(value.discountType==="PERCENT"&&value.discountValue>100)ctx.addIssue({code:"custom",path:["discountValue"],message:"A percentage discount cannot exceed 100%."});
 if(value.discountType==="FIXED"&&value.maxDiscount!==null)ctx.addIssue({code:"custom",path:["maxDiscount"],message:"A maximum cap only applies to percentage discounts."});
 if(value.maxDiscount!==null&&value.maxDiscount<=0)ctx.addIssue({code:"custom",path:["maxDiscount"],message:"The maximum discount must be more than zero."});
 if(value.validFrom&&value.expiresOn&&value.expiresOn<value.validFrom)ctx.addIssue({code:"custom",path:["expiresOn"],message:"The expiry date must be on or after the start date."});
 if(value.autoIssueEnabled&&value.autoIssueMinSpend<=0)ctx.addIssue({code:"custom",path:["autoIssueMinSpend"],message:"Enter the amount a customer must spend to receive a coupon."});
});
export type CouponBatchInput=z.infer<typeof couponBatchSchema>;

const rs=(value:number)=>`Rs ${value.toLocaleString("en-PK",{maximumFractionDigits:2})}`;
export function couponDescription(rules:CouponRules){
 const base=rules.discountType==="PERCENT"?`${rules.discountValue}% off${rules.maxDiscount?` (up to ${rs(rules.maxDiscount)})`:""}`:`${rs(rules.discountValue)} off`;
 return rules.minOrderAmount?`${base} on orders of ${rs(rules.minOrderAmount)} or more`:base;
}

// The discount is taken from the item subtotal before tax and never exceeds it.
export function couponDiscount(rules:CouponRules,subtotal:number){
 if(rules.minOrderAmount&&subtotal<rules.minOrderAmount)throw new Error(`This coupon needs an order of ${rs(rules.minOrderAmount)} or more before tax.`);
 const raw=rules.discountType==="PERCENT"?subtotal*rules.discountValue/100:rules.discountValue;
 return money(Math.min(raw,rules.maxDiscount??Infinity,subtotal));
}

type CouponState={status:string;customerId?:unknown;issuedSaleDate?:string|null};
// Checks everything except the order amount. saleDate is the restaurant business date of the redeeming order.
export function couponProblem(coupon:CouponState,batch:CouponBatchRules,{customerId,saleDate}:{customerId?:string|null;saleDate:string}){
 if(coupon.status==="REDEEMED")return "This coupon has already been used.";
 if(coupon.status==="VOID")return "This coupon was cancelled by the owner.";
 if(coupon.status==="APPLIED")return "This coupon is already applied to another unpaid order.";
 if(batch.isActive===false)return `The ${batch.name} offer has been stopped.`;
 if(batch.validFrom&&saleDate<batch.validFrom)return `This coupon can be used from ${displayDate(batch.validFrom)}.`;
 if(batch.expiresOn&&saleDate>batch.expiresOn)return `This coupon expired on ${displayDate(batch.expiresOn)}.`;
 if(coupon.customerId&&String(coupon.customerId)!==String(customerId??""))return "This coupon belongs to another customer. Select that customer on the order.";
 if(batch.usage==="NEXT_VISIT"){
  if(!coupon.customerId)return "This next-visit coupon has not been given to a customer yet.";
  if(!coupon.issuedSaleDate||saleDate<=coupon.issuedSaleDate)return "This coupon can only be used on the customer's next visit.";
 }
 return null;
}
const displayDate=(iso:string)=>`${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}`;
