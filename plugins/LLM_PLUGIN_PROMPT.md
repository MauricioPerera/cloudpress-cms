# Prompt operativo para crear y probar un plugin CloudPress

Copia desde `INSTRUCCIONES PARA EL LLM` hasta el final como prompt de trabajo para un LLM que deba añadir un plugin a este repositorio.

## INSTRUCCIONES PARA EL LLM

Eres responsable de crear un plugin **compilado** para CloudPress. No inventes rutas, tablas, permisos ni mecanismos de carga. Primero inspecciona estos archivos, que son la fuente de verdad:

1. `functions/_plugins/contract.js`: contrato validado por el servidor.
2. `functions/_plugins/runtime.js`: hooks ejecutables y forma de retorno.
3. `functions/_plugins/contract.js`: contrato validado por el servidor.
4. `scripts/generate-plugin-registry.mjs`: descubrimiento compilado de plugins.
4. `plugins/seo-basico/manifest.json` y `plugins/seo-basico/plugin.js`: ejemplo mínimo.
5. `scripts/validate-plugin.mjs`: validador local de autor.

## Resultado obligatorio

Para un plugin con id `<plugin-id>`, entrega estos cambios:

```text
plugins/<plugin-id>/manifest.json
plugins/<plugin-id>/plugin.js
```

Después ejecuta `npm run plugins:build`. No edites `functions/_plugins/registry.js` ni `functions/_plugins/generated-registry.js` a mano.

No descargues, evalúes ni instales código desde D1, R2, una URL, un manifiesto recibido por HTTP ni una cadena. Un plugin sólo existe cuando su código está incluido en el despliegue y registrado en `pluginRegistry`.

## Contrato de `manifest.json`

Usa exactamente esta forma, omitiendo únicamente los bloques opcionales que no necesites:

```json
{
  "contractVersion": "cloudpress-plugin/v2",
  "id": "<plugin-id>",
  "name": "Nombre visible",
  "version": "1.0.0",
  "description": "Descripción de hasta 280 caracteres.",
  "hooks": ["content.beforeCreate"],
  "permissions": ["content:read", "content:transform"],
  "settingsSchema": {},
  "contentTypes": [],
  "contentMeta": [],
  "userMeta": [],
  "actions": [],
  "routes": [],
  "tasks": [],
  "menus": [],
  "taxonomies": [],
  "migrations": [],
  "capabilities": [],
  "uninstallPolicy": "preserve-content-purge-plugin-storage"
}
```

Reglas no negociables:

- `id`: `^[a-z0-9][a-z0-9-]{2,47}$`; minúsculas, números y guiones; 3–48 caracteres.
- `version`: SemVer, por ejemplo `1.0.0`.
- `hooks`: lista única no vacía. Sólo `content.beforeCreate` y `content.afterCreate`.
- `permissions`: lista única no vacía. El contrato v2 también admite `taxonomies:define`, `admin-ui:register`, `storage:read`, `storage:write`, `routes:register`, `jobs:enqueue`, `privacy:manage`, `diagnostics:read` y `capabilities:define`.
- Si declaras `content.beforeCreate`, declara también `content:transform`.
- `settingsSchema`, si existe, debe ser un objeto serializado de máximo 4 KB.
- `contentTypes` requiere `content-types:define`. Cada tipo tiene `id`, `label` (máximo 80) y `supports` con una combinación de `title`, `body`, `excerpt`.
- `contentMeta` requiere `content-meta:define`; `userMeta` requiere `user-meta:define`. Cada definición tiene `key` con formato `<plugin-id>.<campo>`, `type` (`string`, `number`, `boolean` o `json`) y `required` booleano.
- `actions` requiere `actions:register`. Cada acción tiene `id`, `label`, `scope`, `handler`, `capability` e `inputSchema`; el handler vive en `export default { actions: { ... } }`.
- `routes`, `tasks`, `menus`, `taxonomies`, `migrations` y `capabilities` requieren sus permisos homónimos. Las rutas, acciones y menús se autorizan por rol base o capacidad declarada; las tareas se ejecutan mediante la cola namespaced del host.

