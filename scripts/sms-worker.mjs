import mongoose from "mongoose";
import { setTimeout as pause } from "node:timers/promises";
import { loadAppEnv } from "./load-env.mjs";
import { runSmsDeliveryTick } from "../lib/sms-delivery.mjs";
import { ensureSmsMessageIndexes } from "../lib/sms-indexes.mjs";
loadAppEnv(process.env.NODE_ENV??"production");
let stopped=false;process.on("SIGINT",()=>{stopped=true});process.on("SIGTERM",()=>{stopped=true});
if(!process.env.MONGODB_URI){console.error("SMS worker: database configuration is required.");process.exitCode=1}else{
 console.log("SMS worker started (5-second queue checks).");
 while(!stopped){
  try{if(process.env.SMS_API){if(mongoose.connection.readyState!==1){await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:5000});await ensureSmsMessageIndexes(mongoose.connection.db)}await runSmsDeliveryTick(mongoose.connection.db)}}catch{console.error("SMS queue check failed; retrying without exposing credentials.")}
  if(!stopped)await pause(5000);
 }
 await mongoose.disconnect();
}
