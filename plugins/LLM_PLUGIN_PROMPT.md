# Prompt operativo para crear y probar un plugin CloudPress

Copia desde `INSTRUCCIONES PARA EL LLM` hasta el final como prompt de trabajo para un LLM que deba añadir un plugin a este repositorio.

## INSTRUCCIONES PARA EL LLM

Eres responsable de crear un plugin **compilado** para CloudPress. No inventes rutas, tablas, permisos ni mecanismos de carga. Primero inspecciona estos archivos, que son la fuente de verdad:

1. `functions/_plugins/contract.js`: contrato validado por el servidor.
2. `functions/_plugins/runtime.js`: hooks ejecutables y forma de retorno.
3. `scripts/generate-plugin-registry.mjs`: descubrimiento compilado de plugins.
4. `plugins/seo-basico/manifest.json` y `plugins/seo-basico/plugin.js`: ejemplo mínimo.
5. `plugins/sdk/validator.js` y `scripts/validate-plugin.mjs`: validador local determinista de autor.

## Resultado obligatorio

Para un plugin con id `<plugin-id>`, entrega estos cambios:

```text
plugins/<plugin-id>/manifest.json
plugins/<plugin-id>/plugin.js
```

Si el plugin ya estuvo desplegado y vas a cambiarlo, conserva primero su versión publicada sin alterarla en:

```text
plugins/<plugin-id>/releases/<version>/manifest.json
plugins/<plugin-id>/releases/<version>/plugin.js
```

El `<version>` del directorio debe coincidir exactamente con `manifest.json`. El generador valida e importa estáticamente cada release; no reconstruyas ni inventes una versión histórica. Si no existe una copia exacta de la versión anterior, no puedes prometer rollback a esa versión.

Después ejecuta `node scripts/validate-plugin.mjs plugins/<plugin-id>` y `npm run plugins:build`. No edites `functions/_plugins/registry.js` ni `functions/_plugins/generated-registry.js` a mano.

No descargues, evalúes ni instales código desde D1, R2, una URL, un manifiesto recibido por HTTP ni una cadena. Un plugin sólo existe cuando su código está incluido en el despliegue y registrado en `pluginRegistry`. Los releases archivados se seleccionan exclusivamente por su `sourceHash` atestado y sólo si ese hash está dentro del bundle que ya fue desplegado.

## Flujo obligatorio para un agente creador

Antes de desplegar, el mismo agente que crea el plugin debe completar tres comprobaciones separadas:

1. **Revisión de intención:** compara código, manifiesto, permisos y handlers con el objetivo solicitado. No declares que hace algo que el código no implementa.
2. **Política determinista:** ejecuta `node scripts/validate-plugin.mjs plugins/<plugin-id>`. Debe devolver `valid: true`, `policy: static-ast-no-execution` y hashes SHA-256 de fuente y manifiesto. El validador analiza el AST; nunca importa ni ejecuta `plugin.js`.
3. **Pruebas de aceptación:** usa datos aislados para recorrer cada hook, acción, ruta, tarea o webhook declarado y demuestra el resultado esperado. El validador no sustituye estas pruebas ni la revisión del agente.

Después, `npm run plugins:build` incorpora la misma atestación al registro compilado y falla si un plugin local no la puede generar. Sólo tras desplegar ese build, un agente autenticado puede usar `cloudpress_install_plugin` para instalar y activar el id ya atestado. CloudPress registra la versión y hashes instalados, y rechaza tipos o metadatos que colisionen con otro plugin. La herramienta no carga ni ejecuta código recibido en tiempo de ejecución.

Para seleccionar un release o revertir, consulta primero el estado administrativo: `availableReleases` contiene los hashes válidos que el bundle actual puede ejecutar y `activeReleases` indica el hash seleccionado. Después usa `cloudpress_install_plugin({ id: "<plugin-id>", sourceHash: "sha256:..." })`. Sin `sourceHash`, se selecciona la versión actual de `plugins/<plugin-id>/`. Si el hash no está incluido en el despliegue, CloudPress falla de forma segura; nunca sustituye código nuevo por código solicitado.

