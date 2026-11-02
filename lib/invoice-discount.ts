import { z } from "zod";
import { normalizeSmsPhone } from "@/lib/sms-template";

// OPEN: the cashier types the percentage at payment. FIXED: the owner's percentage is always used.
export const DISCOUNT_MODES=["OPEN","FIXED"] as const;
export type DiscountMode=(typeof DISCOUNT_MODES)[number];
export type DiscountType={id:string;name:string;mode:DiscountMode;percent:number|null;capAmount:number|null;remarksRequired:boolean};
export type AppliedDiscount={typeId:string;name:string;mode:DiscountMode;percent:number;capAmount:number|null;amount:number;remarks:string};
export const MAX_DISCOUNT_SMS_NUMBERS=5;

const percent=z.number().min(0.01,"Use a percentage from 0.01 to 100.").max(100,"Use a percentage from 0.01 to 100.");
export const discountTypeSchema=z.object({
  id:z.string().regex(/^[a-f\d]{24}$/i).optional(),
  name:z.string().trim().min(2,"Each discount needs a name of at least 2 characters.").max(60),
  mode:z.enum(DISCOUNT_MODES),
  percent:percent.nullable(),
  capAmount:z.number().min(1,"A cap must be at least Rs 1.").max(100000000).nullable(),
  remarksRequired:z.boolean(),
}).superRefine((value,ctx)=>{if(value.mode==="FIXED"&&value.percent===null)ctx.addIssue({code:"custom",path:["percent"],message:`Enter the fixed percentage for ${value.name}.`})});

export const discountSettingsSchema=z.object({
  enabled:z.boolean(),
  couponOnPayment:z.boolean().default(true),
  types:z.array(discountTypeSchema).max(20,"Add up to 20 discount types."),
  smsNumbers:z.array(z.string().trim()).max(MAX_DISCOUNT_SMS_NUMBERS,`Add up to ${MAX_DISCOUNT_SMS_NUMBERS} mobile numbers.`),
  currentPassword:z.string().max(72).optional(),
  twoFactorCode:z.string().trim().max(64).optional(),
}).superRefine((value,ctx)=>{
  const names=value.types.map(type=>type.name.toLowerCase());
  if(new Set(names).size!==names.length)ctx.addIssue({code:"custom",path:["types"],message:"Discount names must be unique."});
  if(value.enabled&&!value.types.length)ctx.addIssue({code:"custom",path:["types"],message:"Add at least one discount type before allowing discounts."});
  value.smsNumbers.forEach((phone,index)=>{if(!normalizeSmsPhone(phone))ctx.addIssue({code:"custom",path:["smsNumbers",index],message:`${phone||"A blank number"} is not a valid mobile number.`})});
});

export const discountInputSchema=z.object({typeId:z.string().regex(/^[a-f\d]{24}$/i,"Choose a discount type."),percent:z.number().min(0).max(100).optional(),remarks:z.string().trim().max(300).default("")});
export type DiscountInput=z.input<typeof discountInputSchema>;

type StoredType={_id:unknown;name:string;mode?:string|null;percent?:number|null;capAmount?:number|null;remarksRequired?:boolean|null};
export function businessDiscountTypes(business:{invoiceDiscountEnabled?:boolean|null;discountTypes?:StoredType[]|null}):DiscountType[]{
  if(!business.invoiceDiscountEnabled)return [];
  return (business.discountTypes??[]).map(type=>({id:String(type._id),name:type.name,mode:type.mode==="FIXED"?"FIXED":"OPEN",percent:type.percent??null,capAmount:type.capAmount??null,remarksRequired:type.remarksRequired===true}));
}

// The discount is a percentage of the pre-tax amount after any coupon, rounded to the whole rupee and held to the cap.
export function resolveInvoiceDiscount(types:DiscountType[],raw:DiscountInput,base:number,{requireRemarks=true}={}):AppliedDiscount{
  const input=discountInputSchema.parse(raw),type=types.find(item=>item.id===input.typeId);
  if(!type)throw new Error("This discount type is no longer available. Refresh and choose again.");
  const rate=type.mode==="FIXED"?type.percent:input.percent;
  if(!rate||rate<0.01||rate>100)throw new Error("Enter a discount percentage from 0.01 to 100.");
  if(requireRemarks&&type.remarksRequired&&!input.remarks)throw new Error(`Enter remarks for ${type.name}.`);
  const percent=Math.round(rate*100)/100,amount=Math.max(0,Math.min(Math.round(base*percent/100),type.capAmount??Infinity,Math.floor(base)));
  if(amount<=0)throw new Error("This discount comes to Rs 0 on this invoice.");
  return{typeId:type.id,name:type.name,mode:type.mode,percent,capAmount:type.capAmount,amount,remarks:input.remarks};
}

export function discountLabel(discount:{name:string;percent:number}){return `${discount.name} (${discount.percent}%)`}
