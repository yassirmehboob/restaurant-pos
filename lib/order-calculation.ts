export type PricedLine={key:string;name:string;quantity:number;unitPrice:number;taxRate:number;isTaxInclusive:boolean};
export type CalculatedLine=PricedLine&{baseAmount:number;taxAmount:number;lineTotal:number};

const money=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;

export function calculateOrderPreview(lines:PricedLine[],deliveryCharge:number,invoiceTaxRate?:number){
  const calculatedLines:CalculatedLine[]=lines.map(line=>{
    if(invoiceTaxRate!==undefined)line={...line,taxRate:invoiceTaxRate,isTaxInclusive:false};
    const baseAmount=money(line.unitPrice*line.quantity);
    const rate=line.taxRate/100;
    const taxAmount=money(!rate?0:line.isTaxInclusive?baseAmount-(baseAmount/(1+rate)):baseAmount*rate);
    return{...line,baseAmount,taxAmount,lineTotal:money(baseAmount+(line.isTaxInclusive?0:taxAmount))};
  });
  const subtotal=money(calculatedLines.reduce((sum,line)=>sum+line.baseAmount,0));
  const taxAmount=money(calculatedLines.reduce((sum,line)=>sum+line.taxAmount,0));
  const exclusiveTax=money(calculatedLines.reduce((sum,line)=>sum+(line.isTaxInclusive?0:line.taxAmount),0));
  return{lines:calculatedLines,subtotal,taxAmount,deliveryCharge:money(deliveryCharge),grandTotal:money(subtotal+exclusiveTax+deliveryCharge)};
}
