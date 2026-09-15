# Verificación reproducible del Plugin Host SDK

Ejecuta los controles locales antes de desplegar:

```powershell
npm test
```

El resultado debe incluir `plugins:build`, `plugins:validate` y `test:plugin-host` con `ok: true`. El último comprueba descubrimiento sin edición manual del registro, producto, cliente, duplicados, inventario, trabajo idempotente, carrito, pedido, webhook, tarea, inventario insuficiente y auditoría.

Para una instancia de Cloudflare Pages, aplica las migraciones pendientes en orden y despliega:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '<account-id>'
wrangler d1 execute <database> --remote --file migrations/0012_plugin_host.sql
wrangler d1 execute <database> --remote --file migrations/0013_plugin_audit_actor_cleanup.sql
wrangler d1 execute <database> --remote --file migrations/0014_plugin_capabilities.sql
wrangler d1 execute <database> --remote --file migrations/0015_plugin_webhooks.sql
wrangler pages deploy . --project-name <pages-project> --branch main
```

Con una cuenta temporal administradora, instala `cloudpress-commerce` desde **Plugins**. Debe aparecer el menú **Comercio** en `wp-admin`. Sus tipos declarados (**Productos** y **Pedidos**) abren `admin.html?contentType=<tipo>`: el listado, editor, metadatos, taxonomías, revisiones y papelera se sirven desde la UI base, no desde un panel paralelo. Las acciones, webhooks, diagnóstico y privacidad permanecen como secciones administrativas del plugin.

La prueba de producción no deja datos persistentes: crea un producto y un término QA, los purga, desactiva y reactiva Commerce. Requiere una cuenta administradora temporal:

```powershell
$env:CLOUDPRESS_URL = 'https://<pages-project>.pages.dev'
$env:CLOUDPRESS_VERIFY_USERNAME = '<admin-temporal>'
$env:CLOUDPRESS_VERIFY_PASSWORD = '<clave-temporal>'
node scripts/verify-production-plugin-content.mjs
```

Las verificaciones HTTP mínimas son:

1. `POST /api/admin/plugins` con `{ "id": "cloudpress-commerce" }` devuelve `enabled` y `commerce-storage-v1`.
2. `GET /api/admin/plugin-schema` contiene `product`, `order`, los metadatos, las taxonomías y el menú `commerce`. Con `?locale=en`, `GET /api/admin/plugins` devuelve `Products`, `Orders` y demás etiquetas traducidas declaradas por Commerce.
3. Crear una entidad con `POST /api/admin/content` y `contentType: "product"`; guardar y leer metadatos mediante `PUT` y `GET /api/admin/plugin-meta`.
4. Ejecutar las acciones `create-product`, `create-customer`, `adjust-inventory`, `add-cart-item` y `create-order`; ejecutar `POST /api/admin/plugins/cloudpress-commerce/jobs/run`.
5. La ruta `GET /api/plugins/cloudpress-commerce/catalog` devuelve 403 sin sesión; con una sesión que tenga `buy-products` devuelve catálogo.
6. `GET` y `DELETE /api/admin/plugins/cloudpress-commerce/privacy/<userId>` exportan y borran los datos personales del plugin.
7. Desactivar el plugin devuelve 404 en sus rutas y lo elimina de `plugin-schema`; desinstalarlo elimina registros, trabajos, términos y capacidades namespaced según `uninstallPolicy`.
8. Rotar el secreto de `commerce-event` con `POST /api/admin/plugins/cloudpress-commerce/webhooks/commerce-event`. Guarda el `token` devuelto una sola vez y llama `POST /api/plugins/cloudpress-commerce/webhooks/commerce-event` con el header `x-cloudpress-webhook-token`. Debe devolver 200; un token distinto devuelve 401. Confirma `webhook_rotated` y `webhook_succeeded` en `plugin_audit_log`.

No se debe usar contenido real para estas pruebas. Borra la cuenta y los datos QA al finalizar.

## Matriz de aceptación

| Criterio | Evidencia reproducible | Resultado observable |
| --- | --- | --- |
| 1. Descubrimiento e instalación | `npm run plugins:build`, `npm test`, después `POST /api/admin/plugins` y `GET /api/admin/plugins` | Commerce aparece en `available` y conserva `enabled` tras otra lectura. |
| 2. CRUD de tipo declarado | Crear `product`, `PATCH /api/admin/content/<id>`, `DELETE`, `POST /api/admin/trash/<id>` | El listado por `?contentType=product` refleja alta, edición, papelera y restauración. La UI ofrece los mismos recorridos. |
| 3. Metadatos | `PUT` y `GET /api/admin/plugin-meta` para `scope=content` y `scope=user` | Valor persistido; valor que excede `maxLength` devuelve `422`. |
| 4. Acciones/auditoría | Ejecutar una acción válida y repetirla con SKU duplicado; consultar `plugin_audit_log` | `action_succeeded` y `action_failed` contienen actor, input y resultado/error. |
| 5. Permisos/rutas | Llamar catálogo sin cookie y con usuario `buy-products` | `403` sin permiso y `200` con la capacidad. |
| 6. Migración/reversión | Instalar, consultar `plugin_migrations`, desinstalar y volver a consultar | La migración namespaced se registra una vez y se elimina con la instalación; no se ejecuta DDL de plugin arbitrario. |
| 7. Tarea idempotente | Ajustar inventario dos veces con el mismo estado y ejecutar `jobs/run` | Sólo existe una fila por `task_id,dedupe_key`; estado `completed` y resultado observable. |
| 8. UI administrativa base | `npm run test:plugin-admin-ui`; abrir `wp-admin`, pulsar **Productos** y comprobar `/admin?contentType=product`; ejecutar `node scripts/verify-production-plugin-content.mjs` | El tipo declarado usa el listado/editor base, con metadatos, taxonomías, revisiones, papelera, restauración y purga. Acciones, diagnóstico, privacidad y webhooks siguen expuestos por el plugin. |
| 9. Privacidad | `GET` y `DELETE /privacy/<userId>` | Exportación contiene registros/metadatos declarados; la segunda lectura está vacía. |
| 10. Ciclo de vida | `PATCH status=disabled`, esperar hasta 3 s en `wp-admin`, `DELETE /api/admin/plugins/cloudpress-commerce` | Las opciones de menú desaparecen sin recarga; el esquema deja de contener el tipo y su ruta devuelve `422`. Los datos se preservan o purgan según `uninstallPolicy`. |
| 11. Commerce de referencia | `npm run test:plugin-host` y pasos HTTP 3–5 | Productos, clientes, inventario, carrito y pedidos de prueba funcionan sin pagos reales. |
