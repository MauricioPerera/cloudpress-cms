import { currentUser, json } from "./_shared.js";

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
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function trustedMutationRequest(request, url) {
  if (!unsafeMethods.has(request.method)) return true;

  // Webhooks are authenticated by their own bearer-like token in the route
  // handler. They are intentionally allowed to originate outside the site.
  if (request.headers.has("x-cloudpress-webhook-token") && url.pathname.startsWith("/api/plugins/")) return true;
  if (request.headers.has("x-cloudpress-approval-token") && url.pathname.startsWith("/api/admin/approvals/")) return true;
  if (request.headers.has("x-cloudpress-recovery-token") && url.pathname.startsWith("/api/totp-recovery/")) return true;
  // The LSFA companion is not a browser and therefore has no Fetch Metadata
  // headers. The route still authenticates the bearer and _shared.js enforces
  // its exact method/path scope before returning an Admin identity.
  if (/^Bearer [A-Za-z0-9+/=_-]{32,256}$/.test(request.headers.get("Authorization") || "") && url.pathname.startsWith("/api/admin/")) return true;

  const origin = request.headers.get("Origin");
  if (origin) return origin === url.origin;

  // Browser requests that omit Origin still carry this fetch metadata. Do not
  // accept an explicitly cross-site mutation just because it has a session
  // cookie attached.
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return fetchSite === "same-origin" || fetchSite === "same-site" || fetchSite === "none";
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const path = url.pathname === "/" ? "/" : url.pathname.replace(/\/$/, "");
  if (!trustedMutationRequest(request, url)) {
    return json({ error: "La solicitud debe originarse en CloudPress." }, 403, { "Cache-Control": "no-store" });
  }
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
      const pageEnhancements = '<script src="/admin-ui.js"></script><script src="/admin-ui-legacy.js"></script><script src="/webmcp/vendor/qrcode-1.5.4.js"></script><script src="/perfil-qr.js"></script><script src="/agent-access.js"></script><script type="module" src="/recovery-codes-pdf.js"></script><script type="module" src="/webmcp/loader.js"></script>';
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
