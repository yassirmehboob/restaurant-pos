import { registerHooks, createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Next supplies these aliases in the app; supply them for Node's test runner.
const require = createRequire(import.meta.url);
const mongooseURL = pathToFileURL(require.resolve("mongoose")).href;
const mongooseBridge = `import m from ${JSON.stringify(mongooseURL)}; export default m; export const {Schema,model,models,deleteModel}=m;`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
    if (specifier === "mongoose") return { url: `data:text/javascript,${encodeURIComponent(mongooseBridge)}`, shortCircuit: true };
    if (specifier.startsWith("@/")) return next(pathToFileURL(`${process.cwd()}/${specifier.slice(2)}${/\.(?:[cm]?js|tsx?)$/.test(specifier)?"":".ts"}`).href, context);
    return next(specifier, context);
  },
});
