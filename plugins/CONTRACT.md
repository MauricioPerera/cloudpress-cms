# Contrato de plugins CloudPress v1

Un plugin vive en `plugins/<id>/`, declara `manifest.json` y exporta handlers desde `plugin.js`. Se compila con el proyecto: no se ejecuta código descargado desde la base de datos.

## Manifiesto obligatorio

- `contractVersion`: `cloudpress-plugin/v1`
- `id`: minúsculas, números y guiones; 3 a 48 caracteres.
- `name`, `version` SemVer y `description`.
- `hooks`: solo `content.beforeCreate` y `content.afterCreate`.
- `permissions`: solo `content:read` y `content:transform`.

`content.beforeCreate` exige `content:transform` y puede devolver `{ allow: true, patch: { excerpt: "..." } }` o bloquear con `{ allow: false }`. Solo se aceptan cambios a `title`, `slug`, `excerpt`, `body` y `status`.

## Verificación para autores y agentes

Ejecuta `node scripts/validate-plugin.mjs plugins/<id>`. El validador comprueba el manifiesto, handlers declarados y rechaza APIs prohibidas: `fetch`, imports dinámicos, acceso a `env`, D1, `eval` y `new Function`.

El servidor repite la validación del manifiesto antes de instalar, instala exclusivamente plugins incluidos en el registro compilado y deja auditoría de instalación, activación y desactivación.
