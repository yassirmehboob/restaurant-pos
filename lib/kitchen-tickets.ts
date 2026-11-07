// Splits a kitchen order into one ticket per menu category, so each kitchen counter gets its own slip.
// A deal is split by its items' categories: the burger counter sees the deal with only the burgers,
// the drinks counter the same deal with only the drinks.

export type TicketCategory={categoryName?:string|null;categorySort?:number|null};
type Component=TicketCategory&{name:string;quantity:number};
type Line=TicketCategory&{dealItemsSnapshot?:Component[]|null};
export type KitchenTicket<L>={category:string;items:L[]};

// Items whose product (or category) was deleted still print, on their own ticket after the real categories.
export const UNCATEGORISED="Other items";
const LAST=Number.MAX_SAFE_INTEGER;

export function kitchenTickets<L extends Line>(items:L[]):KitchenTicket<L>[]{
  const tickets=new Map<string,{category:string;sort:number;items:L[]}>();
  const add=(category:TicketCategory,line:L)=>{
    const name=category.categoryName?.trim()||UNCATEGORISED,sort=name===UNCATEGORISED?LAST:category.categorySort??0;
    const ticket=tickets.get(name)??{category:name,sort,items:[]};
    ticket.items.push(line);tickets.set(name,ticket);
  };
  for(const line of items){
    const components=line.dealItemsSnapshot??[];
    if(!components.length){add(line,line);continue}
    const parts=new Map<string,{category:TicketCategory;components:Component[]}>();
    for(const component of components){const key=component.categoryName?.trim()||UNCATEGORISED,part=parts.get(key)??{category:component,components:[]};part.components.push(component);parts.set(key,part)}
    for(const part of parts.values())add(part.category,{...line,dealItemsSnapshot:part.components});
  }
  return [...tickets.values()].sort((a,b)=>a.sort-b.sort||a.category.localeCompare(b.category)).map(({category,items})=>({category,items}));
}

// Tickets for one kitchen print: the whole order, or one per category; then, when the business asks for it,
// a copy of the whole order the waiter keeps to check the table's food against.
export const WAITER_COPY="Waiter copy";
export type PrintedTicket<L>={category:string;items:L[];waiterCopy?:boolean};
export function orderTickets<L extends Line>(items:L[],options:{perCategory?:boolean|null;waiterCopy?:boolean|null}):PrintedTicket<L>[]{
  const kitchen:PrintedTicket<L>[]=options.perCategory&&items.length?kitchenTickets(items):[{category:"",items}];
  return options.waiterCopy?[...kitchen,{category:WAITER_COPY,items,waiterCopy:true}]:kitchen;
}
