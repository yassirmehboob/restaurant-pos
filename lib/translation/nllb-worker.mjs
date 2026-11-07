// NLLB-200 translation process, started on demand by lib/translation/nllb.ts. It runs outside the Next.js server so
// the model (about 2 GB of memory while loaded) is freed as soon as the parent stops it. Fully offline: the model is
// read from TRANSLATION_MODEL_DIRECTORY and remote downloads are switched off.
import os from "node:os";
import { pipeline, env } from "@huggingface/transformers";
import { cleanTranslation } from "./clean.mjs";

// Low priority, so taking orders and printing on the same PC always come first while names are translated.
try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* Not allowed here: runs at normal priority. */ }

env.allowRemoteModels = false;
env.localModelPath = process.env.TRANSLATION_MODEL_DIRECTORY;
const MODEL = "Xenova/nllb-200-distilled-600M";
const TARGETS = { sd: "snd_Arab", ur: "urd_Arab" };
// Half the cores at most, so the POS server and MongoDB keep the rest. TRANSLATION_THREADS overrides it.
const THREADS = Math.max(1, Number(process.env.TRANSLATION_THREADS) || Math.min(4, Math.floor(os.cpus().length / 2)));

let translator;
process.on("message", async ({ id, texts, language }) => {
  try {
    translator ??= await pipeline("translation", MODEL, { dtype: "q8", session_options: { intraOpNumThreads: THREADS, interOpNumThreads: 1 } });
    const results = [];
    // One name at a time: batching pads the inputs, and NLLB then runs on past the translation.
    for (const text of texts) {
      const [output] = await translator(text, { src_lang: "eng_Latn", tgt_lang: TARGETS[language], max_new_tokens: 48 });
      results.push(cleanTranslation(output?.translation_text));
    }
    process.send({ id, ok: true, results });
  } catch (error) {
    process.send({ id, ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});
process.send?.({ ready: true });
