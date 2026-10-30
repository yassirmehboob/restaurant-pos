import "server-only";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

// Optional: with a QZ certificate + private key, QZ Tray trusts this site and stops asking "Allow?".
// Without them printing still works, but each PC must click Allow when QZ Tray asks.
const read=(path:string|undefined)=>{if(!path)return"";try{return readFileSync(path,"utf8")}catch{return""}};
export const qzCertificate=()=>read(process.env.QZ_CERTIFICATE_PATH);
export function qzSign(message:string){
  const key=read(process.env.QZ_PRIVATE_KEY_PATH);
  if(!key)return"";
  return createSign("SHA512").update(message).sign(key,"base64");
}
