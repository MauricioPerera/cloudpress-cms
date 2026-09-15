import { validatePluginPackage } from "../plugins/sdk/validator.js";

const folder = process.argv[2];
if (!folder) throw new Error("Uso: node scripts/validate-plugin.mjs plugins/<id>");

const result = await validatePluginPackage(folder);
if (!result.valid) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
