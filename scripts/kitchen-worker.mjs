import mongoose from "mongoose";
import { setTimeout as pause } from "node:timers/promises";
import { loadAppEnv } from "./load-env.mjs";
import { runKitchenTimingTick } from "../lib/kitchen-timing.mjs";
loadAppEnv(process.env.NODE_ENV??"production");
let stopped=false;const shutdown=()=>{stopped=true};process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);
if(!process.env.MONGODB_URI){console.error("Kitchen worker: MONGODB_URI is required.");process.exitCode=1}else{
 console.log("Kitchen timing worker started (15-second checks).");
 while(!stopped){try{if(mongoose.connection.readyState!==1)await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:5000});await runKitchenTimingTick(mongoose.connection.db)}catch{console.error("Kitchen timing check failed; retrying without exposing database credentials.")}
  if(!stopped)await pause(15000);
 }
 await mongoose.disconnect();
}
