import { spawn } from "node:child_process";
import { Worker } from "node:worker_threads";
import { loadAppEnv } from "./load-env.mjs";
const [command,...args]=process.argv.slice(2);if(!["dev","start"].includes(command))throw new Error("Use dev or start.");
process.env.NODE_ENV??=command==="dev"?"development":"production";loadAppEnv(process.env.NODE_ENV);
const app=spawn(process.execPath,["node_modules/next/dist/bin/next",command,...args],{stdio:"inherit",windowsHide:true,env:process.env});
const worker=new Worker(new URL("./kitchen-worker.mjs",import.meta.url),{env:process.env});let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;app.kill();void worker.terminate();process.exitCode=code}
app.on("error",()=>stop(1));app.on("exit",code=>{if(!stopping)stop(code??1)});
worker.on("error",()=>{console.error("Kitchen timing worker stopped unexpectedly.");stop(1)});worker.on("exit",code=>{if(!stopping)stop(code||1)});
process.on("SIGINT",()=>stop());process.on("SIGTERM",()=>stop());

process.on("message",message=>{if(message==="shutdown")stop()});
