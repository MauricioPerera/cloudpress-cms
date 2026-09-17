# Runtime de agentes gobernado

CloudPress ejecuta agentes externos mediante un modelo de *pull*: el scheduler descubre una tarea en cola y el runner asociado a un perfil reclama una asignación. No se almacenan claves de proveedor ni credenciales de administrador en D1.

## Frontera de credenciales

El runner usa exclusivamente una capacidad opaca y revocable asociada al perfil. Esa capacidad se guarda en el keyring a través del companion LSFA. No se copia a JavaScript, al prompt, a la traza, a checkpoints ni a mensajes. Revocar el perfil o la capacidad invalida los siguientes claims.

## Protocolo de runtime

`POST /api/admin/agent-runtime` admite sólo una capacidad Bearer activa del perfil.

1. `claim` reclama como máximo una tarea del perfil con un lease de cinco minutos.
2. `heartbeat` renueva el lease, acotado a quince minutos.
3. `checkpoint` persiste progreso saneado y un hash SHA-256 de procedencia.
4. `record_model_usage` registra tokens y coste como evidencia atestada por el runner.
5. `write_memory` y `recall_memories` manejan memoria episódica del mismo perfil y propietario.
6. `send_message` y `receive_messages` comunican perfiles del mismo propietario, respetando la clasificación menor común.
7. `delegate_task` crea una tarea hija para otro perfil activo del mismo propietario. La tarea padre no puede completarse mientras el hijo esté activo.

Los pasos de negocio continúan por `/api/admin/agent-execution`. Cada mutación requiere un paso previsto, una capacidad con alcance, postcondición persistida y evidencia. Las operaciones sensibles permanecen detrás del flujo A2F/LSFA; ni el runtime ni una delegación pueden omitirlo.

## Planes DAG

Cada paso puede declarar `dependsOn` con ordinales anteriores. Si se omite, conserva el comportamiento secuencial anterior. El servidor rechaza ciclos o referencias futuras antes de persistir el plan. Las ramas cuyas dependencias ya terminaron se pueden iniciar de forma independiente.

## Recuperación y observabilidad

Un lease vencido vuelve a la cola. Al reanudar, CloudPress materializa un contexto nuevo con el plan inmutable, resultados ya verificados, memoria episódica y mensajes pendientes, todo saneado y con hash. Los eventos de claim, checkpoint, memoria, mensajes, delegación, herramientas y uso de modelos comparten la traza de la tarea.

El catálogo de modelos conserva residencia y presupuestos. `external-webmcp` se ejecuta en el runner local; `cloudflare-workers-ai` usa `env.AI.run()` exclusivamente si Pages tiene un binding **AI** configurado en el panel de Cloudflare y el modelo fue habilitado de forma explícita. Registrar uso no autoriza inferencia ni envío de datos a un proveedor. Sin ese binding, `invoke_model` falla cerradamente y no envía el prompt a ninguna red.
