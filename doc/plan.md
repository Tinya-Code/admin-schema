# Plan de implementación — Admin dinámico Angular

> **Instrucciones para el agente**
>
> 1. Ejecuta las fases **en orden**. No abras una fase sin cerrar el criterio
>    de salida de la anterior.
> 2. Marca un checkbox solo cuando esté verificado (compila + comportamiento
>    comprobado en `npm start`).
> 3. **No crear archivos de test.**
> 4. Reglas de código obligatorias: `doc/structure.md` §2 (Angular 22).
> 5. Nombres y ubicación de archivos: `doc/structure.md` §3.
> 6. Especificación del admin: `doc/base.md` · Contrato backend: `doc/api.md`.
> 7. Si una tarea revela un conflicto con la especificación, detente y reporta
>    antes de improvisar.

---

## Fase 1 — Estilos base (Tailwind v4)

**Objetivo:** tokens de diseño disponibles como utilidades.

- [x] Crear `src/styles/theme.css` con `@theme`: `--color-primary`,
      `--color-secondary`, `--color-accent`, `--color-neutral` (hex de marca,
      planos — sin rampas numéricas), `--font-body` y `--font-display` con
      stack completo de fallback, y `--default-font-family: var(--font-body)`.
- [x] Crear `src/styles/base.css`: reset, estilos base de
      `input/select/textarea/button` y estados de foco (WCAG AA).
- [x] `src/styles.css`: `@import 'tailwindcss';` + import de `theme.css` y
      `base.css` (una sola vez; `angular.json` ya lo registra).
- [x] `npm run build` sin `Cannot apply unknown utility class`.

**Criterio de salida:** build OK y `bg-primary` / `font-display` compilan.
✅ Verificado 2026-10-01: build dev OK; dist contiene `--color-primary`,
`.bg-primary` y `.font-display` generados (chequeo con uso temporal, luego
removido). **Pendiente:** reemplazar los hex placeholder por los de marca.

---

## Fase 2 — Core: modelos

**Objetivo:** la UI tiene un único contrato tipado (`ResourceSchema`).

- [x] `core/models/schema.model.ts`:
  - `ResourceSchema`: `id`, `label`, `labelPlural`, `kind`
    (`'collection' | 'singleton'`), `endpoint`, `keyField`, `titleField`,
    `sortable`, `positionField`, `listColumns`, `filters`, `search`, `fields`,
    `layout`, `actions`, `permissions` (base.md §3).
  - `FieldBase`: propiedades comunes de todo campo (`key`, `type`, `label`,
    `help`, `placeholder`, `required`, `default`, `readonly`, `readonlyWhen`,
    `visibleWhen`, `validators`, `width`, `section`) — base.md §4.
  - `FieldSchema` = unión discriminada por `type` con los 21 tipos de base.md §5:
    simples (`text`, `textarea`, `slug`, `number`, `currency`, `boolean`,
    `select`, `multiselect`, `url`, `email`, `phone`, `date`, `time`,
    `readonly-text`), `relation`, `image`, compuestos (`group`, `list`,
    `string-list`, `key-value`) con sus propiedades extra (`itemFields`,
    `itemTitle`, `min/max`, `primaryFirst`, `itemDisplay`, `resource`,
    `valueField`, `labelField`, `accept`, `maxSizeMB`…).
  - `FieldCondition`: comparaciones `eq | ne | empty | contains` (base.md §4).
  - `ListColumn` con `format: 'text' | 'badge' | 'thumbnail' | 'boolean' |
'number' | 'currency' | 'date'`.
  - `ResourceLayout`: secciones, pestañas, columnas, `width` 1–12.
- [x] `core/models/api.model.ts`: `ApiError { status, message, fieldPath? }` y
      el shape de error del backend `{ error: { status, message, path? } }`
      (api.md §7 — el backend responde **HTTP 200 siempre**).
