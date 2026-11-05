import { getCurrentUser } from "@/data/auth";
import { renewSession, sessionSecondsLeft } from "@/lib/auth/session";
function reply(expiresInSeconds:number|null){
 if(expiresInSeconds===null)return Response.json({message:"Please sign in again."},{status:401});
 return Response.json({expiresInSeconds},{headers:{"Cache-Control":"private, no-store"}});
}
/** Reports time left without counting as activity, so open screens and timers cannot keep a session alive. */
export async function GET(){return reply(await getCurrentUser()?await sessionSecondsLeft():null);}
/** Called when the person using the app does something. */
export async function POST(){return reply(await getCurrentUser()?await renewSession():null);}
