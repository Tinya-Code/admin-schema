# Motor — plan de ampliación

> **Etapa 1 de 2: el renderizador.**
> Esta etapa **no implementa PickPass**: prepara el motor — backend y
> frontend — para que cualquier cosa nueva se pueda **declarar en el schema**
> y se **dibuje**. La prueba con datos recién entra en la Etapa 2.
>
> | Etapa | Documento                                            | Pregunta                                |
> | ----- | ---------------------------------------------------- | --------------------------------------- |
> | **1** | **este** (`motor-plan.md`)                           | _¿Puedo declararlo y se dibuja?_        |
> | **2** | [`pickpass-plan.md`](./pickpass-plan.md)             | _¿Con datos reales funciona?_           |
> | —     | [`pickpass-viabilidad.md`](./pickpass-viabilidad.md) | _¿Por qué y con qué criterio?_ (A6, C4) |

> **Estado — Etapa 1: batería ✅ verde (05-10-2026).**
>
> | Bloque                                                      | Estado                                                                                   |
> | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
> | T0 · T1.1 · T2 (`M1`)                                       | ✅                                                                                       |
> | T1.2 — los 2 checks de PickPass                             | ⏸️ deferido a **Etapa 2, fase 1**                                                        |
> | T3 — tipo de campo nuevo                                    | **N/A**                                                                                  |
> | T4 `kind: 'dashboard'` · T5 `widget-host` · T6 `copy-share` | ✅                                                                                       |
> | T7 — `metric-card` · `bar-chart` · `chart-line`             | ✅                                                                                       |
> | 3.3 — `Dashboard`                                           | render ✅ · **fetch** ⏸️ bloqueado en Etapa 2 (S4: no existe aún el endpoint)            |
> | M2 `aggregate:` · M3 `REGISTRY.hooks`                       | ✅ **Etapa 1 cerrada** — ambos con test primero                                          |
> | **Batería**                                                 | **74/74 api (6 ficheros) · `api:check` VERDE · 91/91 front · `ng build` ✓ · prettier ✓** |

**Leyenda**

| Marcador | Significado                                                    |
| -------- | -------------------------------------------------------------- |
| 🔵       | **Registro o componente** — cero cambios en `engine/`/`setup/` |
| 🟡       | **Toca el motor** → su test se escribe **antes** del cambio    |

---

## 0. El criterio (viabilidad A6)

> **El schema es el único plano de control.** Si para cambiar el
> comportamiento hay que tocar JS, el DSL falló.

| Cerrar con…                                             | Cuando la intención…                                              | Coste           |
| ------------------------------------------------------- | ----------------------------------------------------------------- | --------------- |
| **Registro nuevo** (`REGISTRY.*` / componente nuevo)    | **se lee en el schema**: `transform: 'token'`, `type: 'widget-x'` | 🔵 cero motor   |
| **Cláusula nueva** (`aggregate:`, `hooks:`, 3er `kind`) | **ni el nombre alcanza** para expresarla                          | 🟡 motor + test |

---

# PARTE 1 — MOTOR BACKEND

## 1.0 Estado previo

- [x] Confirmar que `npm run test:api` está verde **antes** de tocar nada — **29/29**
- [x] Confirmar que `npm run api:check` está verde (4 recursos, 62 campos) — **3/3 VERDE**

## 1.1 Registros existentes 🔵

> Cada `REGISTRY.*` es un **plugin**: registrar la función hace que el schema
> la use **sin tocar `engine/`**.

| Registro                    | Archivo                       | Hoy             |
| --------------------------- | ----------------------------- | --------------- |
| `REGISTRY.transforms`       | `primitives/transforms.js:15` | **1** `slugify` |
| `REGISTRY.checks`           | `primitives/checks.js:14`     | **3**           |
| `REGISTRY.handlers`         | `primitives/handlers/*.js`    | **1**           |
| `REGISTRY.ops`              | `primitives/ops.js:64`        | **13**          |
| `REGISTRY.endpoints`        | `schema/endpoints/*.js`       | **2**           |
| `REGISTRY.types.fieldTypes` | `schema/types/01-types.js:9`  | **20** tipos    |

### T1 — Añadir un registro genérico 🔵

> Protocolo idéntico para `transforms`, `checks` y `handlers`.

**T1.1 — Transform `token`** (genérico: sirve a cualquier recurso)