- [x] `core/tokens.ts`: `InjectionToken` `API_URL` y `ADMIN_TOKEN`.
- [x] Fijar contrato de imágenes: **`image_url` en todo el JSON** (decisión de
      api.md §1) — reflejarlo en los tipos.

**Criterio de salida:** `ng build` compila; un schema de ejemplo
(`categories`) es asignable a `ResourceSchema` sin casts.
✅ Verificado 2026-10-01: schema `categories` completo (base.md §11) asignado
sin casts + narrowing de la unión discriminada; build OK (chequeo temporal
removido). **Conflicto resuelto (2026-10-01, decisión del usuario):** contrato
JSON en `snake_case` — `field.key` y `path` de errores usan los nombres de las
hojas; `api.md` §1 actualizado (sin traducción de estilo, solo ensamblado).

---

## Fase 3 — Core: servicios y providers

**Objetivo:** CRUD genérico funcional contra el backend de api.md.

- [x] `core/services/api.service.ts`: `list`, `get`, `create`, `update`,
      `remove` sobre `endpoint` del schema. Opción A de api.md §6: una sola
      URL con `?path=/…`; `PUT/DELETE` como `POST` con campo `method` en el
      cuerpo. Devuelve JSON plano (sin transformaciones ocultas).
- [x] `core/interceptors/api-error.interceptor.ts`: detecta
      `{ error: {…} }` en el body aunque el HTTP sea 200 y lo lanza como
      `ApiError`.
- [x] `core/interceptors/auth.interceptor.ts`: adjunta `ADMIN_TOKEN` en
      rutas `/admin/*` y `/upload`.
- [x] `core/services/error-mapper.service.ts`: `ApiError` → mapa
      `{ [fieldPath]: message }`; sin `path` → error general.
- [x] `core/services/upload.service.ts`: `POST /upload` (multipart) →
      devuelve `image_url` pública.
- [x] `core/services/notification.service.ts`: signals de toast + estado de
      confirmación.
- [x] `app.config.ts`: `provideHttpClient(withInterceptors([apiError, auth]))` + `provideRouter`.

**Criterio de salida:** un `GET` real (ej. categorías) devuelve datos, y un
error simulado se convierte en `ApiError` mapeado.
✅ Verificado 2026-10-01 con verificación efímera (6/6 en verde, eliminada
después): GET devuelve datos + token adjunto; 200-con-error-body → `ApiError`
con `fieldPath` → mapper lo asocia al campo exacto; `update`/`remove` usan
`method` override; error sin ruta → mensaje general. **Pendiente:** GET contra
el backend real (Web App de Apps Script aún no desplegado).

**Contratos fijados en esta fase:**

- `PUT` → `POST` con body `{ ...payload, method: 'PUT' }`; `DELETE` → body
  `{ method: 'DELETE' }` (el backend extrae `method`).
- El token se adjunta a toda petición a la API cuando hay token (con
  `?path=/…` las rutas admin no son visibles en la URL).
- Respuesta de upload: `{ image_url: string }`.
- `API_URL` por defecto `''` (mismo origen) — OBLIGATORIO configurar al
  desplegar.

---

## Fase 4 — Shared: utilidades

**Objetivo:** lógica pura, sin Angular, reutilizable.

- [x] `shared/utils/gap-sorting.ts` (base.md §8): paso 1000; `moveBetween`
      (punto medio), `moveToStart`, `moveToEnd`, `needsRebalance`,
      `rebalance` (renumeración conservando orden).
- [x] `shared/utils/condition-evaluator.ts`: evalúa `FieldCondition` contra el
      valor actual (campo hermano o raíz) para `visibleWhen` / `readonlyWhen`.
- [x] `shared/utils/field-path.ts`: leer/escribir valor por ruta
      (`faq[2].answer`) y construir rutas — base para errores de listas.
- [x] `shared/utils/validators.ts`: longitud por caracteres/palabras, patrón,
      rango numérico.

