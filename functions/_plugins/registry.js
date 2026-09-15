import { generatedPluginRegistry, generatedPluginReleaseRegistry } from "./generated-registry.js";

export const pluginRegistry = generatedPluginRegistry;
export const pluginReleaseRegistry = generatedPluginReleaseRegistry;

export function pluginRelease(id, sourceHash) {
  return typeof sourceHash === "string" ? pluginReleaseRegistry.get(id)?.get(sourceHash) || null : null;
}
