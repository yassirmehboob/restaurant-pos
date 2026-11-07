// Keeps the Arabic-script translation NLLB returns and drops anything it runs on with (other scripts, repeats).
// A result with no Arabic-script letters is not a translation, so it comes back empty for the owner to fill in.
export function cleanTranslation(text) {
  const kept = String(text ?? "").split(/[Ͱ-ϿЀ-ӿ]/)[0].replace(/\s+/g, " ").trim();
  return /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(kept) ? kept.slice(0, 300) : "";
}
