import { weightCost,weightPrice } from "@/lib/weight";

// Share of the items' normal profit a suggested deal price keeps; the rest is the customer's saving.
export const DEAL_PROFIT_KEPT=0.75;

export type DealPricingProduct={price:number;cost:number;byWeight?:boolean;sizes?:{name:string;price:number;cost:number}[]};
export type DealPricingRow={productId:string;quantity:number;weightGrams?:number;variantName?:string};

// Normal sale and cost of one deal row at its size or weight; null until the row is complete.
export function dealRowPrice(product:DealPricingProduct|undefined,row:DealPricingRow){
  const quantity=Number(row.quantity);
  if(!product||!Number.isInteger(quantity)||quantity<1)return null;
  if(product.byWeight)return row.weightGrams?{sale:weightPrice(product.price,row.weightGrams)*quantity,cost:weightCost(product.cost,row.weightGrams)*quantity}:null;
  if(product.sizes?.length){const size=product.sizes.find(item=>item.name===row.variantName);return size?{sale:size.price*quantity,cost:size.cost*quantity}:null}
  return{sale:product.price*quantity,cost:product.cost*quantity};
}

// Items total at normal prices, and a suggested deal price: cost plus most of the normal profit, to the nearest Rs 10.
export function dealPricing(products:Map<string,DealPricingProduct>,rows:DealPricingRow[]){
  let total=0,cost=0,counted=0;
  for(const row of rows){const line=dealRowPrice(products.get(row.productId),row);if(!line)continue;total+=line.sale;cost+=line.cost;counted++}
  const suggested=total>cost?Math.round((cost+(total-cost)*DEAL_PROFIT_KEPT)/10)*10:total;
  return{total,cost,suggested,counted,complete:counted===rows.length};
}
