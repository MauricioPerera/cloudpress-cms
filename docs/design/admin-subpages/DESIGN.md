---
name: CloudPress admin subpages
version: alpha
description: Contrato visual para Roles y Tipos de contenido, derivado del administrador existente.
source: admin.html y admin-subpage.css (repositorio CloudPress)
colors:
  primary: "#2271b1"
  primary-dark: "#135e96"
  navigation: "#1d2327"
  page: "#f0f0f1"
  line: "#dcdcde"
  muted: "#646970"
  danger: "#b32d2e"
  focus: "#72aee6"
  surface: "#ffffff"
typography:
  body:
    fontFamily: system-ui,-apple-system,"Segoe UI",sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.45
  page-title:
    fontFamily: system-ui,-apple-system,"Segoe UI",sans-serif
    fontSize: 25px
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: -0.02em
  card-title:
    fontFamily: system-ui,-apple-system,"Segoe UI",sans-serif
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.3
  nav-label:
    fontFamily: system-ui,-apple-system,"Segoe UI",sans-serif
    fontSize: 11px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: 0.06em
rounded:
  field: 2px
  card: 6px
spacing:
  control: 8px
  form-gap: 16px
  card: 20px
  page: 32px
components:
  sidebar:
    backgroundColor: "{colors.navigation}"
    textColor: "{colors.surface}"
    width: 248px
  topbar:
    backgroundColor: "{colors.surface}"
    height: 58px
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "{spacing.card}"
  field-grid:
    padding: "{spacing.form-gap}"
  primary-button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "{spacing.control}"
  secondary-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.card}"
    padding: "{spacing.control}"
  danger-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    rounded: "{rounded.card}"
    padding: "{spacing.control}"
---

## Overview / Resumen de identidad visual

Alcance: adaptación interna de las pantallas `roles.html` y `content-types.html`, no un sistema oficial independiente. Fuente inspeccionada: `admin.html` del repositorio; fecha: 2026-09-16; viewport de referencia: escritorio ≥850 px y móvil ≤600 px. El administrador usa una jerarquía sobria de navegación oscura, superficie gris clara y tarjetas blancas. Los valores de este apartado son observados en el CSS fuente.

## Colors / Paleta de colores y superficies

Contrato duro: navegación {colors.navigation} `#1d2327`; página {colors.page} `#f0f0f1`; superficie `#ffffff`; borde {colors.line} `#dcdcde`; texto principal `#1d2327`; texto secundario {colors.muted} `#646970`; acción primaria {colors.primary} `#2271b1`; hover `#135e96`; destructivo {colors.danger} `#b32d2e`; foco {colors.focus} `#72aee6`. La tarjeta usa sombra `0 1px 2px rgba(0,0,0,.06)`.

## Typography / Escala tipográfica

Contrato duro: familia {typography.family} `system-ui,-apple-system,"Segoe UI",sans-serif`; cuerpo 14 px / 1.45; marca 20 px peso 750; título de página 25 px peso 650 y tracking `-.02em`; título de tarjeta 17 px; etiqueta de navegación 11 px, peso 700 y tracking `.06em`.

## Components / Componentes y estados

Contrato duro: `sidebar` de 248 px; `topbar` de mínimo 58 px; `content` máximo 1280 px y padding 32 px; tarjetas con borde de 1 px, radio {rounded.card} `6px` y padding 20 px. La cuadrícula de campos tiene dos columnas y separación {spacing.formGap} `16px`; la de opciones usa columnas automáticas de mínimo 220 px. Botón primario: relleno `8px 14px`, azul; secundario: blanco y borde azul; destructivo: blanco y borde rojo. Todos tienen estados default, hover y focus visible de 3 px.

## Navigation / Navegación y composición

Contrato duro: la barra lateral agrupa Contenido y Administración; el enlace actual tiene fondo azul. La cabecera mantiene el contexto de la vista y el enlace al sitio. Contrato blando (inferido): las dos páginas deben sentirse como una extensión del panel, no como utilidades aisladas; por eso conservan la misma barra, cabecera y ritmo de tarjetas. Anti-patrón: formularios centrados en una página sin navegación contextual.

## Forms / Formularios y feedback

Contrato duro: inputs y selects usan borde `#8c8f94`, radio de 2 px y padding 8 px. Las etiquetas tienen peso 600; ayudas usan 12 px y color secundario. Los mensajes de error usan `#b32d2e` y éxito `#146c43`. Antes de confirmar `admin-guard.js`, el cuerpo está oculto. Contrato blando (inferido): agrupar formulario, ayuda y confirmación de la misma entidad evita que el usuario pierda contexto.

## Data / Filas de recursos

Contrato duro: cada rol o tipo es una fila con borde inferior, 16 px verticales, información a la izquierda y `resource-actions` a la derecha. Los estados vacíos mantienen padding de 18 px. Contrato blando (inferido): las acciones de bajo riesgo se mantienen visibles; la eliminación se diferencia por color sin cambiar la ubicación.

## Spacing / Grid, radio y elevación

Contrato duro: escala práctica {spacing.control} `8px`, {spacing.formGap} `16px`, {spacing.card} `20px`, {spacing.page} `32px`; radio {rounded.card} `6px`. No se usan contenedores sin borde sobre el lienzo gris.

## Responsive / Comportamiento responsive

Contrato duro: a 850 px o menos, shell de una columna, barra lateral no sticky, navegación envuelta y padding de contenido 16–22 px. A 600 px o menos, campos, encabezado, filas y acciones se apilan. El foco visible se conserva en todos los tamaños. Touch targets: el padding de botones es 8 px vertical y 14 px horizontal; el tamaño mínimo total no está explícitamente fijado en la fuente (WARNING).

## Do's and Don'ts

- Usar {components.card}, {components.fieldGrid} y {components.resourceRow} para nuevas vistas administrativas.
- Reutilizar los tokens de este contrato, en vez de introducir otro azul, fondo o radio.
- No mover la autorización al cliente: el shell sólo refleja la sesión que valida `admin-guard.js`.
- No ocultar las acciones destructivas detrás de estilos idénticos a las acciones normales.

## Validation Contract

| Estado | Regla | Evidencia | Impacto / corrección |
|---|---|---|---|
| PASSED | Roles y Tipos cargan la misma hoja compartida | `roles.html`, `content-types.html` → `/admin-subpage.css` | Evita divergencia de tokens. |
| PASSED | Conservan formularios, ids y endpoints existentes | `verify-admin-subpage-ui.mjs` | El cambio es visual; no altera permisos ni flujos. |
| PASSED | Se preserva navegación adaptable y foco visible | `admin-subpage.css` | Operable con teclado y móvil. |
| WARNING | No hay tamaño mínimo de toque explícito en el CSS heredado | fuente `admin.html` | Evaluar 44 px si analítica o prueba táctil muestra errores. |
| PASSED | El validador del análisis termina sin errores | `validation-report.json` | Los tokens y la documentación permanecen auditables. |