- [x] **Escribir el test PRIMERO** en `api/__tests__/transforms.spec.js`
      — 13 casos: longitud, unicidad razonable (200 muestras), caracteres
      seguros para URL, alfabeto sin ambiguos, params, idempotencia del
      registro, y **el camino sin `crypto`** (Apps Script V8)
- [x] Registrar `REGISTRY.transforms.token = fn` en `api/primitives/transforms.js`
- [x] Firma exacta: `fn(valor, params) → string` (`24-crud.js:614`)
- [x] Integración en `api/__tests__/compute-rules.spec.js` — `ref` derivado
      con `from` sólo como trigger + guard de origen vacío + no rederiva en update
- [x] `npm run test:api` verde — **45/45** (29 previos + 16 nuevos)
- [x] `npm run api:check` verde — **3/3**

**T1.2 — Checks de negocio** ⏸️ **DEFERIDO A ETAPA 2, fase 1**

> **No es 🔵 como se planificó.** Verificado: `24-crud.js:268/288` pasa
> `childrenForValidation_(map, payload, false)`, que sólo incluye las hijas
> **presentes en el payload** (`:625`), y `ctx.current` es
> `flatToContract_` = **sólo columnas** (`23-validate.js:103`).
> `history` es _child-sheet_ ⇒ **el check no ve el historial guardado**.
> `effectiveChildren_` (`24-crud:281`) sí fusiona pero **no llega a validate**.
>
> - **Opción A**: pasar `currentChildren` a `checkCtx` → 🟡 (toca `engine/`)
> - **Opción B (elegida)**: nacer junto a `orders`, con integración real
>
> Además `history-append-only` no tiene consumidor hasta que exista `orders`.

- [ ] `REGISTRY.checks['history-append-only']` en `api/primitives/checks.js`
- [ ] `REGISTRY.checks['no-auth-after-delivered']` en el mismo fichero
- [ ] Firma: `fn(scope) → [{ path, message }]` — **no lanza**, vacío = ok
- [ ] Resuelve el acceso al historial guardado (ver nota de arriba)
- [ ] `npm run test:api` + `npm run api:check` verdes

## 1.2 Cláusulas — lo único que toca `engine/`/`setup/` 🟡

| #   | Cambio                                            | Archivo                    | Líneas                  |
| --- | ------------------------------------------------- | -------------------------- | ----------------------- |
| M1  | `if (resource.sheet)` — no crear hoja sin storage | `setup/02-setup-sheets.js` | **108-114** → 1 línea   |
| M2  | `aggregate: 'count'\|'sum'\|'avg'` en `views`     | `engine/27-views.js`       | +25-40 → **+51 ✅**     |
| M3  | `REGISTRY.hooks` — el motor **emite** eventos     | `engine/24-crud.js`        | +30-50 → **+94/−11 ✅** |

### T2 — M1: guard de hoja 🟡 ✅ **HECHO**

> **Decisión tomada:** el descriptor del dashboard **va en `registry.ts`**
> ⇒ **M1 es obligatorio** (no N/A).

- [x] **Decidir:** descriptor del dashboard ¿en `registry.ts` o aparte?
      → **en `registry.ts`**
- [x] **Test PRIMERO** — `api/__tests__/setup-sheets.spec.js` (5 tests;
      los2 fallaban antes del guard: `expected […] to not include undefined`)
- [x] Añadir el guard en `02-setup-sheets.js` — `if (!resource.sheet) return;`
      (salta hoja principal **y** hijas)
- [x] Verificar que los 4 recursos existentes siguen creando su hoja
- [x] `npm run test:api` verde — **50/50** · `api:check` **3/3 VERDE**

### T2b — M2: `aggregate` en views 🟡 ✅ **HECHO**

> Sin M2 todo funciona: ya existe el escape hatch `handler`
> (`27-views.js:7-13`, ejecuta en `:199`).

- [x] **Test PRIMERO** de `evalWhere_` / `sortItems_` / `applyDeclaredView_` —
      `27-views.js` tenía **253 líneas y 0 tests**
      → `api/__tests__/views.spec.js`, **10 tests de regresión verdes ANTES
      de tocar el motor**
- [x] Añadir la cláusula `aggregate` y su validación (500 ante config rota)
      → `VIEW_AGGREGATES_` + `validateViewAggregate_()` + `aggregateItems_()`
      (**+51 líneas** en `27-views.js`, diff sobre HEAD)
- [x] Test de la cláusula nueva → **4 tests que fallaban antes** del cambio
      (Parte B) y pasan después