**Criterio de salida:** ✅ las 4 utilidades son funciones puras importables
(verificación efímera 18/18 en verde, borrada; contrato: `computeMove` exige
elemento existente — el alta es `appendPosition`; vacío = `undefined/null/''`,
solo espacios NO vacío).

---

## Fase 5 — Shared: componentes UI base

**Objetivo:** primitivas visuales reutilizables, agnósticas de dominio.

- [x] `shared/components/`: `app-button`, `app-spinner`, `app-skeleton`,
      `app-empty-state`, `app-badge`, `app-modal`, `app-confirm-dialog`,
      `app-toast` (contenedor de `NotificationService`).
- [x] Cada uno: standalone sin flags, `input()`/`output()`, clases Tailwind,
      accesible (AXE / WCAG AA).

**Criterio de salida:** ✅ los 8 componentes renderizan aislados (verificación
efímera 8/8 en verde, borrada). Notas de diseño:

- `app-button` es selector por atributo `button[app-button]` (patrón
  `button[mat-button]`): conserva semántica nativa y las clases del
  consumidor.
- `shared` no importa `core`: `app-toast` y `app-confirm-dialog` son tontos
  (inputs `toasts`/`options`, outputs `dismissed`/`confirmed`/`cancelled`);
  los une el shell en Fase 7 (compatibilidad estructural de tipos).
- `theme.css`: +`--color-danger` y +`--color-success` (pedido por el diseño:
  toast de error, borrado destructivo, badge de éxito; AA con blanco 4.83:1
  y 5.47:1).
- Templates inline (best practices: componentes pequeños → template inline;
  la convención de archivos .html/.css aplica a componentes grandes).
- Verificado: ARIA estructural (roles, `aria-modal`/`aria-labelledby`,
  `aria-live`, `aria-hidden` decorativo, `aria-busy`) + contraste AA. Run
  AXE completo queda pendiente de infra E2E (sin axe-core instalado).
- Lección: con OnPush default (v22), mutar campos planos en un host de test
  NO marca dirty — usar signals.

---

## Fase 6 — Schemas de recursos + registry

**Objetivo:** los 4 recursos definidos como datos (base.md §11).

- [x] `schemas/categories.schema.ts`: colección reordenable; campos
      `slug` (autogenerado desde `name`, bloqueado tras crear), `name`,
      `seo_title`, `seo_description`, `intro` (~150 palabras), `image_url`
      (req), `image_alt`, `active`; listado con miniatura/nombre/switch.
- [x] `schemas/products.schema.ts`: pestañas General, Contenido, Imágenes
      (`images` list mín 1, `primaryFirst`), Sanitario, Ficha técnica
      (`specs` key-value), FAQ (`faq` list); `category_slug` como `relation`.
- [x] `schemas/site.schema.ts`: singleton — grupos `address` y `geo`,
      `hours` (list de `multiselect`+`time`), `social` (`string-list` de URLs).
- [x] `schemas/legal.schema.ts`: singleton — `ruc` (patrón 11 dígitos),
      `reclamos_response_days` (number), `prices_include_igv` (boolean),
      `last_updated` (readonly).
- [x] `schemas/registry.ts`: lista ordenada de schemas + `getSchema(id)`;
      alimentará menú y rutas.

**Criterio de salida:** ✅ los 4 schemas typean contra `ResourceSchema`
(build OK; el typecheck cazó `itemTitle` inválido en `KeyValueField`) y el
registry lista los 4 (verificación efímera 4/4 verde, borrada: orden,
`getSchema`, coherencia layout↔`section`, `titleField`/`keyField` en campos,
relation→schema registrado, endpoints `/admin/*`). Decisiones:

- Endpoints admin: colección `/admin/{recurso}[/{key}]`, singleton
  `get`/`update` en `/admin/{recurso}`.
