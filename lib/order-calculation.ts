export type PricedLine={key:string;name:string;quantity:number;unitPrice:number;taxRate:number;isTaxInclusive:boolean};
export type CalculatedLine=PricedLine&{baseAmount:number;discountAmount:number;taxAmount:number;lineTotal:number};

const money=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

// Splits an invoice discount across lines in proportion to their value, to the exact paisa.
function allocateDiscount(bases:number[],discount:number){
  const totalCents=Math.round(bases.reduce((sum,base)=>sum+base,0)*100),discountCents=Math.round(discount*100);
  if(!discountCents||!totalCents)return bases.map(()=>0);
  const raw=bases.map(base=>Math.round(base*100)*discountCents/totalCents),shares=raw.map(Math.floor);
  let remainder=discountCents-shares.reduce((sum,share)=>sum+share,0);
  for(const index of raw.map((value,index)=>({index,fraction:value-Math.floor(value)})).sort((a,b)=>b.fraction-a.fraction).map(entry=>entry.index)){if(remainder<=0)break;shares[index]++;remainder--}
  return shares.map(share=>share/100);
}

// The discount reduces the item subtotal before tax; delivery charges are never discounted.
export function calculateOrderPreview(lines:PricedLine[],deliveryCharge:number,invoiceTaxRate?:number,discount=0){
  const priced=lines.map(line=>invoiceTaxRate!==undefined?{...line,taxRate:invoiceTaxRate,isTaxInclusive:false}:line);
  const bases=priced.map(line=>money(line.unitPrice*line.quantity));
  const subtotal=money(bases.reduce((sum,base)=>sum+base,0));
  const discountAmount=money(Math.min(Math.max(discount,0),subtotal));
  const shares=allocateDiscount(bases,discountAmount);
  const calculatedLines:CalculatedLine[]=priced.map((line,index)=>{
    const baseAmount=bases[index],lineDiscount=shares[index],net=money(baseAmount-lineDiscount);
    const rate=line.taxRate/100;
    const taxAmount=money(!rate?0:line.isTaxInclusive?net-(net/(1+rate)):net*rate);
    return{...line,baseAmount,discountAmount:lineDiscount,taxAmount,lineTotal:money(net+(line.isTaxInclusive?0:taxAmount))};
  });
  const taxAmount=money(calculatedLines.reduce((sum,line)=>sum+line.taxAmount,0));
  const exclusiveTax=money(calculatedLines.reduce((sum,line)=>sum+(line.isTaxInclusive?0:line.taxAmount),0));
  return{lines:calculatedLines,subtotal,discountAmount,taxAmount,deliveryCharge:money(deliveryCharge),grandTotal:money(subtotal-discountAmount+exclusiveTax+deliveryCharge)};
}