- [x] `npm run test:api` verde — **64/64 en 5 ficheros** · `api:check`
      **3/3 VERDE** · `npm test` **91/91** · `ng build` ✓

**Contrato decidido:**

- `aggregate: 'count' | 'sum' | 'avg'`; `field` **obligatorio** para `sum`/`avg`.
- Devuelve **una fila** `[{ value: <number|null> }]` (sigue el contrato de
  lista ⇒ `shapeEnvelope_` lo envuelve y `applyShape_` no se aplica porque
  `viewShape === listShape`).
- Cadena: `where` ⇒ `sort` ⇒ `limit` ⇒ `aggregate` — el `limit` acota el
  conjunto que se agrega.
- Semántica SQL: `opsNumber_` → `null` ⇒ **NULL ignorado**; `avg` divide entre
  los que aportaron, y sin ninguno ⇒ **`null`** (no 0: sería indistinguible de
  «promedio real igual a cero»).
- **500 ante config rota:** `aggregate` fuera del set · `sum`/`avg` sin
  `field` string no vacío · `aggregate` **+ `handler`** (contradicción) ·
  `aggregate` **+ `shape`** (la fila es sintética).

**Gotchas encontrados escribiendo el test primero:**

- `sortItems_([{}], …)` con **un solo ítem** nunca invoca el comparador
  (`Array.prototype.sort` lo salta) ⇒ el 500 «sort mal declarado» no llega a
  lanzar. El test necesita **dos** ítems.
- `10 < 'no-numérico'` compara **números** ⇒ `Number('no-numérico')` = `NaN`
  ⇒ ambos `<` y `>` dan `false` ⇒ empate ⇒ orden no determinado por el
  código. El test de `where+sort+limit` ordena por un campo **texto** limpio
  y deja el orden numérico a `sortItems_` con datos sin `NaN`.

### T2c — M3: `REGISTRY.hooks` 🟡 ✅ **HECHO**

> Sin M3 los eventos se **reportan** con un endpoint declarativo
> (`upload-signature.js`). Con M3 el motor los **emite** → confiables.

- [x] **Test PRIMERO** sobre `24-crud.js` (create/update/delete)
      → `api/__tests__/crud-hooks.spec.js`, **10 tests que fallaban antes**
      del cambio. `24-crud.js` tenía **713 líneas y 0 tests**, así que el
      fichero trae además una **fixture mínima de Sheets** (sólo la
      superficie de `readSheetData_` / `writeRowsBlock_`) y un recurso de
      prueba mínimo — es la primera cobertura del write path completo.
- [x] Nuevo `REGISTRY.hooks` + dispatch post-escritura → `00-registry.js`
      (`hooks: {}`) + `validateHooks_()` + `emitHook_()` en `24-crud.js`,
      **3 validaciones eager** (create/put/delete) y **5 emisiones**
      (create · update-colección · update-singleton · reorder · delete)
- [x] Test de emisión — contexto, orden y aislamiento de errores
- [x] `npm run test:api` verde — **74/74 en 6 ficheros** · `api:check`
      **3/3 VERDE** · `npm test` **91/91** · `ng build` ✓ · prettier ✓

**Contrato decidido:**

- `resource.hooks = { create: […], update: […], delete: […], reorder: […] }`
  → cada nombre debe existir como **función** en `REGISTRY.hooks`.
- **Validación EAGER** (`validateHooks_`, mismo criterio que
  `validateAndThrow_`): config rota ⇒ 500 **antes del lock y antes de
  escribir**. Un nombre malo hace fallar a **todo** el grupo — sin emisión
  parcial.
- **`emitHook_` corre DESPUÉS de `cacheInvalidate_`** para que un hook
  jamás la esquive.
- **Un hook que lanza no deshace ni enmascara la escritura**: el hecho ya
  es irreversible y el hook es _reacción_, no la causa. Se registra en
  `console.error` para no ser silencioso.
- Contexto: `{ ss, resource, action, key, payload, summary }`.

**Gotchas encontrados:**

- **El stub inerte del harness no encadenaba**: `inertStub` devolvía el
  `target` crudo desde los traps, así que `CacheService.getScriptCache()
.put(…)` caía en `undefined is not a function`. Sólo se veía recorriendo
  el write path (único que llama a `cacheInvalidate_`). Los traps ahora
  devuelven **el proxy**; `then` sigue en `undefined` para no romper
  `await`. Se verificó con la suite completa: 74/74, nada roto.