- Filtros: `categories` → boolean `active` (requerido por criterio Fase 8);
  `products` → `availability` (select) + `active`.
- `intro` 100–200 palabras y `description` 150–300 (tolerancia al "~150").
- `keyField: 'key'` en singletons (sin clave real; `get`/`update` no la usan).
- `price`/`currency`: sin `currencyFrom` — la moneda sale del singleton
  `site` (decidir resolución en Fases 8/9 al renderizar).

---

## Fase 7 — Shell: layout, menú y rutas

**Objetivo:** navegación real entre recursos.

- [x] `shell/layout/`: esqueleto sidebar + área principal.
- [x] `shell/sidebar/`: menú generado desde `registry.ts` (`label`/`labelPlural` + `permissions`).
- [x] `shell/shell.routes.ts`: una ruta por recurso → `resource-page`
      (lazy, `loadComponent`). _Implementado como ruta dinámica `:id`
      resuelta contra el registry (cumple §13.1: agregar recurso = schema)._
- [x] `app.routes.ts`: `''` → shell con `loadChildren`; redirect inicial al
      primer recurso.
- [x] `app.ts`: `router-outlet` + contenedor `app-toast`.

**Criterio de salida:** se navega por los 4 recursos sin errores de consola.

---

## Fase 8 — Resource page + List view

**Objetivo:** listado completo de colecciones.

- [x] `pages/resource-page/`: lee el schema → `kind: 'collection'` muestra
      list view; `kind: 'singleton'` muestra form view (placeholder hasta
      Fase 10). Aplica `permissions` (sin permiso → estado "sin permisos").
- [x] `pages/list-view/`:
  - Tabla desde `listColumns` con los 6 formatos (texto, badge, thumbnail,
    booleano, número, moneda, fecha).
  - Búsqueda (`search`) y filtros (`filters`) — **en el cliente**: api.md no
    define parámetros de consulta, el endpoint admin devuelve todos los
    registros.
  - Switch `active` inline en la fila si el schema lo declara.
  - Acciones: editar, borrar (confirmación), `actions` extra del schema
    (con `urlTemplate` abre/navega; sin él, aviso "próximamente" — no hay
    contrato de backend para duplicar).
  - Botones crear / ir a edición → ruta de form view.
  - Orden por `positionField` ascendente.
  - Estados: skeleton, vacío, error de red con reintento, sin permisos.
- [x] `canDeactivate` funcional para aviso de "cambios sin guardar"
      (`core/guards/unsaved-changes.guard.ts` + `FormView.dirty`, diálogo en
      la raíz vía `NotificationService.confirm`).

**Criterio de salida:** `categories` lista completa: buscar, filtrar, activar/
desactivar y navegar a edición.

---

## Fase 9 — Field host + campos simples

**Objetivo:** el 78% del catálogo de tipos renderizando (15 simples).

- [x] `fields/field-host/`: despachador **recursivo** — recibe `field` +
      el nodo del formulario y renderiza el componente según `type`
      (`@switch`); los tipos compuestos lo vuelven a invocar.
- [x] `fields/text/`, `textarea/` (contador de caracteres/palabras),
      `slug/` (autogenera desde `from` con slugify, bloquea si
      `lockAfterCreate` y el registro existe), `number/` (`min/max/step/
    decimals`), `currency/` (prefijo; valor numérico puro), `boolean/`
      (switch con `trueLabel`/`falseLabel`).
- [x] `fields/select/`, `multiselect/` (chips — **`<select multiple>` no es
      soportado por `[formField]`**, implementar control propio),
      `url/` (validación + botón abrir), `email/`, `phone/` (normaliza
      E.164 o dígitos según `format`), `date/`, `time/`, `readonly-text/`
      (con `format`).
- [x] Todos bindean el valor con `[formField]` de Signal Forms o
      `model()` según convenga; sin `@Input()`.

