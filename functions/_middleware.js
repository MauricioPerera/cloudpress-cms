import { currentUser } from "./_shared.js";

const adminPaths = new Set([
  "/wp-admin", "/wp-admin.html", "/admin", "/admin.html", "/comentarios", "/comentarios.html",
  "/papelera", "/papelera.html", "/ajustes", "/ajustes.html", "/apariencia", "/apariencia.html",
  "/taxonomias", "/taxonomias.html", "/menus", "/menus.html", "/organizacion", "/organizacion.html",
  "/herramientas", "/herramientas.html", "/importar", "/importar.html", "/exportar", "/exportar.html",
  "/programar", "/programar.html", "/revisiones", "/revisiones.html"
  , "/plugins", "/plugins.html", "/plugin-admin", "/plugin-admin.html"
]);
const memberPaths = new Set(["/perfil", "/perfil.html"]);
const authorPaths = new Set(["/editor", "/editor.html"]);

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const path = url.pathname === "/" ? "/" : url.pathname.replace(/\/$/, "");
  if (!adminPaths.has(path) && !memberPaths.has(path) && !authorPaths.has(path)) return next();
  const user = await currentUser(request, env);
  const allowed = adminPaths.has(path) ? user?.role === "admin"
    : authorPaths.has(path) ? ["admin", "author"].includes(user?.role)
      : Boolean(user);
  if (allowed) {
    const response = await next();
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      const pageEnhancements = '<script src="/admin-ui.js"></script><script src="/admin-ui-legacy.js"></script><script type="importmap">{"imports":{"@nekuda/webmcp-sdk":"/webmcp/vendor/nekuda-webmcp-sdk-0.5.0.js"}}</script><script type="module" src="/webmcp/entry.js"></script>';
      return new Response(pageEnhancements + await response.text(), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
    return response;
  }
  const login = new URL("/login.html", url.origin);
  login.searchParams.set("redirect", `${url.pathname}${url.search}`);
  return Response.redirect(login, 302);
}
