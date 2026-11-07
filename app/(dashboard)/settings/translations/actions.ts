"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/data/auth";
import { writeAuditLog } from "@/lib/audit";
import { connectToDatabase } from "@/lib/db";
import { menuNames } from "@/lib/menu-translations";
import { translateNames } from "@/lib/translation/nllb";
import { MenuTranslation } from "@/models/MenuTranslation";

const language=z.enum(["sd","ur"]);
const wording=z.string().trim().max(300,"Keep each translation under 300 characters.");
const saveSchema=z.object({text:z.string().trim().min(1).max(200),sd:wording,ur:wording});
const suggestSchema=z.object({texts:z.array(z.string().trim().min(1).max(200)).min(1).max(5),language});
const fail=(error:unknown)=>({ok:false as const,message:error instanceof z.ZodError?error.issues[0]?.message??"Check the translation.":error instanceof Error&&error.constructor===Error?error.message:"Could not update translations."});

// Only names on the current menu can be translated, so the list cannot fill with stray text.
async function requireMenuNames(businessId:string,texts:string[]){
  const allowed=new Set((await menuNames(businessId)).map(item=>item.text)),unknown=texts.find(text=>!allowed.has(text));
  if(unknown)throw new Error(`"${unknown}" is no longer on the menu. Refresh the page.`);
}

// Saving is approval: what the owner leaves in a box prints; an emptied box removes that translation.
export async function saveTranslation(input:z.input<typeof saveSchema>){
  try{
    const user=await requirePermission("settings"),data=saveSchema.parse(input);
    await connectToDatabase();await requireMenuNames(user.businessId,[data.text]);
    const set:Record<string,string>={},unset:Record<string,"">={};
    for(const key of ["sd","ur"] as const){if(data[key]){set[key]=data[key];set[`${key}Status`]="APPROVED"}else{unset[key]="";unset[`${key}Status`]=""}}
    const row=await MenuTranslation.findOneAndUpdate({businessId:user.businessId,text:data.text},{...(Object.keys(set).length?{$set:set}:{}),...(Object.keys(unset).length?{$unset:unset}:{})},{upsert:true,returnDocument:"after"}).lean();
    await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"UPDATE_KITCHEN_TRANSLATION",entityType:"MenuTranslation",entityId:String(row!._id),description:`Approved kitchen translations for ${data.text}`,metadata:{sindhi:data.sd||null,urdu:data.ur||null}});
    revalidatePath("/settings/translations");
    return{ok:true as const};
  }catch(error){return fail(error)}
}

// NLLB suggestions for a few names at a time (about 2.5 s each), so the page can show progress. Approved wording is never replaced.
export async function suggestTranslations(input:z.input<typeof suggestSchema>){
  try{
    const user=await requirePermission("settings"),data=suggestSchema.parse(input);
    await connectToDatabase();await requireMenuNames(user.businessId,data.texts);
    const approved=new Set((await MenuTranslation.find({businessId:user.businessId,text:{$in:data.texts},[`${data.language}Status`]:"APPROVED"}).select("text").lean()).map(row=>String(row.text)));
    const texts=data.texts.filter(text=>!approved.has(text)),results=texts.length?await translateNames(texts,data.language):[];
    const suggestions:Record<string,string>={};
    for(const [index,text] of texts.entries()){
      const suggestion=results[index]??"";suggestions[text]=suggestion;
      if(suggestion)await MenuTranslation.updateOne({businessId:user.businessId,text,[`${data.language}Status`]:{$ne:"APPROVED"}},{$set:{[data.language]:suggestion,[`${data.language}Status`]:"SUGGESTED"}},{upsert:true}).catch(error=>{if(error?.code!==11000)throw error});
    }
    return{ok:true as const,suggestions};
  }catch(error){return fail(error)}
}

// Accepts every waiting suggestion in one language as it stands.
export async function approveSuggestions(input:z.input<typeof language>){
  try{
    const user=await requirePermission("settings"),key=language.parse(input);
    await connectToDatabase();
    const result=await MenuTranslation.updateMany({businessId:user.businessId,[`${key}Status`]:"SUGGESTED",[key]:{$nin:[null,""]}},{$set:{[`${key}Status`]:"APPROVED"}});
    await writeAuditLog({businessId:user.businessId,userId:user.id,userName:user.fullName,action:"APPROVE_KITCHEN_TRANSLATIONS",entityType:"Business",entityId:user.businessId,description:`Approved ${result.modifiedCount} suggested ${key==="sd"?"Sindhi":"Urdu"} kitchen translations`});
    revalidatePath("/settings/translations");
    return{ok:true as const,approved:result.modifiedCount};
  }catch(error){return fail(error)}
}
