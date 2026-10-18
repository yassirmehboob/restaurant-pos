export function ItemTax({rate=0,current=false,className=""}:{rate?:number;current?:boolean;className?:string}){
 if(!(rate>0))return null;
 return <small className={'item-tax '+className}>Item tax: {rate}% ({current?"current, ":""}info only)</small>;
}
