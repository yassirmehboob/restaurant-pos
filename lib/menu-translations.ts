import "server-only";
import { kitchenLanguage,localLanguageOf,namesToTranslate,type LocalLanguage,type TranslationMap } from "@/lib/kitchen-language";
import { MenuTranslation } from "@/models/MenuTranslation";
import { Product } from "@/models/Product";
import { Deal } from "@/models/Deal";

// Every English name a kitchen ticket can show: each active item, each of its sizes as ordered ("Pizza (Small)"), and each deal.
export async function menuNames(businessId:string){
  const [products,deals]=await Promise.all([
    Product.find({businessId,isActive:true}).select("name variants.name").sort({sortOrder:1,name:1}).lean(),
    Deal.find({businessId,isActive:true}).select("name").sort({sortOrder:1,name:1}).lean(),
  ]);
  const names:{text:string;kind:"Item"|"Size"|"Deal"}[]=[],seen=new Set<string>();
  const add=(text:string,kind:"Item"|"Size"|"Deal")=>{const clean=text.trim();if(clean&&!seen.has(clean)){seen.add(clean);names.push({text:clean,kind})}};
  for(const product of products){add(product.name,"Item");for(const variant of product.variants??[])add(`${product.name} (${variant.name})`,"Size")}
  for(const deal of deals)add(deal.name,"Deal");
  return names;
}

export async function translationsFor(businessId:unknown,names:string[],language:LocalLanguage):Promise<TranslationMap>{
  if(!names.length)return{};
  // Only approved wording prints; a suggestion waiting for review leaves the name in English.
  const rows=await MenuTranslation.find({businessId,text:{$in:names},[language]:{$nin:[null,""]},[`${language}Status`]:"APPROVED"}).select(`text ${language}`).lean();
  return Object.fromEntries(rows.map(row=>[String(row.text),String(row[language])]));
}

type KitchenOrder={items:{nameSnapshot:string;dealItemsSnapshot?:{name:string}[]|null}[]};
// The translations a kitchen ticket needs, in the business's kitchen ticket language. English tickets need none.
export async function kitchenTranslations(businessId:unknown,order:KitchenOrder,business:{kitchenReceiptLanguage?:string|null}){
  const language=localLanguageOf(kitchenLanguage(business.kitchenReceiptLanguage));
  if(!language)return{};
  const names=namesToTranslate(order.items.flatMap(line=>[line.nameSnapshot,...(line.dealItemsSnapshot??[]).map(item=>item.name)]));
  return translationsFor(businessId,names,language);
}
