import { dealPricing,type DealPricingProduct } from "@/lib/deal-pricing";
import { MAX_WEIGHT_GRAMS,formatWeight } from "@/lib/weight";

// Builds ready-to-edit deal ideas from the menu and what sells most. Pure, so it runs in the browser
// as the owner changes the number of persons, and in tests.

export type MenuProduct={id:string;name:string;category:string;price:number;cost:number;byWeight:boolean;sizes:{name:string;price:number;cost:number}[];sold:number;menuOrder:number};
export type SuggestedItem={productId:string;name:string;quantity:number;variantName?:string;weightGrams?:number};
export type SuggestedDeal={key:string;group:"REGULAR"|"BREAKFAST";name:string;description:string;persons:number;reason:string;items:SuggestedItem[];total:number;cost:number;price:number;similarTo?:string};
export type ExistingDeal={name:string;productIds:string[]};
type Role="MAIN"|"SIDE"|"DRINK"|"BREAD"|"DESSERT";

export const SALES_WINDOW_DAYS=90;
const BREAKFAST=/breakfast|nashta|nashtay|morning/i;
const CATEGORY_ROLES:[Role,RegExp][]=[
  ["DRINK",/drink|beverage|juice|shake|soda|cold ?drink|tea|coffee|lassi|water|smoothie|mocktail/i],
  ["DESSERT",/dessert|sweet|ice ?cream|kheer|cake|mithai|kulfi/i],
  ["BREAD",/bread|naan|roti|paratha|tandoor/i],
  ["SIDE",/side|fries|starter|appeti[sz]er|snack|salad|raita/i],
];
const ITEM_DRINK=/\b(tea|chai|coffee|lassi|juice|milk|doodh|shake|pepsi|cola|coke|sprite|7up|fanta|water|soda)\b/i;
// Plain breads only: "Butter Naan" is bread, while "Aloo Paratha" and "Halwa Puri" are dishes that already include it.
const ITEM_BREAD=/^(plain |butter |roghni |tandoori |garlic |sada |simple |cheese )?(naan|roti|paratha|puri|poori|kulcha|bread|toast|chapati)s?$/i;
const HAS_BREAD=/\b(naan|roti|paratha|puri|poori|kulcha|bread|toast|chapati)s?\b/i;
const BREAKFAST_DRINK=/\b(tea|chai|coffee|lassi|juice|milk|doodh)\b/i;
// Mains that are eaten with bread rather than fries.
const DESI=/desi|karahi|handi|curry|biryani|pulao|rice|bbq|tikka|qorma|korma|nihari|haleem|daal|dal\b|pakistani|tandoor/i;

export function isBreakfast(product:MenuProduct){return BREAKFAST.test(product.category)}
export function roleOf(product:MenuProduct):Role{
  const byCategory=CATEGORY_ROLES.find(([,pattern])=>pattern.test(product.category))?.[0];
  if(byCategory)return byCategory;
  if(ITEM_DRINK.test(product.name))return "DRINK";
  if(ITEM_BREAD.test(product.name.trim()))return "BREAD";
  return "MAIN";
}
const isDesi=(product:MenuProduct)=>product.byWeight||DESI.test(product.category);

// Highest selling first; items never sold keep their menu order.
export function rankProducts(products:MenuProduct[]){return[...products].sort((a,b)=>b.sold-a.sold||a.menuOrder-b.menuOrder||a.name.localeCompare(b.name))}

// How many people one of each size feeds, read from its name, else from its place in the price order.
function servings(name:string,index:number){
  if(/extra ?large|\bxl\b|family|jumbo/i.test(name))return 4;
  if(/large/i.test(name))return 3;
  if(/medium|regular/i.test(name))return 2;
  if(/small|personal|mini|half/i.test(name))return 1;
  return index+1;
}
function volumeMl(name:string){
  if(/\b(tin|can)\b/i.test(name))return 330;
  const match=/(\d+(?:\.\d+)?)\s*(ml|l|ltr|litre|liter)\b/i.exec(name);
  if(!match)return 0;
  return match[2].toLowerCase()==="ml"?Number(match[1]):Number(match[1])*1000;
}