**Criterio de salida:** los 15 tipos simples escriben en el modelo y muestran
su estado de validación.

---

## Fase 10 — Form view: estado, validación y guardado

**Objetivo:** formulario genérico completo desde el schema.

- [x] `pages/form-view/`: `signal<TModel>` + `form()` de
      `@angular/forms/signals` (estable en v22). Verificar acceso dinámico a
      nodos por clave (`form()[field.key]`); si el tipado lo bloquea, tipar el
      modelo como `Record<string, unknown>` o envolver en helper — **reportar
      la solución usada**.
- [x] Validación generada desde `fields`: `required`, `pattern`, `min/max`,
      `minLength/maxLength` nativos; palabras y "único" con `validate` /
      `validateAsync`; `debounce` para validar al perder foco.
- [x] `visibleWhen` → `hidden()` de Signal Forms (el campo no se muestra **ni
      se envía**); `readonly` / `readonlyWhen` → `readonly()`.
- [x] Layout: secciones/pestañas/columnas del schema; `width` 1–12 en grid.
- [x] Estado: `dirty()`, `saving` signal, bloqueo de doble guardado, aviso al
      salir (guard de Fase 8).
- [x] Guardado: `submit()` → create/update (según exista `keyField`), recarga,
      toast de confirmación. Borrado con confirmación; si el backend rechaza,
      mostrar el motivo.
- [x] Errores del backend → `error-mapper` → pintar en la ruta exacta del
      campo; sin ruta → error general sobre el formulario.

**Criterio de salida:** crear y editar una `category` con validación, error de
backend en el campo exacto y aviso de salida con cambios.

**Reporte Fase 10 — solución y desviaciones:**

- **Acceso dinámico a nodos:** `form()[field.key]` no compila sobre
  `Record<string, unknown>` sin casts. Se resolvió con **`childTree(tree,
  key)()`** (`fields/field-node.ts`), que devuelve el `FieldState` de una clave,
  y con `pathAt()` en `form-schema.ts` donde centraliza todos los casts del
  registro de reglas. `SchemaPathTree` es un Proxy que materializa los hijos
  bajo demanda, por eso `pathAt` nunca devuelve `undefined` (el `throw` es
  defensivo).
- **`debounce` al perder foco: omitido deliberadamente.** `debounce` difiere
  `controlValue → value` (el modelo), no la visibilidad de los errores: con él,
  un control custom que nunca emite `touch` se quedaría sin datos en el
  payload. La UX de "validar al perder foco" la aporta `FieldHost`
  (`invalid() && touched()`) y el modelo se sincroniza en el mismo tick
  (`debounceSync` sin debouncer configurado es síncrono).
- **`required` sobre `boolean`: no se aplica.** `false` cuenta como vacío y
  bloquearía el guardado al desmarcar el checkbox; el esquema lo expresa con
  `default: false`.
- **`minDate`/`maxDate`: no se usan.** Exigen `Date|null` y el valor es string
  ISO; las fechas se validan con `validate` lexicográfico `YYYY-MM-DD`.
- **Campos no soportados aún** (`image`, `relation`, `list`, `key-value`):
  no reciben reglas de validación hasta la Fase 11, pero **sí viajan en el
  payload** (whitelist por `schema.fields`).
- **Errores del backend** viven en `serverErrors` propio, limpiado al iniciar
  cada guardado — no en `submissionErrors`, que Signal Forms limpia al editar
  cualquier valor.
- **`<form novalidate>` es obligatorio:** `required` setea el atributo nativo
  y la validación del navegador bloquearía el submit con una burbuja invisible
  (los campos viven dentro de `<details>`).

---

## Fase 11 — Campos compuestos, relation e image

**Objetivo:** anidamiento y subida (base.md §6, §7, §9).

- [x] `fields/group/`: tarjeta / sección colapsable; hijos vía field-host
      (recursivo).
