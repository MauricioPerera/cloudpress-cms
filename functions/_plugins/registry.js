import seoBasico from "../../plugins/seo-basico/plugin.js";

const seoBasicoManifest = {
  contractVersion: "cloudpress-plugin/v1", id: "seo-basico", name: "SEO básico", version: "1.0.0",
  description: "Crea un extracto editorial cuando una entrada no tiene uno.", hooks: ["content.beforeCreate"],
  permissions: ["content:read", "content:transform", "content-types:define", "content-meta:define", "user-meta:define", "actions:register"], settingsSchema: {},
  contentTypes: [{ id: "landing-seo", label: "Landing SEO", supports: ["title", "body", "excerpt"] }],
  contentMeta: [{ key: "seo-basico.meta-title", type: "string", required: false }],
  userMeta: [{ key: "seo-basico.author-bio", type: "string", required: false }],
  actions: [{ id: "preview-seo", label: "Previsualizar SEO", scope: "content" }]
};

export const pluginRegistry = new Map([["seo-basico", { manifest: seoBasicoManifest, hooks: seoBasico }]]);
