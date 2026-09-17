import { json, requireAdmin } from "../../_shared.js";
import { defaults } from "../settings.js";

const color = /^#[0-9a-fA-F]{6}$/;
const themes = new Set(["classic", "minimal", "contrast"]);
const clean = (value, size) => String(value || "").trim().slice(0, size);

export async function onRequestGet({ request, env }) {
  if (!await requireAdmin(request, env, "settings:manage")) return json({ error: "Se requiere permiso de ajustes" }, 403);
  const result = await env.DB.prepare("SELECT setting_key, setting_value FROM site_settings").all();
  const settings = { ...defaults };
  for (const row of result.results) if (Object.hasOwn(settings, row.setting_key)) settings[row.setting_key] = row.setting_value;
  return json({ settings }, 200, { "Cache-Control": "no-store" });
}

export async function onRequestPut({ request, env }) {
  if (!await requireAdmin(request, env, "settings:manage")) return json({ error: "Se requiere permiso de ajustes" }, 403);
  const input = await request.json().catch(() => null);
  const previous = { ...defaults };
  const stored = await env.DB.prepare("SELECT setting_key, setting_value FROM site_settings").all();
  for (const row of stored.results) if (Object.hasOwn(previous, row.setting_key)) previous[row.setting_key] = row.setting_value;
  const settings = { siteName: clean(input?.siteName ?? input?.site_name ?? previous.siteName, 80), tagline: clean(input?.tagline ?? previous.tagline, 160), heroTitle: clean(input?.heroTitle ?? input?.home_title ?? previous.heroTitle, 160), heroText: clean(input?.heroText ?? input?.home_message ?? previous.heroText, 500), accentColor: clean(input?.accentColor ?? input?.accent_color ?? previous.accentColor, 7), themePreset: String(input?.themePreset ?? input?.theme_preset ?? previous.themePreset) };
  if (!settings.siteName || !settings.heroTitle || !settings.heroText || !color.test(settings.accentColor) || !themes.has(settings.themePreset)) return json({ error: "Los ajustes son inválidos" }, 400);
  const now = new Date().toISOString();
  await env.DB.batch(Object.entries(settings).map(([key, value]) => env.DB.prepare("INSERT INTO site_settings(setting_key,setting_value,updated_at) VALUES(?,?,?) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value, updated_at=excluded.updated_at").bind(key, value, now)));
  return json({ ok: true, settings });
}

export { onRequestPut as onRequestPatch };
