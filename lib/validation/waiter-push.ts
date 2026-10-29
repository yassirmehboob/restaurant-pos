import { z } from "zod";
export const pushEndpoint=z.string().url().max(2048).refine(value=>{
 const url=new URL(value);
 return url.protocol==="https:"&&!url.username&&!url.password&&!url.port&&(
  ["fcm.googleapis.com","updates.push.services.mozilla.com","web.push.apple.com"].includes(url.hostname)||url.hostname.endsWith(".notify.windows.com")
 );
},"Unsupported push service.");
export const pushSubscriptionSchema=z.object({endpoint:pushEndpoint,keys:z.object({p256dh:z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).min(80).max(100),auth:z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).min(20).max(30)})});
