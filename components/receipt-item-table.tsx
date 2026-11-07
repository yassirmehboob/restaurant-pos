import type { ReactNode } from "react";

type Row={key:string|number;name:ReactNode;price?:string;quantity:number;amount?:string};

// Browser print version of lib/receipt-lines.ts. With prices, each item shows its name across the full row with # | Price | Qty | Amount on the row below;
// without prices (kitchen tickets) it stays # | Item | Qty on one row.
export function ReceiptItemTable({rows,prices,className=""}:{rows:Row[];prices:boolean;className?:string}){
  if(!prices)return <table className={`receipt-item-table ${className}`}><thead><tr><th scope="col">#</th><th scope="col">Item</th><th scope="col">Qty</th></tr></thead><tbody>{rows.map((row,index)=><tr key={row.key}><td>{index+1}</td><td>{row.name}</td><td>{row.quantity}</td></tr>)}</tbody></table>;
  return <table className={`receipt-item-table receipt-item-stacked ${className}`}>
    <thead><tr><th className="receipt-item-name" scope="col" colSpan={4}>Item</th></tr><tr className="receipt-item-numbers"><th scope="col">#</th><th scope="col">Price</th><th scope="col">Qty</th><th scope="col">Amount</th></tr></thead>
    {rows.map((row,index)=><tbody key={row.key}><tr><td className="receipt-item-name" colSpan={4}>{row.name}</td></tr><tr className="receipt-item-numbers"><td>{index+1}</td><td>{row.price}</td><td>{row.quantity}</td><td>{row.amount}</td></tr></tbody>)}
  </table>;
}
