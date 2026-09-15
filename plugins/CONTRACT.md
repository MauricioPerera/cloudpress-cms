# Contrato de plugins CloudPress v2

Un plugin vive en `plugins/<id>/`, declara `manifest.json` y exporta handlers desde `plugin.js`. Su código se compila con Pages Functions; nunca se descarga ni se evalúa código desde D1, R2 o HTTP.

## Descubrimiento sin editar core

Después de añadir o cambiar un plugin, ejecuta `npm run plugins:build`. El generador descubre directorios con `manifest.json` y `plugin.js` y actualiza `functions/_plugins/generated-registry.js`. No se edita `registry.js` por plugin.

## Capacidades del contrato

`cloudpress-plugin/v2` permite declarar tipos de contenido, taxonomías, metadatos de contenido y usuario, menús administrativos, acciones con esquema de entrada, rutas, tareas idempotentes, migraciones namespaced, diagnósticos, privacidad y capacidades personalizadas por rol.

Cada declaración exige el permiso homónimo: por ejemplo `contentTypes` exige `content-types:define`, `routes` exige `routes:register` y `capabilities` exige `capabilities:define`. Las acciones y rutas indican una `capability`; puede ser un rol base (`admin`, `author`, `user`) o una capacidad declarada por el plugin.

Los handlers solo reciben un contexto limitado: `context.data`, `context.enqueue`, `context.audit` y el actor actual. No reciben `env`, D1, R2, secretos ni red.

## Verificación para autores y agentes

Ejecuta:

```powershell
npm test
```

Este comando genera el registro, valida el manifiesto y ejecuta el escenario de Commerce de referencia. El servidor vuelve a validar el contrato antes de instalar y audita instalación, acciones, diagnósticos, privacidad y tareas.
