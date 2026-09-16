# Runbook de despliegue de CloudPress

Este documento separa con claridad una instalación nueva de una actualización. No apliques todas las migraciones sobre una base creada con el `schema.sql` actual: el esquema ya contiene el estado final conocido por CloudPress.

## 1. Instalación nueva

1. Crea el proyecto de Cloudflare Pages desde tu fork y configura como directorio de salida `.` sin comando de build.
2. Crea una base D1 y un bucket R2.
3. En Pages, añade los bindings `DB` (D1) y `MEDIA` (R2).
4. Configura TOTP_ENCRYPTION_KEY como una clave Base64 aleatoria de 32 bytes antes de permitir que alguien active Google Authenticator. RESEND_API_KEY y RESET_FROM sólo son necesarios si también habilitarás recuperación por correo. Nunca los añadas al repositorio.
5. Ejecuta una única vez el esquema completo contra la base nueva:

```powershell
wrangler d1 execute <database> --remote --file schema.sql
```

6. Despliega mediante la integración Git de Pages, o con:

```powershell
wrangler pages deploy . --project-name <pages-project> --branch main
```

7. Aprovisiona el primer administrador mediante un procedimiento controlado de D1 para esa instancia. La ruta pública de registro crea cuentas con rol `user`; no expongas una ruta que convierta automáticamente al primer visitante en administrador. No publiques ni compartas esa credencial.

## 1.1 Scheduler de publicaciones y tareas

Pages Functions no reciben eventos Cron. Para publicar contenido programado y ejecutar tareas encoladas por plugins, despliega el Worker independiente incluido en `scheduler/`, con el **mismo** binding D1 `DB` que usa Pages:

```powershell
Copy-Item scheduler/wrangler.example.jsonc scheduler/wrangler.jsonc
# Sustituye YOUR_D1_DATABASE_ID por el id de la base CloudPress.
wrangler deploy --config scheduler/wrangler.jsonc
```

Su trigger se ejecuta cada minuto, en UTC. Un contenido guardado con estado **Publicado** y una fecha futura permanece en borrador hasta ese momento; al vencer, el scheduler lo publica. Las tareas de un plugin desactivado se conservan en cola y no se ejecutan. Una tarea que quede en `running` durante más de 20 minutos se vuelve a poner en cola; por ello los handlers de plugins deben ser idempotentes mediante `dedupeKey` y sus propios datos.

## 2. Actualización de una instancia existente

1. Haz una copia de seguridad aprobada de los datos antes de cualquier migración que reconstruya tablas.
2. Identifica la última migración aplicada en el registro de despliegue de la instancia. En la primera ejecución, establece ese punto como baseline; el ejecutor crea y mantiene `d1_migrations` a partir de entonces. Para una base creada desde el `schema.sql` actual, el baseline es la última migración incluida:

```powershell
npm run d1:migrate -- --database <database> --remote --baseline 0017_totp_recovery.sql
```

3. Para una instancia que aún no tenga ninguna migración de CloudPress, usa `--baseline none`. El ejecutor sólo debe recibir este valor cuando el operador haya comprobado que la base parte del estado anterior a `0002_content.sql`:

```powershell
npm run d1:migrate -- --database <database> --remote --baseline none
```

4. En adelante, aplica sólo las no registradas. El wrapper delega las migraciones pendientes a `wrangler d1 migrations apply`: Wrangler captura un respaldo, ejecuta cada archivo junto con su registro y revierte el archivo que falle. No usa `BEGIN` manual, que D1 remoto no admite:

```powershell
npm run d1:migrate -- --database <database> --remote
```

El comando usa `wrangler.jsonc` de forma predeterminada. Si la instancia mantiene otra configuración, pásala explícitamente:

```powershell
npm run d1:migrate -- --database <database> --remote --config .\config\wrangler.production.jsonc
```

Puedes inspeccionar el plan sin cambiar D1 con `--dry-run`; para un ledger vacío añade también el baseline que se usaría en la ejecución real.

Si la instancia histórica tiene un ledger discontinuo, el ejecutor se detiene. Primero verifica en D1 que las tablas, índices y columnas de esas migraciones ya existen; sólo entonces reconcilia hasta el último archivo confirmado. La reconciliación **no ejecuta SQL de migración**, únicamente registra los archivos históricos faltantes:

```powershell
npm run d1:migrate -- --database <database> --remote --reconcile-to 0017_totp_recovery.sql
```

5. Despliega el commit correspondiente sólo después de que las migraciones terminen correctamente.
6. Conserva en el registro del despliegue el entorno, commit, operador y última migración aplicada. No repitas migraciones a mano: el ejecutor se niega a adivinar un ledger vacío para evitar reejecutar migraciones que reconstruyen tablas.

## 3. Comprobación posterior al despliegue

- Abre el sitio público y confirma que el contenido publicado responde.
- Inicia sesión con una cuenta temporal administradora y abre `wp-admin`.
- Crea un borrador, edítalo y envíalo a Papelera; después restáuralo y bórralo como dato de QA.
- Sube y borra una imagen de QA.
- Si están habilitados plugins, consulta **Plugins**, instala sólo un plugin incluido en el despliegue y verifica que sus menús y operaciones declaradas aparecen. Sigue [`PLUGIN_HOST_VERIFICATION.md`](PLUGIN_HOST_VERIFICATION.md) para la prueba completa de Commerce.
- Comprueba que un agente sólo ve herramientas WebMCP después de iniciar sesión como administrador y que una llamada cruzada a una API mutable es rechazada.
- Programa una entrada temporal para dos minutos en el futuro y comprueba que permanece en borrador antes de su hora y se publica tras la siguiente ejecución del scheduler.
- Si hay un plugin con `jobs:enqueue`, encola una tarea idempotente y confirma que finaliza como `completed` en `plugin_jobs`.
- Con una cuenta temporal, activa Google Authenticator desde Perfil, conserva los códigos de respaldo y realiza una recuperación en [totp-recovery.html](../totp-recovery.html) con el companion LSFA. Confirma que el código OTP se consume y que el PIN local es solicitado antes de restablecer la contraseña.

No uses contenido o cuentas productivas para estas comprobaciones. Elimina los datos y la cuenta temporal al finalizar.

## 4. Controles antes de fusionar

```powershell
npm test
```

El comando incluye el contrato del ejecutor D1 y debe pasar localmente y en GitHub Actions. Antes de usar una versión nueva del ejecutor en producción, valida además una migración pendiente contra una D1 desechable y confirma que el archivo y su ledger se aplican juntos. Las pruebas locales no sustituyen la comprobación anterior contra Pages, D1 y R2 reales.
