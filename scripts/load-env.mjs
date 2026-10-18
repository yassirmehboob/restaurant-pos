import { existsSync } from "node:fs";
export function loadAppEnv(mode="production"){for(const file of [".env."+mode+".local",".env.local",".env."+mode,".env"]){if(existsSync(file))process.loadEnvFile(file)}}
