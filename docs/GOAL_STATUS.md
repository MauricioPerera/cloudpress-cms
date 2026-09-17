# Estado verificable del objetivo de plataforma

| Área | Estado | Evidencia actual | Falta para cerrar |
|---|---|---|---|
| Tipos, campos y relaciones | Parcial funcional | Tipos propios, campos tipados y referencias validadas; pruebas `test:core-content-types`. | Edición completa y campos repetibles. |
| Temas, plantillas y componentes | Parcial | Preajustes seguros y runtime público. | Plantillas seleccionables y componentes reutilizables administrables. |
| Media | Parcial | R2, metadatos, accesibilidad, licencia y búsqueda. | Carpetas/colecciones, variantes y reutilización visual. |
| Comentarios | Parcial | Cola, aprobación, límite de frecuencia y auditoría. | Spam, papelera y vistas de moderación. |
| API | Parcial | Endpoints y `docs/API.md` publicados. | Contrato OpenAPI versionado y pruebas de compatibilidad. |
| Idiomas | Plugin pendiente | El core aporta contenido, campos, relaciones, roles, capacidades y localización de manifiestos; no contiene lógica editorial de idiomas. | Crear un plugin de idiomas con modelo editorial, fallback, traducciones y selector público. |
| Comercio | Plugin parcial | `cloudpress-commerce` implementa productos, inventario, carritos y pedidos de prueba como plugin, no como código del core. | Completar en el plugin pagos, impuestos, envíos y privacidad operativa. |
| Multisitio y extensiones | Parcial | Contrato de plugins, releases verificadas y capacidades. | Aislamiento por sitio, dominios, distribución y actualizaciones administradas. |
| Seguridad transversal | Parcial | Roles, permisos, LSFA, auditorías y pruebas. | Auditoría final por área y pruebas de producción con sesión controlada. |

No debe marcarse el objetivo como completado hasta que cada fila tenga evidencia de implementación y validación proporcional a su alcance.

## Regla de distribución

El core se limita a mecanismos transversales y contratos de extensión. Comercio, idiomas, SEO, formularios, analítica, reservas y membresías se entregan como plugins versionados y con permisos propios. Una necesidad nueva sólo entra al core si es una primitiva reutilizable, independiente del dominio y necesaria para más de un plugin.
