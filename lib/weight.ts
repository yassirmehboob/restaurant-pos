// Weight items are priced per KG; weights travel as whole grams to avoid float drift.
export const SELL_BY=["UNIT","WEIGHT"] as const;
export type SellBy=(typeof SELL_BY)[number];
export const MIN_WEIGHT_GRAMS=125,MAX_WEIGHT_GRAMS=50000;
export const QUICK_WEIGHTS=[125,250,500,750,1000,1250,1500,2000];

// Below 1 KG the weight reads in grams (250 g); from 1 KG up it reads in KG (1.75 KG).
export function formatWeight(grams:number){return grams<1000?`${grams} g`:`${Number((grams/1000).toFixed(3))} KG`}
// Sale prices round to the whole rupee; cost keeps paisa so profit reports stay accurate.
export function weightPrice(pricePerKg:number,grams:number){return Math.round(pricePerKg*grams/1000)}
export function weightCost(costPerKg:number,grams:number){return Math.round(costPerKg*grams/10)/100}
export function weightedName(name:string,grams:number){return `${name} (${formatWeight(grams)})`}
// A deal component carries its size ("Pizza (Large)") or fixed weight ("Mutton Karahi (500 g)") in its name, as order lines do.
export function dealComponentName(name:string,item:{weightGrams?:number|null;variantName?:string|null}){return item.weightGrams?weightedName(name,item.weightGrams):item.variantName?`${name} (${item.variantName})`:name}
export function validWeight(grams:unknown):grams is number{return Number.isInteger(grams)&&(grams as number)>=MIN_WEIGHT_GRAMS&&(grams as number)<=MAX_WEIGHT_GRAMS}

type PricedProduct={name:string;sellBy?:string|null;salePrice:number;costPrice:number};
// Server-side pricing for one product line: KG items need a weight, piece items must not have one.
export function productLinePrice(product:PricedProduct,variant:{name:string;salePrice:number;costPrice:number}|undefined,weightGrams?:number){
 if(product.sellBy!=="WEIGHT"){if(weightGrams!==undefined)throw new Error(`${product.name} is not sold by weight.`);return{name:variant?`${product.name} (${variant.name})`:product.name,unitPrice:variant?.salePrice??product.salePrice,unitCost:variant?.costPrice??product.costPrice}}
 if(!validWeight(weightGrams))throw new Error(`Enter a weight of at least ${formatWeight(MIN_WEIGHT_GRAMS)} for ${product.name}.`);
 return{name:weightedName(product.name,weightGrams),unitPrice:weightPrice(product.salePrice,weightGrams),unitCost:weightCost(product.costPrice,weightGrams),weightGrams,pricePerKg:product.salePrice};
}