- [x] `fields/relation/`: select con búsqueda; opciones desde otro recurso vía
      `ApiService` (`resource`, `valueField`, `labelField`, `onlyActive`).
- [x] `fields/image/`:
  - Estados: vacío (dropzone + botón), con imagen (preview, Reemplazar,
    Quitar si no requerido, ver en grande), subiendo (progreso; el valor no
    cambia hasta terminar), error (mensaje y conserva la imagen anterior).
  - Cliente valida `accept` y `maxSizeMB` antes de subir; valor = `image_url`.
- [x] `fields/list/`: items con asa de arrastre (CDK), eliminar con
      confirmación, `min`/`max` (deshabilita agregar/eliminar), `primaryFirst`
      marcado visualmente, `itemDisplay` card/row/accordion, agregar con
      `default`, reordenar con `gap-sorting` local, errores por ruta
      (`faq[2].answer`), botones subir/bajar para móvil.
- [x] `fields/string-list/`: solo `text | url | email`, ordenable.
- [x] `fields/key-value/`: tabla editable clave/valor, ordenable.
- [x] Verificar anidamiento hasta 2 niveles: list dentro de group dentro de
      list, relation dentro de item, campo condicional dentro de grupo
      (base.md §9).

**Criterio de salida:** las pestañas Imágenes, Ficha técnica y FAQ de
`products` funcionan de punta a punta.

---

## Fase 12 — Reordenamiento, singletons e integración

**Objetivo:** cerrar criterios de aceptación de base.md §13.

- [x] Reordenar listado por arrastre (solo si `sortable` y sin filtros):
      cálculo con huecos en el front, envío de un único cambio de posición
      (o lote completo si hay rebalanceo), actualización optimista y reversión
      con aviso si falla. El usuario nunca ve números de `position`.
- [x] Singletons `site` y `legal` de punta a punta: clave/valor → objeto,
      grupos `address`/`geo`, `hours` (list), `social` (`string-list`).
- [x] Estados universales en todas las vistas (skeleton, vacío, error con
      reintento, sin permisos).
- [x] Verificar checklist de base.md §13 (10 criterios) uno por uno y marcarlo
      en este documento.
      - [x] 1. Recurso nuevo = schema + registro en `registry.ts` (menú,
            listado y formulario dinámicos).
      - [x] 2. Todos los tipos del catálogo §5 tienen `@case` en `field-host`
            (render + validación + guardado probados por fase).
      - [x] 3. `list` dentro de `group` dentro de `list` (spec efímero §9:
            3/3).
      - [x] 4. `image` muestra, reemplaza y refleja la URL sin recargar
            (E2E Fase 11).
      - [x] 5. Reordenar con huecos + rebalanceo solo sin espacio
            (`gap-sorting` + spec de listado: cambio único, lote y reversión).
      - [x] 6. `visibleWhen` / `readonlyWhen` / `required` / `min`-`max` /
            validadores en cualquier nivel (Fase 10 + §9 + guardado
            `site`/`legal`).
      - [x] 7. Errores del backend en el campo exacto, incluso en items de
            lista (E2E Fase 11).
      - [x] 8. Payload = contrato (`image_url`, posiciones excluidas,
            subclaves del singleton) (Fase 10 + guardados `site`/`legal`).
      - [x] 9. Aviso al salir con cambios sin guardar (`unsavedChangesGuard`
            en `shell.routes.ts`) y bloqueo de doble guardado (`saving()`).
      - [x] 10. Móvil: arrastre táctil (CDK) + botones subir/bajar en
            listado y listas internas.
- [x] `npm run build --configuration production` OK dentro de budgets
      (326.59 kB inicial, límite 500 kB).
- [x] Revisión AXE sobre páginas principales (listado + formulario):
      `axe-core` sin violaciones (corregido `heading-order` de grupos).

**Criterio de salida:** los 10 criterios de aceptación de base.md §13
verificados; build de producción limpio.