- `dispatchResource_()` llama a `openSpreadsheet_()` (SpreadsheetApp real):
  los tests llaman a `resourceCreate_/resourcePut_/resourceDelete_`
  **directamente**, inyectando el `ss` fake.

---

# PARTE 2 — MOTOR FRONTEND

## 2.1 El protocolo que YA existe: `field-host`

```
src/app/fields/
├── field-host/field-host.ts     ← el despachador
│     :54   SUPPORTED_FIELD_TYPES (Set de 20)
│     :78   isSupportedFieldType()
│     :166  @switch (field().type) → 20 @case
└── text/ number/ date/ select/ … (20 componentes)
```

### T3 — Añadir un tipo de campo nuevo 🔵 — **N/A**

> **Decisión:** no hace falta. La §B4 de `pickpass-viabilidad.md` usa
> los 20 tipos de campo existentes; ningún recurso de PickPass requiere uno nuevo.

- [x] ~~Componente en `src/app/fields/<tipo>/<tipo>.ts`~~ — N/A
- [x] ~~Añadir al `Set` en `field-host.ts:54`~~ — N/A
- [x] ~~Añadir el `@case` en `field-host.ts:166`~~ — N/A
- [x] ~~Tipo en el union de `FieldSchema` (`core/models/schema.model.ts`)~~ — N/A
- [x] ~~Tipo en el back (`api/schema/types/01-types.js:9`)~~ — N/A
- [x] ~~**Actualizar** `form-view.a11y.spec.ts:296` — itera los 20 tipos~~ — N/A
- [x] ~~`npm test` + `npx ng build` + `npm run api:check` verdes~~ — sin cambios que verificar

## 2.2 El despacho por `kind`

```ts
// resource-page/resource-page.ts
:26  @else if (schema.kind === 'collection') { <app-list-view/> }   // ← antes (sólo 2 casos)
     @else                                   { <app-form-view/> }

:26  @switch (schema.kind) {                                        // ← ahora (T4 hecho)
       @case ('collection') { <app-list-view/> }
       @case ('dashboard')  { <app-dashboard/> }
       @default             { <app-form-view/> }   // singleton
     }

// schema.model.ts:339   kind: 'collection' | 'singleton' | 'dashboard';
// shell.routes.ts       YA es genérico para cualquier :id  → NO se toca
```

### T4 — 3er `kind: 'dashboard'` 🔵 — ✅ **HECHO**

- [x] Ampliar el union en `schema.model.ts:339` →
      `'collection' | 'singleton' | 'dashboard'`
- [x] Añadir la rama `@case ('dashboard')` en `resource-page/resource-page.ts`
      — convertido el `@if/@else if` a `@switch (schema.kind)` con `@default`
      (= singleton, conserva el comportamiento anterior exacto)
- [x] Añadir la rama en `hasNoAccess()` — rama explícita `kind === 'dashboard'`
      ⇒ `false`: panel de sólo lectura, `ResourcePermissions` **no tiene `read`**
      (A4: el cliente es interfaz, no autoridad; el acceso real lo decide el endpoint).
      **Sin esta rama**, `{create:false,update:false,remove:false}` (el default
      de un descriptor de panel) caería en el `return` final ⇒ «Sin permisos» siempre.
- [x] Actualizar el spec de `ResourcePage` si existe — **no existe**; sin nada que actualizar
- [x] Crear `src/app/pages/dashboard/dashboard.ts` — el `@case` necesita destino
      (selector `app-dashboard`, clase `Dashboard`, `input.required<ResourceSchema>()`,
      header + `EmptyState` mientras `fields` esté vacío)
- [x] `npm test` **69/69** · `npx ng build` verde · `prettier --check` verde

> **Gotcha registrado:** un comentario HTML dentro del `template:` que mencionaba
> `` `app-widget-host` `` y `` `@for` `` hizo que Angular lo parseara como
> expresión → `TS2304 Cannot find name 'widget'` + cascada `NG8110`/`NG2012`.
> **No poner backticks ni `@` en comentarios del template.**

### T5 — `widget-host`: el despachador de widgets 🔵 — ✅ **HECHO**

> **Decisión de diseño:** replicar el protocolo de `field-host`, no inventar
> uno. Así _añadir un widget_ queda tan declarativo como _añadir un campo_.

- [x] Crear `src/app/widgets/widget-host/widget-host.ts`
- [x] `SUPPORTED_WIDGET_TYPES = new Set<string>()` (espejo de `field-host.ts:54`)
      — hoy `['metric-card', 'bar-chart']`