## Contrato de `manifest.json`

Usa exactamente esta forma, omitiendo únicamente los bloques opcionales que no necesites:

```json
{
  "contractVersion": "cloudpress-plugin/v3",
  "id": "<plugin-id>",
  "priority": 0,
  "name": "Nombre visible",
  "version": "1.0.0",
  "description": "Descripción de hasta 280 caracteres.",
  "hooks": ["content.beforeCreate"],
  "permissions": ["content:read", "content:transform"],
  "settingsSchema": {},
  "i18n": { "defaultLocale": "es", "messages": { "en": { "name": "Visible name" } } },
  "contentTypes": [],
  "contentMeta": [],
  "userMeta": [],
  "actions": [],
  "blocks": [],
  "routes": [],
  "tasks": [],
  "menus": [],
  "taxonomies": [],
  "migrations": [],
  "capabilities": [],
  "webhooks": [],
  "uninstallPolicy": "preserve-content-purge-plugin-storage"
}
```

Reglas no negociables:

- `id`: `^[a-z0-9][a-z0-9-]{2,47}$`; minúsculas, números y guiones; 3–48 caracteres.
- `version`: SemVer, por ejemplo `1.0.0`. `priority` es opcional, entero entre -100 y 100; menor valor se ejecuta antes. No lo uses para sobrescribir silenciosamente otro plugin: CloudPress rechaza parches incompatibles.
- `hooks`: lista única no vacía. El core expone `content.beforeCreate`, `content.afterCreate`, `content.beforeUpdate`, `content.afterUpdate`, `content.beforeTrash`, `content.afterTrash`, `content.beforeRestore` y `content.afterRestore`. No inventes nombres: un hook sólo existe si el core lo invoca.
- `permissions`: lista única no vacía. El contrato v2 también admite `taxonomies:define`, `admin-ui:register`, `storage:read`, `storage:write`, `routes:register`, `jobs:enqueue`, `privacy:manage`, `diagnostics:read`, `capabilities:define` y `webhooks:register`.
- `i18n` es opcional: `defaultLocale` y cada locale usan `es` o `en-US`; `messages` traduce `name`, `description`, y etiquetas con claves como `contentTypes.product`, `actions.sync`, `menus.mi-menu`, `taxonomies.tema`, `capabilities.manage-x` o `webhooks.incoming`. El host sirve estas etiquetas con `?locale=en`.
- Si declaras `content.beforeCreate` o `content.beforeUpdate`, declara también `content:transform`. Ambos pueden devolver `{ allow: true, patch: { ... } }` usando sólo `title`, `slug`, `excerpt`, `body` y `status`. Los demás hooks `before*` pueden devolver `{ allow: false }` para bloquear; los hooks `after*` son de observación y no revierten una operación ya persistida.
- `settingsSchema`, si existe, debe ser un objeto serializado de máximo 4 KB.
- `contentTypes` requiere `content-types:define`. En v3 cada `id` es global y debe usar `<plugin-id>--<tipo>`, por ejemplo `reservas--cita`; incluye `label` (máximo 80) y `supports` con una combinación de `title`, `body`, `excerpt`.
- `contentMeta` requiere `content-meta:define`; `userMeta` requiere `user-meta:define`. En v3 cada `key` debe empezar exactamente por `<plugin-id>.`, usa `type` (`string`, `number`, `boolean` o `json`) y `required` booleano.
- `actions` requiere `actions:register`. Cada acción tiene `id`, `label`, `scope`, `handler`, `capability` e `inputSchema`; en v3 el schema es un objeto estricto, con propiedades primitivas declaradas, `required` y `additionalProperties: false` cuando no se admitan campos extra. El handler vive en `export default { actions: { ... } }`.
- `blocks` requiere `blocks:define` y contrato v2/v3. Cada bloque usa un id global `<plugin-id>--<bloque>`, `label`, `icon` opcional, `handler` e `attributes`. `attributes` es un schema estricto de propiedades primitivas, igual que `inputSchema`. El editor de CloudPress genera el inspector desde ese schema: no incluyas JavaScript de navegador ni UI remota. El handler vive en `export default { blocks: { ... } }`, recibe únicamente los atributos congelados y devuelve `{ html: "..." }` o un string HTML; el host lo sanea antes de guardarlo. Debe ser puro y determinista: no usa contexto, red, secretos ni almacenamiento.
- `routes`, `tasks`, `menus`, `taxonomies`, `migrations`, `capabilities` y `webhooks` requieren sus permisos homónimos. Las rutas, acciones y menús se autorizan por rol base o capacidad declarada; las tareas se ejecutan mediante la cola namespaced del host. Cada webhook declara `id`, `label`, `path` y `handler`; su handler vive en `export default { webhooks: { ... } }` y recibe un token rotado por el administrador, nunca un secreto escrito en el manifiesto.

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

