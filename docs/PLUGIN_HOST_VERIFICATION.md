# Verificación reproducible del Plugin Host SDK

Ejecuta los controles locales antes de desplegar:

```powershell
npm test
```

El resultado debe incluir `plugins:build`, `plugins:validate` y `test:plugin-host` con `ok: true`. El último comprueba descubrimiento sin edición manual del registro, producto, SKU duplicado, inventario, trabajo idempotente, carrito, pedido, tarea, inventario insuficiente y auditoría.

Para una instancia de Cloudflare Pages, aplica las migraciones pendientes en orden y despliega:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = '<account-id>'
wrangler d1 execute <database> --remote --file migrations/0012_plugin_host.sql
wrangler d1 execute <database> --remote --file migrations/0013_plugin_audit_actor_cleanup.sql
wrangler d1 execute <database> --remote --file migrations/0014_plugin_capabilities.sql
wrangler pages deploy . --project-name <pages-project> --branch main
```

Con una cuenta temporal administradora, instala `cloudpress-commerce` desde **Plugins**. Debe aparecer el menú **Comercio** en `wp-admin`; su pantalla genera pestañas para Productos, Pedidos, Acciones, Taxonomías, Diagnóstico y Privacidad desde el manifiesto activo.

Las verificaciones HTTP mínimas son:

1. `POST /api/admin/plugins` con `{ "id": "cloudpress-commerce" }` devuelve `enabled` y `commerce-storage-v1`.
2. `GET /api/admin/plugin-schema` contiene `product`, `order`, los metadatos, las taxonomías y el menú `commerce`.
3. Crear una entidad con `POST /api/admin/content` y `contentType: "product"`; guardar y leer metadatos mediante `PUT` y `GET /api/admin/plugin-meta`.
4. Ejecutar las acciones `create-product`, `adjust-inventory`, `add-cart-item` y `create-order`; ejecutar `POST /api/admin/plugins/cloudpress-commerce/jobs/run`.
5. La ruta `GET /api/plugins/cloudpress-commerce/catalog` devuelve 403 sin sesión; con una sesión que tenga `buy-products` devuelve catálogo.
6. `GET` y `DELETE /api/admin/plugins/cloudpress-commerce/privacy/<userId>` exportan y borran los datos personales del plugin.
7. Desactivar el plugin devuelve 404 en sus rutas y lo elimina de `plugin-schema`; desinstalarlo elimina registros, trabajos, términos y capacidades namespaced según `uninstallPolicy`.

No se debe usar contenido real para estas pruebas. Borra la cuenta y los datos QA al finalizar.
