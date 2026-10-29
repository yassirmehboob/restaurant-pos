import { createCipheriv,createDecipheriv,createHmac,randomBytes } from "node:crypto";
function key(secret){if(!secret||secret.length<32)throw new Error("SMS encryption is unavailable.");return createHmac("sha256",secret).update("restaurant-pos/sms-token/v1").digest()}
export function encryptSmsToken(token,secret,businessId){
 const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",key(secret),iv);cipher.setAAD(Buffer.from(String(businessId)));
 const ciphertext=Buffer.concat([cipher.update(token,"utf8"),cipher.final()]);
 return [iv,cipher.getAuthTag(),ciphertext].map(part=>part.toString("base64url")).join(".");
}
export function decryptSmsToken(encoded,secret,businessId){
 const [iv,tag,ciphertext]=encoded.split(".").map(part=>Buffer.from(part,"base64url"));
 const decipher=createDecipheriv("aes-256-gcm",key(secret),iv);decipher.setAAD(Buffer.from(String(businessId)));decipher.setAuthTag(tag);
 return Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString("utf8");
}
