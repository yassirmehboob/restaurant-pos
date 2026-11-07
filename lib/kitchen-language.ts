// Language of the item names on printed kitchen tickets. Translations are looked up by the English name,
// so products, their sizes, deals and deal components all share one list the owner can review.
export const KITCHEN_LANGUAGES=["EN","SD","UR","EN_SD","EN_UR"] as const;
export type KitchenLanguage=(typeof KITCHEN_LANGUAGES)[number];
export const KITCHEN_LANGUAGE_LABELS:Record<KitchenLanguage,string>={EN:"English",SD:"Sindhi only",UR:"Urdu only",EN_SD:"English & Sindhi",EN_UR:"English & Urdu"};
export type LocalLanguage="sd"|"ur";
export const LOCAL_LANGUAGE_LABELS:Record<LocalLanguage,string>={sd:"Sindhi",ur:"Urdu"};

export const kitchenLanguage=(value:unknown):KitchenLanguage=>KITCHEN_LANGUAGES.includes(value as KitchenLanguage)?value as KitchenLanguage:"EN";
export const localLanguageOf=(language:KitchenLanguage):LocalLanguage|null=>language.endsWith("SD")?"sd":language.endsWith("UR")?"ur":null;
// "LOCAL" prints only the translation (English when there is none); "BOTH" prints English with the translation under it.
export type NameView="EN"|"LOCAL"|"BOTH";
export const nameViewOf=(language:KitchenLanguage):NameView=>language==="EN"?"EN":language.startsWith("EN_")?"BOTH":"LOCAL";

// English name -> translation in one language.
export type TranslationMap=Record<string,string>;
// A sold-by-weight line is stored as "Mutton Karahi (500 g)": the item is translated and the weight kept as printed.
export function localName(name:string,translations:TranslationMap):string|undefined{
  const exact=translations[name]?.trim();
  if(exact)return exact;
  const match=/^(.*\S) \(([^()]+)\)$/.exec(name);
  const base=match?translations[match[1]]?.trim():undefined;
  return base?`${base} (${match![2]})`:undefined;
}
// The English names a ticket needs translated, including the base name of sized and weighed items.
export function namesToTranslate(names:string[]){
  const all=new Set<string>();
  for(const name of names){const trimmed=name.trim();if(!trimmed)continue;all.add(trimmed);const match=/^(.*\S) \(([^()]+)\)$/.exec(trimmed);if(match)all.add(match[1])}
  return[...all];
}