Un renderizador de bloque de plugin tiene esta forma:

```js
export default {
  blocks: {
    async "product-grid"(attributes) {
      return { html: `<p>Productos destacados: ${attributes.limit}</p>` };
    }
  }
};
```

No transformes `body` en un hook `before*` cuando el contenido usa bloques: CloudPress rechaza esa mezcla para conservar `blocks_json` como fuente de verdad.

## Restricciones de seguridad

No uses ni introduzcas: `fetch`, imports dinámicos, `eval`, `new Function`, `process`, `env`, acceso directo a D1/R2, `__proto__`, secretos, variables de entorno o APIs de red. Los handlers reciben `context.data`, `context.enqueue`, `context.audit` y `context.actor`; el runtime es el único que accede a infraestructura.

No modifiques rutas de autenticación, middleware, esquema de sesiones ni funciones de borrado para resolver una necesidad del plugin. Si una necesidad no cabe en el contrato actual, detente y explica qué extensión del contrato haría falta antes de escribir código.

## Registro compilado

Ejecuta `npm run plugins:build`. El generador descubre cada directorio válido de `plugins/` y produce imports estáticos aptos para Pages Functions. No sustituyas ni borres plugins existentes.

## Plan de prueba obligatorio

Ejecuta y reporta estos pasos, sin afirmar éxito si falta uno:

1. Revisión, validación y prueba local:

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

4. Inicia sesión como administrador, abre `wp-admin → Plugins`, confirma que `<plugin-id>` aparece como disponible y selecciona **Instalar**; o, desde un navegador con WebMCP, usa `cloudpress_install_plugin` con el mismo id. Comprueba que la respuesta conserva la atestación de validación.

5. Verifica persistencia: recarga Plugins y confirma estado `enabled`.

6. Prueba el hook con datos aislados o un borrador de QA: crea una entrada que active el hook y verifica el cambio o bloqueo esperado desde el listado/editor. No pruebes sobre contenido productivo crítico.

7. Prueba reversión de comportamiento: desactiva el plugin desde Plugins, crea o revisa otra entrada equivalente y confirma que el comportamiento ya no se aplica. Vuelve a activarlo sólo si esa es la configuración deseada.

8. Si el plugin tiene un release archivado, prueba rollback real en un entorno de QA: guarda el `sourceHash` activo, selecciona el hash archivado desde `availableReleases`, verifica el comportamiento del release anterior y vuelve a seleccionar el hash original. No intentes una reversión cuyo hash no aparezca en ese despliegue.

9. Reporta: archivos modificados, permisos solicitados, hooks, hash/versiones seleccionadas, resultado de cada prueba, y cualquier limitación conocida.

## Criterios de aceptación

Tu trabajo está terminado únicamente si:

- El manifiesto y el registro comparten exactamente el mismo contrato.
- El validador local devuelve `valid: true` sin ejecutar `plugin.js`, y la atestación aparece en el registro compilado.
- El plugin aparece, se instala y conserva su estado tras recargar.
- El hook declarado se ejecuta con el resultado esperado.
- Desactivar el plugin elimina su efecto sin eliminar datos.
- No se añadieron APIs prohibidas ni cambios fuera del alcance del plugin.

Si uno de esos criterios no se puede verificar, di exactamente cuál falta y no declares el plugin terminado.
