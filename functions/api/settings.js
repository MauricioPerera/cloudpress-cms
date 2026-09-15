import { json } from "../_shared.js";

const defaults = { siteName: "CloudPress", tagline: "Un CMS ligero, en la red de Cloudflare.", heroTitle: "Un CMS ligero, en la red de Cloudflare.", heroText: "Publica entradas y páginas desde un panel inspirado en WordPress, con autenticación y base de datos propias.", accentColor: "#2271b1" };

export async function onRequestGet({ env }) {
  const result = await env.DB.prepare("SELECT setting_key, setting_value FROM site_settings").all();
  const settings = { ...defaults };
  for (const row of result.results) if (Object.hasOwn(settings, row.setting_key)) settings[row.setting_key] = row.setting_value;
  return json({ settings }, 200, { "Cache-Control": "public, max-age=300" });
}

export { defaults };