- [x] `isSupportedWidgetType(type)` (espejo de `:78`)
- [x] `@switch (widget().type)` con un `@case` por widget (espejo de `:166`)
- [x] Union `WidgetSchema` en `core/models/schema.model.ts`
- [x] Spec espejo del contrato de estado vacío — `widget-host.spec.ts` (3 tests)
- [x] `npm test` **87/87** · `npx ng build` verdes

#### ⚠️ Decisión: los widgets van en `widgets`, NO en `fields`

El plan original (y `pickpass-viabilidad.md:283`) decía «los widgets se
declaran como `fields`». **Se probó y no compila**: `FieldSchema` es una unión
cuyos miembros todos extienden `FieldBase` (`required`, `visibleWhen`,
`dependsOn`, `validators`, `default`, `readonly`, `readonlyWhen`), y un widget
no tiene ninguno. Unirlos produjo **18+ errores de tipos en 4 ficheros**
(`seed.ts`, `field-host.ts`, `form-schema.ts`, `form-model.ts`).

**Resolución (elegida):** `ResourceSchema.widgets?: WidgetSchema[]`, aparte.
Un KPI no es un campo. Ventajas colaterales: cero ripple, y `form-schema` /
`seed` quedan **impedidos por tipos** de recibir widgets en vez de depender
del guard en runtime de `field-host`.

> **Consecuencia a vigilar:** `contract-check.mjs` sólo recorre `fields`, así
> que `widgets` **no se compara back↔front**. Es aceptable porque el widget es
> config de UI, no dato almacenado — pero si algún día un widget necesita
> paridad de contrato, hay que ampliar el check.

---

# PARTE 3 — COMPONENTES NUEVOS

## 3.0 Convención de componente (verificada)

> **Esto es lo que hay que seguir al crear CUALQUIER componente nuevo.**

| Regla       | Valor verificado                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Ruta        | `src/app/<ruta>/<nombre>/<nombre>.ts`                                                                |
| **Archivo** | **SIMPLE — no existe `.component.ts` en todo el repo (0)**                                           |
| Selector    | `app-<kebab>` — prefix en `angular.json:14`                                                          |
| Clase       | PascalCase **sin** sufijo `Component` (`EmptyState`, no `EmptyStateComponent`)                       |
| Framework   | Angular **22.2.1** — `standalone:` y `changeDetection:` → **0 ocurrencias** en todo `src/`           |
| Inputs      | `input()` / `input.required()` de signals                                                            |
| Iconos      | `import { LucideCopy } from '@lucide/angular'`                                                       |
| Botones     | `button[app-button]` — `variant`, `type`, `disabled`, `loading`                                      |
| Feedback    | `inject(NotificationService).success('…')` — **ya existe** (`core/services/notification.service.ts`) |
| Barrel      | **No hay** `index.ts` — se importa por path directo                                                  |
| Spec        | Opcional: sólo `drawer` y `modal` lo tienen (2 de 8)                                                 |
| Formato     | `npx prettier --write <fichero>`                                                                     |

### Checklist genérico de creación

- [ ] Crear `src/app/<ruta>/<nombre>/<nombre>.ts`
- [ ] Selector `app-<nombre-kebab>`, clase PascalCase sin sufijo
- [ ] `imports: [<deps>]` — los componentes usados van acá (es standalone)
- [ ] Inputs con `input()` / `input.required()`
- [ ] Importarlo por path en quien lo usa (no hay barrel)
- [ ] `npx prettier --write`
- [ ] `npx ng build` verde
- [ ] (opcional) `<nombre>.spec.ts`

## 3.1 T6 — Componente `copy-share` 🔵 — ✅ **HECHO**

> **Para qué:** botón que copia el enlace del pedido al portapapeles y
> ofrece compartirlo. Es lo que hace útil el `public_base_url` (Etapa 2).

- [x] Crear `src/app/shared/components/copy-share/copy-share.ts`
- [x] Selector `app-copy-share`, clase `CopyShare`
- [x] Inputs: `url` (`input.required<string>()`), `label?`, `shareText?`
- [x] Acción primaria: `navigator.clipboard.writeText(url())`
- [x] Feedback: `inject(NotificationService).success('Enlace copiado.')`
- [x] Acción secundaria: `navigator.share({ url, text })` —
      **guardada con `typeof navigator.share === 'function'`** (no `'share' in navigator`,
      ver nota abajo)
