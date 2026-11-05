import ExcelJS from "exceljs";

type ExportCategory={_id:unknown;name:string};
type ExportProduct={categoryId:unknown;name:string;sellBy?:string|null;salePrice:number;variants?:{name:string;salePrice:number}[]|null;isActive?:boolean;isAvailable?:boolean};

const COLUMNS=[
 {header:"Category",width:24},
 {header:"Item Name",width:32},
 {header:"Sold By",width:18},
 {header:"Sale Price",width:12},
 {header:"Size Name",width:18},
 {header:"Size Sale Price",width:16},
 {header:"Status",width:14},
];
const MONEY_COLUMNS=[4,6];

// An item with sizes takes one row per size, so every row can be sorted and filtered on its own.
export function itemExportRows(categories:ExportCategory[],products:ExportProduct[]){
 const names=new Map(categories.map(category=>[String(category._id),category.name]));
 const categoryName=(product:ExportProduct)=>names.get(String(product.categoryId))??"";
 const compare=(a:string,b:string)=>a.localeCompare(b,undefined,{sensitivity:"base",numeric:true});
 // A/Z by category then item; an item whose category no longer exists goes last. Sizes keep their saved order.
 return [...products].sort((a,b)=>Number(!categoryName(a))-Number(!categoryName(b))||compare(categoryName(a),categoryName(b))||compare(a.name,b.name)).flatMap(product=>{
  const status=product.isActive===false?"Deactivated":product.isAvailable===false?"Unavailable":"Available";
  const base=[categoryName(product),product.name,product.sellBy==="WEIGHT"?"Weight (per KG)":"Piece / Plate",product.salePrice];
  const sizes=product.variants??[];
  return sizes.length?sizes.map(size=>[...base,size.name,size.salePrice,status]):[[...base,"","",status]];
 });
}

export async function itemExportWorkbook(categories:ExportCategory[],products:ExportProduct[]){
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet("Items",{views:[{state:"frozen",ySplit:1}]});
 sheet.columns=COLUMNS;
 sheet.addRows(itemExportRows(categories,products));
 sheet.getRow(1).font={bold:true};
 for(const column of MONEY_COLUMNS)sheet.getColumn(column).numFmt="#,##0.##";
 sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:COLUMNS.length}};
 return workbook.xlsx.writeBuffer();
}