Pide sólo los permisos mínimos. No declares metadatos, tipos o acciones que el plugin no vaya a usar.

## Contrato de `plugin.js`

`plugin.js` debe exportar por defecto un objeto cuyos nombres de propiedades sean hooks declarados en el manifiesto:

```js
export default {
  async "content.beforeCreate"(content) {
    // content es de sólo lectura: no lo mutas.
    if (content.excerpt?.trim()) return { allow: true };
    const plain = String(content.body || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { allow: true, patch: { excerpt: plain.slice(0, 155) } };
  },
  async "content.afterCreate"(content) {
    // No retorna cambios persistentes para este hook.
  }
};
```

En `content.beforeCreate`:

- Para permitir sin cambios: `{ allow: true }`.
- Para bloquear: `{ allow: false }`.
- Para transformar: `{ allow: true, patch: { ... } }`.
- `patch` sólo puede contener valores string en `title`, `slug`, `excerpt`, `body` y `status`.

## Restricciones de seguridad

No uses ni introduzcas: `fetch`, imports dinámicos, `eval`, `new Function`, `process`, `env`, acceso directo a D1/R2, `__proto__`, secretos, variables de entorno o APIs de red. Los handlers reciben `context.data`, `context.enqueue`, `context.audit` y `context.actor`; el runtime es el único que accede a infraestructura.

No modifiques rutas de autenticación, middleware, esquema de sesiones ni funciones de borrado para resolver una necesidad del plugin. Si una necesidad no cabe en el contrato actual, detente y explica qué extensión del contrato haría falta antes de escribir código.

## Registro compilado

Ejecuta `npm run plugins:build`. El generador descubre cada directorio válido de `plugins/` y produce imports estáticos aptos para Pages Functions. No sustituyas ni borres plugins existentes.

## Plan de prueba obligatorio

Ejecuta y reporta estos pasos, sin afirmar éxito si falta uno:

1. Validación y prueba local:

   ```powershell
   npm run plugins:build
   node scripts/validate-plugin.mjs plugins/<plugin-id>
   npm test
   ```

2. Validación del contrato de servidor, con el manifiesto real:

   ```powershell
   $manifest = Get-Content -Raw plugins/<plugin-id>/manifest.json
   Invoke-RestMethod -Method Post -ContentType 'application/json' -Body $manifest -Uri 'https://<sitio>/api/admin/plugins/validate'
   ```

   La respuesta debe ser `valid: true`.

3. Despliega sólo después de que ambas validaciones pasen:

   ```powershell
   wrangler pages deploy . --project-name <proyecto> --branch main
   ```

4. Inicia sesión como administrador, abre `wp-admin → Plugins`, confirma que `<plugin-id>` aparece como disponible y selecciona **Instalar**.

5. Verifica persistencia: recarga Plugins y confirma estado `enabled`.

6. Prueba el hook con datos aislados o un borrador de QA: crea una entrada que active el hook y verifica el cambio o bloqueo esperado desde el listado/editor. No pruebes sobre contenido productivo crítico.

7. Prueba reversión: desactiva el plugin desde Plugins, crea o revisa otra entrada equivalente y confirma que el comportamiento ya no se aplica. Vuelve a activarlo sólo si esa es la configuración deseada.

8. Reporta: archivos modificados, permisos solicitados, hooks, resultado de cada prueba, y cualquier limitación conocida.

## Criterios de aceptación

Tu trabajo está terminado únicamente si:

- El manifiesto y el registro comparten exactamente el mismo contrato.
- El validador local y `/api/admin/plugins/validate` aceptan el manifiesto.
- El plugin aparece, se instala y conserva su estado tras recargar.
- El hook declarado se ejecuta con el resultado esperado.
- Desactivar el plugin elimina su efecto sin eliminar datos.
- No se añadieron APIs prohibidas ni cambios fuera del alcance del plugin.

Si uno de esos criterios no se puede verificar, di exactamente cuál falta y no declares el plugin terminado.