- [x] Fallback `wa.me/?text=` con `shareText` + `url`
      (`shareText` lo rellena Etapa 2 con `share_message_template`)
      — se ofrece **en lugar de** `navigator.share`, no además
- [x] Iconos: `LucideCopy` + `LucideShare` (verificados en `@lucide/angular`)
- [x] Reutilizar `button[app-button]` — **no se creó otro botón**
- [x] **Spec** `copy-share.spec.ts` (4 tests)
  - [x] Copia al portapapeles y dispara `NotificationService.success`
  - [x] `clipboard` inexistente ⇒ no revienta (fallback `textarea` + `execCommand`)
  - [x] `navigator.share` inexistente ⇒ no muestra la acción
  - [x] (extra) `navigator.share` presente ⇒ se delega en la API nativa
- [x] `npx prettier --write` · `npm test` **73/73** · `npx ng build` verdes

> **⚠️ Desviación deliberada del plan:** el plan pedía `if ('share' in navigator)`.
> El operador `in` devuelve `true` también para una **propiedad propia con valor
> `undefined`** (así stubbian los tests y así se comportan algunos polyfills) ⇒
> montaría un botón que revienta al pulsarlo. Se usa
> `typeof navigator.share === 'function'`, que es estrictamente más robusto y
> con el mismo significado en producción.
>
> **Gotcha registrado:** `canShare()` es un `computed` **sin dependencias
> reactivas** (lee `navigator`, que no es señal) ⇒ se evalúa una vez en el
> primer render y se cachea para siempre. En los tests hay que stubbear
> `navigator` **antes** del primer `detectChanges()`.

## 3.2 T7 — Widgets del dashboard 🔵 — ✅ **3 de 3**

### `metric-card` ✅

- [x] Crear `src/app/widgets/metric-card/metric-card.ts`
- [x] Inputs: `label`, `value`, `hint?` — **`icon?` NO** (ver nota)
- [x] **Cero dependencias** — es sólo presentación
- [x] Spec: renderiza `{ label, value }` y estado vacío (`value: null`) + cubre `0` como valor y la presencia/ausencia de `hint` (4 tests)
- [x] `npm test` + `npx ng build` verdes

> **`icon?` descartado a propósito:** el schema no tiene un registro de
> nombres de icono (los Lucide se importan estáticamente), así que un
> `icon?: string` no podría resolverse declarativamente. Se añade cuando
> exista ese registro — meterlo ahora sería un input muerto.

### `bar-chart` (CSS/SVG — ~1 K gz) ✅

- [x] Crear `src/app/widgets/bar-chart/bar-chart.ts`
- [x] Inputs: `label`, `data: { label, value }[]`, `unit?`
- [x] **Sin librería** — barras con CSS (`@for` de Angular)
- [x] Accesibilidad: `role="img"` + `aria-label` con el resumen
      (nº de categorías, mayor y menor)
- [x] Spec: renderiza N barras, maneja `data` vacía, `unit` en el resumen,
      y `0` no divide entre cero (4 tests)
- [x] `npm test` + `npx ng build` verdes

> `label` se añadió a los inputs del plan: sin él la grilla quedaría sin
> título. `height()` devuelve **0 %** para un valor de 0 (no un 2 % mínimo)
> y sólo aplica el mínimo del 2 % a los valores no nulos.

### `chart-line` (Chart.js **detrás de `@defer`**) ✅

> **Decisión tomada:** «Chart.js bajo `@defer`» (elegida por el usuario
> frente a la alternativa CSS/SVG de ~1 K).

- [x] `npm install chart.js` → **4.5.1 en `dependencies`**
- [x] Crear `src/app/widgets/chart-line/chart-line.ts`
- [x] `@defer (on viewport)` — **el bloque vive en `widget-host`, no acá**
- [x] `@placeholder` = **la versión CSS** (polilínea SVG de la misma serie)
- [x] `@loading` = `<app-skeleton>` (ya existe)
- [x] `@error` = mensaje de fallback
- [x] Registrar `chart-line` en `WidgetSchema` (`ChartLineWidget`),
      en `SUPPORTED_WIDGET_TYPES` y como `@case` de `widget-host`
- [x] Spec: `chart-line.spec.ts` (2) + 2 en `widget-host.spec.ts` con
      `DeferBlockBehavior.Manual`, que reproduce **el estado «Chart.js sin
      cargar»** y comprueba que no revienta
- [x] `npm test` **91/91** · `npx ng build` verdes

