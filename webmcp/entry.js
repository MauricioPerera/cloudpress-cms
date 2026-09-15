import { registerCloudPressAdminTools } from "./fastwebmcp-entry.js";

const start = async () => {
  const response = await fetch("/api/me", { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.user?.role !== "admin") return;
  const controller = registerCloudPressAdminTools();
  addEventListener("pagehide", () => controller.abort(), { once: true });
};

start().catch((error) => console.warn("CloudPress WebMCP no pudo registrarse", error));
