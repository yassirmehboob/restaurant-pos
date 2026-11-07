import { requirePagePermission } from "@/data/auth";
import { MasterHeader } from "@/components/master-shell";
import { KitchenTranslations,type TranslationRow } from "@/components/kitchen-translations";
import { connectToDatabase } from "@/lib/db";
import { kitchenLanguage,localLanguageOf,KITCHEN_LANGUAGE_LABELS } from "@/lib/kitchen-language";
import { menuNames } from "@/lib/menu-translations";
import { modelDirectory,modelReady } from "@/lib/translation/nllb";
import { Business } from "@/models/Business";
import { MenuTranslation } from "@/models/MenuTranslation";

export default async function KitchenTranslationsPage(){
  const user=await requirePagePermission("settings");
  await connectToDatabase();
  const [names,business]=await Promise.all([menuNames(user.businessId),Business.findOne({_id:user.businessId,isActive:true}).select("kitchenReceiptLanguage").lean()]);
  const saved=await MenuTranslation.find({businessId:user.businessId,text:{$in:names.map(item=>item.text)}}).lean();
  const byText=new Map(saved.map(row=>[String(row.text),row]));
  const rows:TranslationRow[]=names.map(({text,kind})=>{const row=byText.get(text);return{text,kind,sd:row?.sd??"",sdStatus:row?.sdStatus??"",ur:row?.ur??"",urStatus:row?.urStatus??""}});
  const language=kitchenLanguage(business?.kitchenReceiptLanguage);
  return <main className="master-page kitchen-translations-page">
    <MasterHeader eyebrow="Kitchen tickets" title="Kitchen translations" description={`Sindhi and Urdu item names for printed kitchen tickets. Kitchen tickets now print: ${KITCHEN_LANGUAGE_LABELS[language]} (change it in Printing settings).`}/>
    <KitchenTranslations rows={rows} initialLanguage={localLanguageOf(language)??"sd"} modelReady={modelReady()} modelFolder={modelDirectory()}/>
  </main>;
}
