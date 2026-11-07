// Downloads the offline NLLB-200 translation model (about 900 MB) once, for Sindhi and Urdu kitchen tickets.
// Usage: npm run translation:download. Interrupted downloads resume. Afterwards translation needs no internet.
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { loadAppEnv } from "./load-env.mjs";

loadAppEnv(process.env.NODE_ENV ?? "development");
const MODEL_ID = "Xenova/nllb-200-distilled-600M";
const FILES = ["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "onnx/encoder_model_quantized.onnx", "onnx/decoder_model_merged_quantized.onnx"];
const root = path.resolve(process.env.TRANSLATION_MODEL_DIRECTORY || path.join(process.cwd(), "..", "restaurant-pos-models"));
const folder = path.join(root, MODEL_ID);
console.log(`Translation model folder: ${folder}`);

for (const file of FILES) {
  const target = path.join(folder, file), partial = `${target}.part`;
  if (existsSync(target)) { console.log(`  ${file} already present`); continue; }
  mkdirSync(path.dirname(target), { recursive: true });
  const done = existsSync(partial) ? statSync(partial).size : 0;
  const response = await fetch(`https://huggingface.co/${MODEL_ID}/resolve/main/${file}`, { headers: done ? { Range: `bytes=${done}-` } : {} });
  if (!response.ok || !response.body) throw new Error(`Could not download ${file}: HTTP ${response.status}`);
  const resumed = response.status === 206, total = Number(response.headers.get("content-length") ?? 0) + (resumed ? done : 0);
  console.log(`  ${file}: ${(total / 1e6).toFixed(0)} MB${resumed ? ` (resuming at ${(done / 1e6).toFixed(0)} MB)` : ""}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: resumed ? "a" : "w" }));
  renameSync(partial, target);
}
console.log("Done. Kitchen translations can now be suggested offline.");
