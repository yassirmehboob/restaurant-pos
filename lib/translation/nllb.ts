import "server-only";
import { fork,type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { LocalLanguage } from "@/lib/kitchen-language";

// Offline NLLB-200 (distilled 600M, 8-bit) for kitchen ticket names. The model lives outside the project, like uploads
// and backups: TRANSLATION_MODEL_DIRECTORY, or a "restaurant-pos-models" folder next to the project folder.
// `npm run translation:download` fetches it once (about 900 MB); after that no internet is needed.
export const MODEL_ID="Xenova/nllb-200-distilled-600M";
export const MODEL_FILES=["config.json","generation_config.json","tokenizer.json","tokenizer_config.json","special_tokens_map.json","onnx/encoder_model_quantized.onnx","onnx/decoder_model_merged_quantized.onnx"];
export const modelDirectory=()=>path.resolve(process.env.TRANSLATION_MODEL_DIRECTORY||path.join(process.cwd(),"..","restaurant-pos-models"));
export const modelReady=()=>MODEL_FILES.every(file=>existsSync(path.join(modelDirectory(),MODEL_ID,file)));

// The worker loads the model on its first request and is stopped after a quiet spell, which returns its memory.
const IDLE_MS=2*60*1000;
type Pending={resolve:(results:string[])=>void;reject:(error:Error)=>void};
let worker:ChildProcess|null=null,idle:ReturnType<typeof setTimeout>|null=null,nextId=0,queue:Promise<unknown>=Promise.resolve();
const pending=new Map<number,Pending>();

function stop(){if(idle)clearTimeout(idle);idle=null;worker?.kill();worker=null}
function start(){
  // Resolve at runtime: Turbopack otherwise treats fork's absolute Windows path
  // as a module request rooted at its virtual /ROOT directory.
  const child=fork(path.join(/* turbopackIgnore: true */ process.cwd(),"lib","translation","nllb-worker.mjs"),[],{env:{...process.env,TRANSLATION_MODEL_DIRECTORY:modelDirectory()},stdio:["ignore","ignore","pipe","ipc"]});
  child.on("message",(message:{id?:number;ok?:boolean;results?:string[];message?:string})=>{
    if(message.id===undefined)return;
    const job=pending.get(message.id);pending.delete(message.id);
    if(message.ok)job?.resolve(message.results??[]);else job?.reject(new Error(message.message||"Translation failed."));
  });
  child.on("exit",()=>{if(worker===child)worker=null;for(const job of pending.values())job.reject(new Error("The translator stopped. Try again."));pending.clear()});
  return child;
}

// Translates English names to Sindhi or Urdu, one request at a time. Empty strings mark names the model could not translate.
export function translateNames(texts:string[],language:LocalLanguage):Promise<string[]>{
  if(!modelReady())return Promise.reject(new Error(`The translation model is not installed. Run "npm run translation:download" once (about 900 MB), then try again. Model folder: ${modelDirectory()}`));
  const run=()=>new Promise<string[]>((resolve,reject)=>{
    if(idle)clearTimeout(idle);
    worker??=start();
    const id=++nextId;
    pending.set(id,{resolve:results=>{idle=setTimeout(stop,IDLE_MS);resolve(results)},reject:error=>{idle=setTimeout(stop,IDLE_MS);reject(error)}});
    worker.send({id,texts,language});
  });
  const result=queue.then(run,run);
  queue=result.catch(()=>undefined);
  return result;
}
