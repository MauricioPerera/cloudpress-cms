# API de CloudPress

Base: `https://<sitio>/api`. El contrato versionado y mecanizable se publica en [`openapi.json`](./openapi.json). Se genera desde `functions/api` y `npm run test:openapi` impide que documentación y rutas diverjan.

Las respuestas JSON incluyen `requestId`, que también se devuelve como encabezado `X-Request-ID`. Los errores conservan `{ "error": "…" }` por compatibilidad y añaden un código estable: `{ "error": "…", "code": "validation_failed", "requestId": "…" }`. Dos flujos heredados usan `requestId` como identificador operativo (aprobación y recuperación TOTP); en ellos el identificador correlacionable aparece como `correlationId` y siempre coincide con `X-Request-ID`. Los códigos posibles son `invalid_request`, `unauthenticated`, `forbidden`, `not_found`, `conflict`, `validation_failed`, `rate_limited`, `internal_error` y `request_failed`.

## Planos de acceso

| Plano | Familias | Autenticación |
|---|---|---|
| Público | `settings`, `navigation`, `content`, `search`, `comments` | Ninguna; sólo contenido publicado. |
| Cuenta | `register`, `login`, `logout`, `me`, `profile`, recuperación y TOTP | El flujo correspondiente; perfil requiere sesión. |
| Editorial | `editor/*`, `admin/content*`, revisiones, papelera, media, comentarios, taxonomías, menús, bloques y estadísticas | Sesión y permiso granular. |
| Administración | usuarios, roles, plugins, aprobaciones, importación/exportación, ajustes y capacidades de agente | Sesión y permiso granular. |
| Plugins | `plugins/{pluginId}/{path}` | Plugin habilitado y ruta declarada. Sólo `public: true` con `GET` puede ser anónima. |

Las mutaciones de navegador deben ser del mismo origen. Una capacidad LSFA es revocable y tiene alcance de ruta y método validado en servidor; no emite capacidades, cambia roles, toca ajustes, redefine tipos ni exporta datos.

## Contenido público

`GET /content?kind=post|page` conserva la consulta base. Para un tipo propio se usa `GET /content?contentType=<id>`. Un tipo core sólo se publica si su administrador marca `publicApi: true`; un tipo de plugin sólo si el manifiesto del plugin habilitado declara `publicApi: true`. No se devuelven borradores ni campos personalizados no públicos.

Las colecciones públicas usan `page` (desde 1), `pageSize` y `total`. `content` admite hasta 50 elementos, `comments` hasta 100 y `search` hasta 50 por página. Conservan sus arreglos `items` o `comments` para compatibilidad; los clientes nuevos deben usar los metadatos para recorrer una colección completa.

`openapi.json` 1.1.0 documenta los schemas de `PublicContent`, comentarios, búsqueda, login, mutaciones editoriales y respuestas de plugins. Una ruta dinámica de plugin sólo garantiza el envoltorio `{ ok, result }`; el contenido de `result` pertenece al contrato del plugin correspondiente.

En las operaciones administrativas, la extensión `x-cloudpress-agent-access` vale `scoped` cuando una capacidad LSFA puede usar exactamente ese método y ruta; `none` significa que exige sesión de navegador. Actualmente contenido moderno admite lectura, creación y edición acotadas; roles, ajustes y exportación están fuera del alcance del agente.

## Datos sensibles y flujos públicos

`GET /admin/export` omite correos de comentarios por defecto. Para incluirlos se requiere `includePersonalData=true`, `import-export:manage` y `sensitive:approve`; LSFA no puede exportar. Registro y restablecimiento exigen contraseñas de 12 caracteres; el registro exige correo válido. Comentarios usa honeypot y límite de cinco minutos por origen.

Las respuestas limitadas por tasa usan `code: "rate_limited"` y deben incluir `Retry-After` cuando el tiempo de espera es conocido. Los errores de handlers de plugin se auditan internamente, pero no devuelven su detalle de implementación al cliente; usa `requestId` al solicitar soporte.