// Portion of one item for a number of people: a size for sized items, a weight for KG items, otherwise one each.
function portion(product:MenuProduct,persons:number,role:Role):SuggestedItem{
  const base={productId:product.id,name:product.name};
  if(product.byWeight){const grams=Math.min(MAX_WEIGHT_GRAMS,Math.max(250,persons*250));return{...base,name:`${product.name} (${formatWeight(grams)})`,quantity:1,weightGrams:grams}}
  if(!product.sizes.length)return{...base,quantity:persons};
  const sizes=[...product.sizes].sort((a,b)=>a.price-b.price);
  const sized=(size:{name:string},quantity:number)=>({...base,name:`${product.name} (${size.name})`,quantity,variantName:size.name});
  if(role==="DRINK"){
    const volumes=sizes.map(size=>({size,ml:volumeMl(size.name)}));
    if(volumes.some(item=>item.ml)){
      const personal=volumes.filter(item=>item.ml>=200&&item.ml<=600).sort((a,b)=>a.size.price-b.size.price)[0];
      if(persons<=2&&personal)return sized(personal.size,persons);
      const need=persons*300,bottles=volumes.filter(item=>item.ml>=1000).sort((a,b)=>a.ml-b.ml);
      const fits=bottles.find(item=>item.ml>=need);
      if(fits)return sized(fits.size,1);
      if(bottles.length){const biggest=bottles[bottles.length-1];return sized(biggest.size,Math.ceil(need/biggest.ml))}
      if(personal)return sized(personal.size,persons);
    }
    return persons<=2?sized(sizes[0],persons):sized(sizes[sizes.length-1],Math.ceil(persons/4));
  }
  const fitting=sizes.map((size,index)=>({size,serves:servings(size.name,index)}));
  const choice=[...fitting].reverse().find(item=>item.serves<=persons)??fitting[0];
  return sized(choice.size,Math.max(1,Math.round(persons/choice.serves)));
}

const label=(persons:number)=>persons===1?"Solo":persons===2?"Duo":persons<=4?"Family":persons<=8?"Party":"Mega";
const itemKey=(items:SuggestedItem[])=>items.map(item=>`${item.productId}:${item.variantName??""}:${item.weightGrams??""}:${item.quantity}`).sort().join("|");
const listItems=(items:SuggestedItem[])=>items.map(item=>`${item.quantity} x ${item.name}`).join(", ");

