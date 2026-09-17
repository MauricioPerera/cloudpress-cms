# Contrato de plugins CloudPress v2

Un plugin vive en `plugins/<id>/`, declara `manifest.json` y exporta handlers desde `plugin.js`. Su código se compila con Pages Functions; nunca se descarga ni se evalúa código desde D1, R2 o HTTP.

## Descubrimiento sin editar core

Después de añadir o cambiar un plugin, ejecuta `npm run plugins:build`. El generador descubre directorios con `manifest.json` y `plugin.js` y actualiza `functions/_plugins/generated-registry.js`. No se edita `registry.js` por plugin.

## Capacidades del contrato

`cloudpress-plugin/v2` permite declarar tipos de contenido, taxonomías, metadatos de contenido y usuario, menús administrativos, acciones con esquema de entrada, rutas, tareas idempotentes, migraciones namespaced, diagnósticos, privacidad y capacidades personalizadas por rol.

Cada declaración exige el permiso homónimo: por ejemplo `contentTypes` exige `content-types:define`, `routes` exige `routes:register` y `capabilities` exige `capabilities:define`. Las acciones y rutas indican una `capability`; puede ser una capacidad de núcleo (`admin`, `author`, `user`) o una capacidad declarada por el plugin. Los valores de `defaultRoles` pueden referirse a cualquier rol existente al instalar el plugin, incluidos roles externos como `comprador` o `vendedor`; si falta un rol, la instalación se rechaza de forma segura.

Los handlers solo reciben un contexto limitado: `context.data`, `context.enqueue`, `context.audit` y el actor actual. No reciben `env`, D1, R2, secretos ni red.

## Frontera obligatoria entre núcleo y plugins

El núcleo ofrece los mecanismos generales y seguros: contenido, tipos, campos, relaciones, usuarios, roles, capacidades, media, comentarios, API, plantillas base, auditoría, LSFA y el host de plugins. No contiene reglas de negocio de un sector.

Las funcionalidades de dominio se distribuyen como plugins. En particular, **Commerce** (productos, inventario, carritos, pedidos, pagos, impuestos y envíos) y la gestión editorial **multilingüe** (locales, traducciones, relaciones entre traducciones, fallback y selector público) son plugins. SEO, formularios, analítica, reservas, membresías y similares siguen la misma regla.

Un plugin puede declarar sus propios tipos, taxonomías, metadatos, capacidades, acciones, rutas, tareas y almacenamiento con namespace mediante este contrato. Si necesita una primitiva genérica que el núcleo aún no ofrece, se amplía el contrato de forma explícita y compatible; no se añaden tablas, rutas ni permisos específicos del dominio al núcleo.

## Exposición pública explícita

Un tipo declarado por un plugin sólo puede leerse desde `GET /api/content?contentType=<id>` si añade `"publicApi": true`; la omisión equivale a privado. Una ruta de plugin sólo puede ser anónima si añade `"public": true` y declara exclusivamente `GET`. El host rechaza cualquier otra combinación y las rutas sin esa marca siguen exigiendo una capacidad autorizada.

## Verificación para autores y agentes

Ejecuta:

```powershell
npm test
```

Este comando genera el registro, valida el manifiesto y ejecuta el escenario de Commerce de referencia. El servidor vuelve a validar el contrato antes de instalar y audita instalación, acciones, diagnósticos, privacidad y tareas.
