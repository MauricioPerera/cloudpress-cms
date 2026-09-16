# FastWebMCP + LSFA en CloudPress

CloudPress usa FastWebMCP en el navegador para las operaciones reversibles del administrador. Las operaciones irreversibles no llaman directamente a las APIs de borrado: pasan por un companion LSFA local.

```text
Agente → FastWebMCP en CloudPress → Companion LSFA local
                                      │ confirmación humana reforzada
                                      ▼
                         CloudPress approval token de un solo uso → acción determinista
```

## Recuperación sin correo

La página /totp-recovery.html no expone una herramienta WebMCP ni entrega credenciales al agente. Prepara una solicitud de cinco minutos, la entrega sólo al companion loopback y éste sigue una secuencia fija: verifica el OTP TOTP en CloudPress, solicita el PIN local y finalmente llama a la URL exacta de restablecimiento. El token de recuperación es opaco, de un solo uso y nunca forma parte del resultado LSFA.

La recuperación tiene riesgo high: el OTP es el segundo factor verificado por CloudPress y LSFA exige pin local. Las acciones irreversibles siguen teniendo riesgo irreversible y exigen pin_and_totp en LSFA.

## Operaciones

Las herramientas reversibles (`crear borrador`, `editar con revisión`, `Papelera`, `restaurar`, activar/desactivar, gestionar términos y metadatos) usan las mismas rutas autorizadas que el panel. Los tipos de contenido, metadatos y taxonomías de plugins sólo se exponen cuando el plugin está activo y los declara en su contrato; el agente debe consultar `plugin_schema` antes de escribirlos.

`cloudpress_upload_media` recibe una imagen que el agente ya generó localmente como `data URL` Base64. Antes de crear el archivo en el navegador valida PNG, JPG, GIF o WebP y un límite de 10 MB; después usa el mismo `POST /api/admin/media` multipart que la biblioteca y devuelve clave, nombre, tamaño, URL y metadatos editoriales opcionales: título, texto alternativo, leyenda, descripción, creador, licencia y URL de fuente. No acepta URLs remotas como origen de la imagen, no descarga contenido de terceros y no usa credenciales fuera de la sesión administrativa del navegador.

CloudPress persiste esos metadatos en D1, separados del objeto en R2. `cloudpress_read_admin_state` puede consultar la biblioteca con sus metadatos y `cloudpress_update_media_meta` corrige un registro existente sin reemplazar el archivo. Las URLs de fuente sólo aceptan HTTP o HTTPS; el agente no debe inventar atribución, licencia ni procedencia.

`cloudpress_sensitive_action` es la única herramienta para estas operaciones irreversibles:

- `purge_content`: sólo contenido que ya esté en Papelera;
- `delete_user`: nunca la cuenta administradora que inició la solicitud;
- `delete_media`;
- `uninstall_plugin`.
- `delete_metadata`: sólo un valor existente de una clave declarada y activa;
- `delete_core_term`;
- `delete_plugin_term`.

El input de WebMCP contiene sólo el tipo y el identificador del objetivo. No admite contraseñas, cookies, tokens, PIN, TOTP ni datos de confirmación.

## Protocolo del companion local

El companion escucha exclusivamente en `127.0.0.1:9463`. Debe permitir CORS únicamente para la URL de CloudPress configurada, responder los preflights con `Access-Control-Allow-Private-Network: true` para los navegadores que aplican Private/Local Network Access, y exponer:

`Origin` y CORS no autentican procesos locales. Al vincularse, el companion genera una credencial aleatoria de canal, la guarda junto a la capacidad en el almacén seguro del sistema y la entrega una sola vez al navegador Admin. El navegador la conserva en almacenamiento del mismo origen y debe enviarla como `X-LSFA-Channel-Token` para usar el proxy del agente o solicitar aprobaciones. Un proceso que sólo falsifique `Origin` recibe `401 invalid_channel`.

La frontera de confianza es el perfil del sistema operativo que ejecuta el companion y su almacén de credenciales. Un proceso que ya pueda leer ese almacén actúa con los permisos del usuario local; LSFA no pretende aislar procesos comprometidos dentro de la misma cuenta del sistema operativo.

```text
GET  /health
POST /v1/cloudpress/approvals
```

Las rutas de agente están limitadas dos veces: el companion mantiene una lista explícita de métodos/rutas reversibles y CloudPress aplica la misma restricción al autenticar el bearer. Añadir un nuevo endpoint `/api/admin/*` no lo concede automáticamente al agente. Exportaciones, ajustes, privacidad de plugins y cualquier ruta desconocida quedan fuera del alcance.

En **Perfil**, el administrador puede ver las capacidades emitidas y revocar cualquiera. Vincular nuevamente rota las capacidades activas de ese administrador, por lo que perder el almacenamiento local no deja accesos huérfanos indefinidamente. La vinculación inicial usa deliberadamente la sesión Admin activa más el enrolamiento LSFA previo; no vuelve a pedir PIN/TOTP. Las acciones irreversibles sí mantienen su confirmación LSFA reforzada.

CloudPress primero comprueba `GET /health`. Si falla, la herramienta devuelve `failed` con `broker_unavailable` y no prepara ni ejecuta una acción.

Cuando está disponible, el navegador prepara `POST /api/admin/approvals` usando la sesión administradora. La respuesta contiene un `requestId`, el resumen canónico del objetivo, una caducidad de cinco minutos y un token opaco de ejecución. Ese token se transmite sólo al companion local, nunca al agente ni en la respuesta WebMCP.

El `POST /v1/cloudpress/approvals` recibe un objeto LSFA 0.2 con:

- `request`: id, operación, propósito, riesgo, caducidad y resumen canónico;
- `execute`: URL de CloudPress y token opaco.

El companion debe validar el origen configurado, mostrar al usuario operación, destino, alcance y riesgo, y aplicar la política LSFA local. Para riesgo `irreversible`, LSFA exige confirmación humana de un solo uso y segundo factor; una UI que sólo muestre un botón **no es conforme**.

Tras una aprobación válida, el companion llama exactamente una vez a `execute.url` con el encabezado `x-cloudpress-approval-token`. Sólo debe devolver `status: accepted` si CloudPress responde `state: accepted`. En caso de rechazo, expiración, error de factor o duda, no llama a la URL de ejecución y devuelve un resultado LSFA no aceptado. Nunca registra ni devuelve el token.

## Garantías del servidor

CloudPress persiste el objetivo canónico y el hash del token en `approval_requests`; guarda eventos sin secretos en `approval_events`. Al ejecutar, reclama la solicitud de modo atómico (`pending → executing`) y no permite reutilización. La operación se completa como `accepted`, `failed` o `unknown`; este último se usa cuando un efecto externo, como R2, no puede confirmarse de forma concluyente. No se reintenta automáticamente una solicitud consumida.

Aplica la migración `0016_approval_requests.sql` a las instancias existentes antes de desplegar esta integración. Para una base nueva, `schema.sql` ya incluye las tablas.

## Límites intencionales

CloudPress incluye el cliente del companion, no una GUI LSFA ni un verificador local de PIN/TOTP. Esos componentes deben implementarse con el SDK y las políticas de [Local Secure Forms](https://github.com/MauricioPerera/local-secure-forms). El companion es una frontera confiable independiente del navegador y del agente; no lo sustituyas por una confirmación que el agente pueda invocar mediante WebMCP.
