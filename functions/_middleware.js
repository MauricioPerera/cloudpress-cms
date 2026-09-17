import { currentUser, json } from "./_shared.js";
import { hasCorePermission } from "./_roles.js";

const adminPaths = new Set([
  "/wp-admin", "/wp-admin.html", "/admin", "/admin.html", "/comentarios", "/comentarios.html",
  "/papelera", "/papelera.html", "/ajustes", "/ajustes.html", "/apariencia", "/apariencia.html",
  "/taxonomias", "/taxonomias.html", "/menus", "/menus.html", "/organizacion", "/organizacion.html",
  "/herramientas", "/herramientas.html", "/importar", "/importar.html", "/exportar", "/exportar.html",
  "/programar", "/programar.html", "/revisiones", "/revisiones.html"
  , "/plugins", "/plugins.html", "/plugin-admin", "/plugin-admin.html", "/roles", "/roles.html", "/content-types", "/content-types.html", "/content-fields", "/content-fields.html", "/core-content", "/core-content.html", "/advanced-fields", "/advanced-fields.html", "/agent-operations", "/agent-operations.html"
]);
const memberPaths = new Set(["/perfil", "/perfil.html"]);
const authorPaths = new Set(["/editor", "/editor.html"]);
const rolePaths = new Set(["/roles", "/roles.html", "/plugin-capabilities", "/plugin-capabilities.html"]);
const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function secureResponse(response) {
  const headers = new Headers(response.headers);
  if (!headers.has("x-request-id")) headers.set("X-Request-ID", crypto.randomUUID());
  // The admin shell embeds same-origin management pages in its iframe. Allow
  // only that trusted parent while continuing to block third-party framing.
  headers.set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:9463");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

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
    return secureResponse(json({ error: "La solicitud debe originarse en CloudPress." }, 403, { "Cache-Control": "no-store" }));
  }
  if (!adminPaths.has(path) && !memberPaths.has(path) && !authorPaths.has(path) && !rolePaths.has(path)) {
    const response = await next();
    if (path === "/" && (response.headers.get("content-type") || "").includes("text/html")) return secureResponse(new Response('<script src="/theme-runtime.js"></script>' + await response.text(), { status: response.status, headers: response.headers }));
    return secureResponse(response);
  }
  const user = await currentUser(request, env);
  const allowed = rolePaths.has(path) ? await hasCorePermission(env, user, "roles:manage")
    : adminPaths.has(path) ? await hasCorePermission(env, user, "dashboard:access")
    : authorPaths.has(path) ? await hasCorePermission(env, user, "content:own")
      : Boolean(user);
  if (allowed) {
    const response = await next();
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      const pageEnhancements = '<script src="/admin-ui.js"></script><script src="/admin-ui-legacy.js"></script><script src="/advanced-fields-ui.js"></script><script src="/advanced-fields-core-content.js"></script><script src="/webmcp/vendor/qrcode-1.5.4.js"></script><script src="/perfil-qr.js"></script><script src="/agent-access.js"></script><script src="/roles-nav.js"></script><script type="module" src="/recovery-codes-pdf.js"></script><script type="module" src="/webmcp/loader.js"></script>';
      return secureResponse(new Response(pageEnhancements + await response.text(), {
        status: response.status,
        statusText: response.statusText,
        headers,
      }));
    }
    return secureResponse(response);
  }
  const login = new URL("/login.html", url.origin);
  login.searchParams.set("redirect", `${url.pathname}${url.search}`);
  return secureResponse(Response.redirect(login, 302));
}