#### Dónde va el `@defer` y por qué

El `@defer` **no** envuelve el `<canvas>`: envuelve `<app-chart-line>`
dentro de `widget-host`. Sólo así parte el compilador. Las tres condiciones
de angular.dev («Deferred loading with `@defer`»):

1. **Standalone** ✓ — todos los componentes del repo lo son.
2. **Referenciado EXCLUSIVAMENTE dentro del `@defer` en ese fichero** ✓.
3. **Import directo del fichero, nunca por barrel** ✓ — el repo no tiene
   ni un `index.ts`; es la causa nº 1 de que el chunk diferido no se cree.

Resultado: `chart.js` se arrastra **sólo** con `chart-line`, que sólo se
carga desde ese bloque ⇒ fuera del bundle inicial.

#### Medición real (A/B, no estimación)

| Escenario                      | `main` (gz) | `resource-page` (gz) | Total p/ abrir recurso |
| ------------------------------ | ----------: | -------------------: | ---------------------: |
| Baseline (antes de chart-line) |      98.022 |                7.960 |               ~106.000 |
| **Con `@defer`**               | **101.492** |            **7.960** |           **~109.450** |
| A/B sin `@defer`               |      98.024 |               63.339 |               ~161.360 |

- **Chart.js NO está en `main`**: marcadores `LineController`/`chartjs`/
  `CategoryScale` y su string `Serie de ` ⇒ **0** en `main`, `1` en el
  chunk diferido. Ese chunk pesa **55.120 gz**.
- El `main` sí crece **+3.470 gz**, y **el A/B lo prueba**: sin `@defer`
  el `main` vuelve a **98.024 gz** — idéntico al baseline. O sea, el
  crecimiento **no es Chart.js** (ni el placeholder, que vive en el chunk
  de `resource-page`) sino el **runtime de `@defer (on viewport)`**
  (`IntersectionObserver`, que aparece **1** vez en `main` y **0** en
  cualquier otro chunk).
- **Por qué ese +3.470 vale la pena:** sin `@defer`, Chart.js se cuela en
  el chunk de `resource-page`, que descarga **cualquier** página de recurso
  (Productos, Categorías, Sitio, Legal…) aunque no tenga panel. Se pagan
  **55 K de más en cada página de recurso** para ahorrar 3,5 K en el shell.
- Criterio literal «el bundle inicial NO debe crecer» ⇒ **no se cumple
  (+3,5 %)**. Criterio de fondo «Chart.js fuera de la carga inicial» ⇒
  **se cumple**, con un ahorro neto de ~52 K gz al abrir un recurso.

> **Gotcha de test:** jsdom no implementa el lienzo 2D ⇒
> `getContext('2d')` devuelve `null` y Chart.js revienta. El spec stubbea
> el método en `beforeAll` y lo restaura en `afterAll`.

## 3.3 Página `dashboard` 🔵 — ⏳ render listo, fetch pendiente

- [x] Crear `src/app/pages/dashboard/dashboard.ts`
- [x] Selector `app-dashboard`, clase `Dashboard`
- [x] Lee el `kind: 'dashboard'` del schema y **itera su `widgets`**
      (no `fields` — ver la decisión de T5)
- [x] Cada widget → `widget-host` (T5), pasándole `data[widget.key]`
      — el `key` del widget ES la clave en la respuesta del endpoint
- [x] Estado vacío cuando no hay `widgets` declarados
- [ ] **Datos desde `api.send(path, 'GET', { view: '…' })`** —
      **`api.list()` no acepta payload** (`api.service.ts:37`);
      `api.send(path, method, payload)` sí (`:70`).
      **Bloqueado en Etapa 2 (S4):** no existe aún `GET /admin/dashboard`
      ni las vistas de métricas. Hoy `Dashboard` expone un input `data`
      que inyecta el consumidor — es la costura por la que entra el fetch.
- [ ] (opcional) redirect de landing en `app.routes.ts:10`
- [x] Spec con schema sintético + datos fixture — `dashboard.spec.ts` (3 tests)
      incluye **el criterio de salida de la Etapa 1**: «un schema sintético
      declara y dibuja sin errores de render»
- [x] `npm test` **87/87** + `npx ng build` verdes

## 3.4 Lo que NO se recrea ✅

- [x] Confirmar que **no** se duplica ninguno de los 8 existentes:
      `badge` · `button` · `confirm-dialog` · `drawer` · `empty-state` ·
      `modal` · `skeleton` · `toast` — se **reutilizaron**
      `empty-state` (Dashboard) y `button` (copy-share); no se creó ninguno
