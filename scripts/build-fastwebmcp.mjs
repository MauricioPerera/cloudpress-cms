import { build } from "esbuild";

await build({
  entryPoints: ["webmcp/entry.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  outfile: "webmcp/vendor/fastwebmcp-0.5.0.js",
});
await build({
  entryPoints: ["webmcp/qr-entry.js"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  outfile: "webmcp/vendor/qrcode-1.5.4.js",
});

console.log(JSON.stringify({ ok: true, output: ["webmcp/vendor/fastwebmcp-0.5.0.js", "webmcp/vendor/qrcode-1.5.4.js"] }));
