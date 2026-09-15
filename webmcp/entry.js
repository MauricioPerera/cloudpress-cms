import { registerTools } from "@nekuda/webmcp-sdk";
import { readAdminState, createDraft, updateContent, moveContentToTrash, restoreContent, setUserActive, manageNavigation, setPluginState } from "./tools.js";

const tools = [readAdminState, createDraft, updateContent, moveContentToTrash, restoreContent, setUserActive, manageNavigation, setPluginState];

const start = async () => {
  const response = await fetch("/api/me", { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.user?.role !== "admin") return;
  const registration = registerTools(tools);
  await registration.ready;
  addEventListener("pagehide", () => registration.unregister(), { once: true });
};

start().catch((error) => console.warn("CloudPress WebMCP no pudo registrarse", error));