export function suggestDeals(products:MenuProduct[],persons:number,options:{existing?:ExistingDeal[];limit?:number}={}){
  const people=Math.min(20,Math.max(1,Math.round(persons)||1)),limit=options.limit??6;
  const ranked=rankProducts(products),anySales=ranked.some(item=>item.sold>0);
  const pricing=new Map<string,DealPricingProduct>(products.map(item=>[item.id,{price:item.price,cost:item.cost,byWeight:item.byWeight,sizes:item.sizes}]));
  const rankIn=(list:MenuProduct[],product:MenuProduct)=>list.indexOf(product)+1;
  const soldText=(product:MenuProduct)=>product.sold>0?` (${product.sold} sold in the last ${SALES_WINDOW_DAYS} days)`:"";
  const existing=(options.existing??[]).map(deal=>({name:deal.name,ids:[...new Set(deal.productIds)].sort().join("|")}));
  const seen=new Set<string>();

  const build=(group:SuggestedDeal["group"],anchor:MenuProduct,anchorRank:number,items:SuggestedItem[],partners:string[]):SuggestedDeal|null=>{
    const merged=items.filter(item=>item.quantity>0);
    const key=itemKey(merged);if(!merged.length||seen.has(key))return null;seen.add(key);
    const price=dealPricing(pricing,merged.map(item=>({productId:item.productId,quantity:item.quantity,weightGrams:item.weightGrams,variantName:item.variantName})));
    const ids=[...new Set(merged.map(item=>item.productId))].sort().join("|"),similar=existing.find(deal=>deal.ids===ids);
    const reason=anySales?`${anchor.name} is your #${anchorRank} ${group==="BREAKFAST"?"breakfast ":""}best seller${soldText(anchor)}.${partners.length?` Paired with ${partners.join(" and ")}.`:""}`:`No sales yet, so items follow your menu order.${partners.length?` Paired with ${partners.join(" and ")}.`:""}`;
    const name=group==="BREAKFAST"?`${anchor.name} Breakfast ${label(people)}`:`${anchor.name} ${label(people)} Deal`;
    return{key,group,name:name.slice(0,120),description:`Serves ${people}: ${listItems(merged)}`.slice(0,500),persons:people,reason,items:merged,total:price.total,cost:price.cost,price:price.suggested,similarTo:similar?.name};
  };
  const topOf=(list:MenuProduct[],role:Role,exclude?:(product:MenuProduct)=>boolean)=>list.find(item=>roleOf(item)===role&&!exclude?.(item));
  const partnerText=(product:MenuProduct|undefined,what:string)=>product?`your top ${what} ${product.name}`:"";

  // Lunch and dinner: never uses breakfast items.
  const regular=ranked.filter(item=>!isBreakfast(item)),mains=regular.filter(item=>roleOf(item)==="MAIN");
  // Anchors follow the sales order, at most two per category first so the ideas are varied.
  const perCategory=new Map<string,number>(),anchors:MenuProduct[]=[];
  for(const main of mains){const used=perCategory.get(main.category)??0;if(used<2){anchors.push(main);perCategory.set(main.category,used+1)}}
  for(const main of mains)if(!anchors.includes(main))anchors.push(main);
  const regularDeals:SuggestedDeal[]=[];
  for(const anchor of anchors){
    if(regularDeals.length>=limit)break;
    const desi=isDesi(anchor);
    // For 3+ people a second best seller from another category adds variety; skip partners that repeat an earlier idea.
    const seconds=people>=3?mains.filter(item=>item!==anchor&&item.category!==anchor.category&&isDesi(item)===desi):[];
    let deal:SuggestedDeal|null=null;
    for(const second of [...seconds,undefined]){
    const items:SuggestedItem[]=[],partners:string[]=[];
    const anchorPeople=second?Math.ceil(people/2):people;
    items.push(portion(anchor,anchorPeople,"MAIN"));
    if(second){items.push(portion(second,people-anchorPeople,"MAIN"));partners.push(`${second.name} for variety`)}
    if(desi){
      const bread=topOf(regular,"BREAD");if(bread){items.push(portion(bread,people,"BREAD"));partners.push(partnerText(bread,"bread"))}
      const raita=regular.find(item=>roleOf(item)==="SIDE"&&/raita|salad/i.test(item.name));if(raita)items.push(portion(raita,Math.ceil(people/2),"SIDE"));
    }else{
      const side=topOf(regular,"SIDE",item=>/raita|salad/i.test(item.name));if(side){items.push(portion(side,Math.ceil(people/2),"SIDE"));partners.push(partnerText(side,"side"))}
    }
    const drink=topOf(regular,"DRINK");if(drink){items.push(portion(drink,people,"DRINK"));partners.push(partnerText(drink,"drink"))}
    if(people>=4){const dessert=topOf(regular,"DESSERT");if(dessert)items.push(portion(dessert,Math.ceil(people/2),"DESSERT"))}
    deal=build("REGULAR",anchor,rankIn(mains,anchor),items,partners.filter(Boolean));if(deal)break;
    }
    if(deal)regularDeals.push(deal);
  }

  // Breakfast: only breakfast items, plus a hot or breakfast drink from the drinks menu when breakfast has none.
  const breakfast=ranked.filter(isBreakfast),breakfastRole=(item:MenuProduct):Role=>ITEM_DRINK.test(item.name)?"DRINK":ITEM_BREAD.test(item.name.trim())?"BREAD":"MAIN";
  const breakfastMains=breakfast.filter(item=>breakfastRole(item)==="MAIN"),breakfastDeals:SuggestedDeal[]=[];
  const breakfastBread=breakfast.find(item=>breakfastRole(item)==="BREAD");
  const breakfastDrink=breakfast.find(item=>breakfastRole(item)==="DRINK")??regular.find(item=>roleOf(item)==="DRINK"&&BREAKFAST_DRINK.test(item.name));
  for(const anchor of breakfastMains.length?breakfastMains:breakfast){
    if(breakfastDeals.length>=Math.min(limit,4))break;
    const items=[portion(anchor,people,"MAIN")],partners:string[]=[];
    if(breakfastBread&&breakfastBread!==anchor&&!HAS_BREAD.test(anchor.name)){items.push(portion(breakfastBread,people,"BREAD"));partners.push(partnerText(breakfastBread,"bread"))}
    if(breakfastDrink&&breakfastDrink!==anchor){items.push(portion(breakfastDrink,people,"DRINK"));partners.push(partnerText(breakfastDrink,"drink"))}
    const deal=build("BREAKFAST",anchor,rankIn(breakfast,anchor),items,partners.filter(Boolean));if(deal)breakfastDeals.push(deal);
  }
  return{persons:people,anySales,regular:regularDeals,breakfast:breakfastDeals,hasBreakfast:breakfast.length>0};
}