- [x] Los widgets **componen** estos; no los vuelven a escribir

---

# PARTE 4 — SECUENCIA: renderizador → datos

```
ETAPA 1 — EL RENDERIZADOR                    ETAPA 2 — LOS DATOS
(este doc)                                   (pickpass-plan.md)
─────────────────────────────                ─────────────────────────────
T0  estado previo                            S1  Recurso orders
T1  registros back (token, checks)           S2  Config pickpass
T2  M1 guard (si aplica)          🟡         S3  Vistas de métricas
T3  tipo de campo nuevo (si aplica)          S4  Endpoint dashboard + handler
T4  3er kind: 'dashboard'                    S5  copy-share con datos reales
T5  widget-host                              S6  Endpoint público
T6  copy-share  ← con datos SINTÉTICOS       S7  PIN
T7  widgets metric-card / bar / chart-line   S8  Eventos
     ↓ criterio de salida:                      ↓ criterio de salida:
     un schema sintético declara y               npm run test:api
     dibuja sin errores de render                + api:check + ng build VERDE
```

> **T6/T7 usan datos sintéticos a propósito**: un `metric-card` debe
> dibujarse con `{ label: 'Pendientes', value: 3 }` **antes** de que exista
> `orders`. Si no dibuja con el fixture, el problema es del renderizador —
> no de los datos. Ese es el valor de separar las etapas.

| Bloque      | Tareas  | Toca motor                                     |
| ----------- | ------- | ---------------------------------------------- |
| **Etapa 1** | T0 → T7 | **T2 (M1)** es lo único 🟡 — y es **opcional** |
| **Etapa 2** | S1 → S8 | 🔵 **ninguno nuevo** — M1 ya está hecho en T2  |

---

# PARTE 5 — VERIFICACIÓN

## Por tarea

```bash
# Backend (T1, T2)
npm run test:api        # tests escritos ANTES del cambio
npm run api:check       # paridad back ↔ front

# Frontend (T3–T7)
npm test                # incluye form-view.a11y.spec.ts (contrato de field-host)
npx ng build
npx prettier --check .
```

## Reglas que no se saltan

- [x] **Test antes que cambio** en cualquier 🟡 (A6) — T2 y T1.1 test-first;
      T1.2 quedó ⏸️ deferido a Etapa 2 en vez de implementarse sin test
- [x] **`npm run api:check` VERDE** tras cada fichero nuevo
      (`contract-check.mjs:229` — paridad estricta en ambos sentidos)
- [~] **Actualizar `form-view.a11y.spec.ts:296`** si se añade un tipo de
  campo — **N/A**: T3 no añadió tipos de campo (marcado N/A arriba)
- [x] **No recrear** los 8 componentes compartidos
- [x] **Chart.js sólo bajo `@defer`** — la librería queda fuera de la carga
      inicial ✓ (55.120 gz en el chunk diferido, 0 marcas en `main`).
      **Matiz medido:** el `main` crece +3.470 gz, pero es el **runtime de
      `@defer`** (IntersectionObserver), no Chart.js — verificado por A/B.
      Ver tabla de mediciones en 3.2.
- [x] **Archivo simple** `<nombre>.ts`, nunca `.component.ts`

## Battería de cierre de Etapa 1 — ✅ **VERDE**

- [x] `npm run test:api` → **50/50**
- [x] `npm run api:check` → **VERDE** (4 recursos, 62 campos)
- [x] `npm test` → **91/91** (19 ficheros)
- [x] `npx ng build` → verde (`Initial total` 412,54 kB / 94,33 kB est.)
- [x] `npx prettier --check .` → **los 16 que quedan son preexistentes**,
      ninguno tocado por este trabajo

> ⚠️ `prettier --check .` arranca con **16 ficheros** ya rotos en el repo:
> `api/fixtures/*.json` (9), `api/PLAN.md`, `api/PLAN-MEJORAS.md`,
> `doc/plan.md`, `doc/ui-ux.md`, `.postcssrc.json`, `tsconfig.app.json`,
> `tsconfig.spec.json`. **Intocables** — verificado con `git status` que
> ninguno figura como modificado. Al formatear un `doc/*.md` hay que
> **nombrarlo explícitamente**: `prettier --write doc/*.md` con comodín
> reformateó `doc/plan.md` y `doc/ui-ux.md` y hubo que revertirlos.
