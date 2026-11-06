// Keeps digits and a single decimal point, so "12." can be typed on the way to "12.5".
export const cleanDecimal=(value:string)=>{const [whole,...rest]=value.replace(/[^\d.]/g,"").split(".");return rest.length?`${whole}.${rest.join("")}`:whole};

// Turns whatever was typed or pasted ("1,25,000", "007", ".5") into a plain amount with at most two decimals.
export function normalizeAmount(text:string){
  const [whole,decimals]=cleanDecimal(text).split(".");
  const digits=whole.replace(/^0+(?=\d)/,"");
  return decimals===undefined?digits:`${digits||"0"}.${decimals.slice(0,2)}`;
}

export const groupAmount=(amount:string)=>{
  const [whole,decimals]=amount.split(".");
  const grouped=whole.replace(/\B(?=(\d{3})+(?!\d))/g,",");
  return decimals===undefined?grouped:`${grouped}.${decimals}`;
};

const ones=["","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
const tens=["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
const belowHundred=(value:number)=>value<20?ones[value]:tens[Math.floor(value/10)]+(value%10?`-${ones[value%10]}`:"");
function wholeWords(value:number):string{
  const parts:string[]=[];
  for(const [size,name] of [[10000000,"crore"],[100000,"lakh"],[1000,"thousand"],[100,"hundred"]] as const){
    const count=Math.floor(value/size);
    if(count){parts.push(`${wholeWords(count)} ${name}`);value-=count*size}
  }
  if(value)parts.push(belowHundred(value));
  return parts.join(" ");
}

// Reads the amount the way cash is counted here, in lakh and crore: "One lakh twenty-five thousand rupees".
export function amountInWords(amount:string){
  const [whole,decimals=""]=amount.split(".");
  const rupees=Number(whole||0),paisa=Number(decimals.padEnd(2,"0").slice(0,2));
  const rupeeText=rupees===1?"one rupee":`${rupees?wholeWords(rupees):"zero"} rupees`;
  const text=paisa?`${rupeeText} and ${wholeWords(paisa)} paisa`:rupeeText;
  return text[0].toUpperCase()+text.slice(1);
}

// Where the caret belongs in the formatted text: after the same number of characters, ignoring commas.
export function caretAfterFormatting(formatted:string,charactersBefore:number){
  if(charactersBefore<=0)return 0;
  let seen=0;
  for(let index=0;index<formatted.length;index++){
    if(formatted[index]!==","&&++seen===charactersBefore)return index+1;
  }
  return formatted.length;
}
