const localePattern = /^[a-z]{2}(?:-[A-Z]{2})?$/;

export function requestedLocale(value, fallback = "es") {
  const locale = String(value || "").trim();
  return localePattern.test(locale) ? locale : fallback;
}

export function translatePlugin(manifest, locale, key, fallback) {
  const defaultLocale = manifest?.i18n?.defaultLocale || "es";
  const messages = manifest?.i18n?.messages || {};
  return messages[locale]?.[key] || messages[defaultLocale]?.[key] || fallback;
}

export function localizedManifest(manifest, locale) {
  const translate = (key, fallback) => translatePlugin(manifest, locale, key, fallback);
  const mapLabel = (section, items = []) => items.map((item) => ({ ...item, label: translate(`${section}.${item.id}`, item.label) }));
  return {
    ...manifest,
    name: translate("name", manifest.name),
    description: translate("description", manifest.description),
    contentTypes: mapLabel("contentTypes", manifest.contentTypes),
    actions: mapLabel("actions", manifest.actions),
    taxonomies: mapLabel("taxonomies", manifest.taxonomies),
    menus: mapLabel("menus", manifest.menus),
    capabilities: mapLabel("capabilities", manifest.capabilities),
    webhooks: mapLabel("webhooks", manifest.webhooks)
  };
}
