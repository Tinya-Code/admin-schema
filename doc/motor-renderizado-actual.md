# Motor de renderizado — estado actual

> Documento técnico de **cómo funciona hoy** el motor en frontend y backend.
> No propone cambios: describe el sistema tal como está, con referencias a
> archivo:línea verificables.
>
> El plan de reforma asociado es `doc/plan-motor-de-renderizado.md`.
> Los hallazgos R1–R10 están en `doc/pedidos-rectificacion.md`.

---

## 0. La idea central

Ninguna pantalla está escrita a mano. Existe una **declaración** (el schema),
un **motor** que la interpreta y una **capa de salida** (componentes) que
dibuja lo resuelto.

```
   ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
   │  DECLARACIÓN │   →    │    MOTOR     │   →    │   SALIDA     │
   │   schemas    │        │  resolución  │        │  componentes │
   └──────────────┘        └──────────────┘        └──────────────┘
    ResourceSchema          registros +            FieldHost
    FieldSchema             reglas                 WidgetHost
    WidgetSchema            validación             ListView cells
    ResourceAction                               DetailView cells
```

**Los componentes pertenecen al motor**, no son un catálogo aparte: un
componente sólo existe porque el motor lo selecciona al resolver un `type`.
Describir el motor sin la capa de salida dejaría el proceso a medias; describir
componentes sueltos, sin decir cómo se eligen, sería documentar ruido.

El eje es: **el schema es el único plano de control**. Añadir un recurso, un
campo o un widget no debería requerir escribir una vista.

---

## 1. Frontend

### 1.1 Catálogo: no hay capa remota

| Pieza                | Archivo                               |
| -------------------- | ------------------------------------- |
| Catálogo de recursos | `src/app/schemas/registry.ts`         |
| Contrato de datos    | `src/app/core/models/schema.model.ts` |

`registry.ts` exporta un **array estático** de 7 `ResourceSchema`:
`dashboard, categories, products, orders, pickpass, site, legal`.

```ts
export const schemas: readonly ResourceSchema[] = [dashboardSchema, …];
export function getSchema(id: string): ResourceSchema | undefined { … }
```

> **Hecho importante:** el front **no consume `/admin/schema` en runtime**.
> Lo afirma el propio fichero (`registry.ts:18`) y lo confirma el handler back
> (`api/primitives/handlers/schema.js`: «El admin NO lo consume en runtime»).

No hay `SchemaService` que descargue definiciones ni merge en memoria. El
catálogo del front es la fuente de verdad **en ejecución**; la sincronización
con el back es **offline**, vía `scripts/contract-check.mjs` (§3).

Consecuencia práctica: el menú lateral y las rutas se resuelven contra este
array en compilación (`shell.routes.ts:16` genera las rutas a partir de él).

### 1.2 Los cuatro vocabularios de render

Este es el punto que más confunde al leer el sistema por primera vez. Hay
**cuatro lenguajes distintos** y no son intercambiables:

| Vocabulario         | Dónde se declara                      | Dónde se resuelve    | N.º |
| ------------------- | ------------------------------------- | -------------------- | --- |
| **`field.type`**    | `ResourceSchema.fields[].type`        | `FieldHost`          | 20  |
| **`column.format`** | `ResourceSchema.listColumns[].format` | `list-view` (`:259`) | 7   |
| **`widget.type`**   | `ResourceSchema.widgets[].type`       | `WidgetHost`         | 6   |
| **`action.type`**   | `ResourceSchema.actions[].type`       | **sin registro**     | 3   |

Más una **quinta** superficie en el detalle: `field.kind`
(`image` | `badge` | `text`), que `detail-view` deriva del campo y resuelve en
su propia plantilla.

`column.format` y `field.type` **no coinciden a propósito**: un `select`
puede renderizar como `badge`, un `image` como `thumbnail`, un `boolean` como
`boolean`. El formato es una **decisión de presentación de tabla**, no del
campo.

### 1.3 Rama de formulario

Es la rama más elaborada y la que concentra el motor.

```
ResourceSchema
   │
   ├─► buildFormSchema(schema, api, excludeKey?)   form-view/form-schema.ts
   │        │  barrido recursivo de schema.fields
   │        ▼
   │   SchemaFn<Record<string, unknown>>  ──► Signal Forms (Angular)
   │
   └─► <app-field-host [field] [tree] …>            form-view / drawer-form
             │
             ▼
        label + @switch(field().type) ──► 20 componentes Field*
```

#### `buildFormSchema` — las reglas

`src/app/pages/form-view/form-schema.ts`

- Firma: `buildFormSchema(schema, api, excludeKey?)` → `SchemaFn` con el path
  **raíz**.
- El barrido es **recursivo**: un `group` registra las reglas de sus hijos
  bajo su propia ruta; un `list` usa `applyEach` para que las reglas corran
  también sobre ítems agregados después.
- **Reglas generadas:** `required`, `min`/`max`, `minLength`/`maxLength`,
  `pattern`, `email`, `readonly`, `hidden`, `unique` (asíncrona: consulta el
  listado del recurso y descarta el propio registro), `validateMaxWords`.
- **Condiciones:** `visibleWhen` / `readonlyWhen` / `hiddenOn` se evalúan con
  `shared/utils/condition-evaluator.evaluateCondition()` contra `root` o
  `container` («mismo nivel o registro raíz»).
- **Salvaguarda:** sólo genera reglas para tipos con
  `isSupportedFieldType(type) === true`. Un campo no editable con `required`
  bloquearía el guardado para siempre.

#### `field-node` — el árbol de paths

`src/app/fields/field-node.ts`

El modelo de formulario es `Record<string, unknown>` (tipado dinámico), así
que el acceso se centraliza aquí: `childTree`, `groupTree`, `itemTree`.
También define `ListChildContext` (`fields`, `tree`, `prefix`, `errors`,
`exists`) — el contexto que recibe el `ng-template` de un `list`.

#### `FieldHost` — el despachador

`src/app/fields/field-host/field-host.ts` — **431 líneas**. Es el corazón de
la rama.

```ts
const SUPPORTED_FIELD_TYPES = new Set<string>([
  'text', 'textarea', 'slug', 'number', 'currency', 'boolean', 'select',
  'multiselect', 'url', 'email', 'phone', 'date', 'time', 'readonly-text',
  'group', 'list', 'string-list', 'key-value', 'relation', 'image',
]);                                                        // 20

export function isSupportedFieldType(type: string): boolean { … }
```

Su estructura tiene cinco responsabilidades:

| Responsabilidad           | Cómo                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| **Selección**             | `@switch (field().type)` → 20 `@case`, cada uno instanciando su `Field*`                         |
| **Envoltorio común**      | `<label [for]="state().name()">`, marca `*` required, «(opcional)», `data-field`, `colSpanClass` |
| **Errores**               | `serverErrors[prefix + key]` — backend sin esperar al foco; propio, al perder el foco            |
| **DI en vez de inputs**   | `providers: [{ provide: FIELD_ARIA, useExisting: forwardRef(() => FieldHost) }]`                 |
| **Composición recursiva** | `group` y `list` reinvocan al propio host vía `ngTemplateOutlet` (`#groupContent`, `#childTpl`)  |

Puntos no obvios:

- **Auto-import**: el componente se importa a sí mismo en `imports` para poder
  instanciar `app-field-host` dentro de su propio template. Patrón verificado,
  sin error `ɵcmp`.
- **`pathPrefix`** encadena el prefijo del contenedor (`address.`, `faq[2].`)
  para mapear errores anidados.
- Los 21 elementos de `imports` están **a mano** (los 20 tipos + él mismo).
- El contexto llega a los controles **por DI**, no por inputs — pasarle inputs
  sería repetirlo 20 veces.

**Consumidores:** `form-view.ts:206, 259, 349` y `drawer-form.ts:62`.

### 1.4 Rama de lista

`src/app/pages/list-view/list-view.ts`

```
schema.listColumns ──► @for (column) ──► @switch (column.format ?? 'text')
                                              │
                    thumbnail │ boolean │ badge │ number │ currency │ date │ text
```

- **7 formatos**, no 20 — la tabla resuelve **presentación**, no tipos.
- `cellValue(row, column)` + `formatNumber/Currency/Date` para la salida.
- Los booleanos usan `field.trueLabel` / `field.falseLabel` con fallback
  «Sí»/«No» (`:799-800`).
- **Búsqueda y filtros en el cliente** (`:77`) — la fila ya viene filtrada del
  back por la vista, el resto se filtra en memoria.
- **Acciones sin registro:** `@if (action.type === 'copy-share')` en `:333` y
  `runAction()` con `if (action.type === 'copy-share')` en `:714`.

> **Dependencia crítica:** `shareTextTemplate` se interpola sobre la **fila
> proyectada** (`:713`), no sobre el registro completo. Si una clave no está
> en `listProjection`, sale en blanco. Es el mecanismo del hallazgo R1.

### 1.5 Rama de detalle

`src/app/pages/detail-view/detail-view.ts`

**No usa `FieldHost`.** Dibuja sus propias celdas.

1. `sections()` (`:375`) — si el schema declara `detail.sections`, las usa
   tal cual; si no, arma secciones desde `schema.layout.sections` agrupando
   por `field.section`, con las que no tengan sección en `_unsectioned`.
2. `resolveFieldValue(key)` — `getValue(rec, key)` + `formatValue(field, raw)`
   y **deriva `kind`**: `image` | `badge` | `text`.
3. La plantilla hace `@if (field.kind === 'image') … @else if (kind ===
'badge') … @else …` sobre `<dl>/<dt>/<dd>` (`:223-250`).
4. `copyShareActions` (`:408`) filtra `schema.actions` por
   `type === 'copy-share'`.

Secciones con listas anidadas (timeline de eventos, items) se renderizan aparte
(`:261`).

### 1.6 Rama de dashboard

```
schema.widgets ──► dashboard.ts (84 líneas) ──► <app-widget-host [widget] [data]>
                                                        │
                                                 WidgetHost (@switch)
```

- `dashboard.ts:75` → `widgets = schema.widgets ?? []`.
- `datum(widget)` (`:82`): `source === 'payload'` devuelve **toda** la
  respuesta; `'key'` (default) devuelve `data[widget.key]`, con `null`
  explícito cuando la clave no vino.
- El orquestador espera `data[key]` — el `key` del widget **es** la clave de su
  dato en la respuesta.

**`WidgetHost`** (`src/app/widgets/widget-host/widget-host.ts`) tiene
exactamente la misma forma que `FieldHost`:

```ts
const SUPPORTED_WIDGET_TYPES = new Set<string>([
  'metric-card',
  'bar-chart',
  'chart-line',
  'record-list',
  'quick-actions',
  'status-progress',
]); // 6
```

- 6 imports manuales + `@switch` de 6 `@case`.
- `isSupportedWidgetType()` — **sí existe**, análogo al de campos.
- Fallback explícito: `<app-skeleton>`.
- `gridSpanClass()` para la grilla de 12 columnas.
- `chart-line` usa `@defer (on viewport)` con placeholder SVG inline.

**Implementados pero no declarados:** `bar-chart` y `chart-line` no aparecen
en ningún schema (decisión D5).

### 1.7 Acciones — el caso sin motor

`src/app/core/models/schema.model.ts:425-445`

```ts
ResourceActionBase; // base
CopyShareAction; // type: 'copy-share'  → template, urlTemplate, shareTextTemplate
NavigateAction; // type: 'navigate'    → routeTemplate
TriggerAction; // type: 'trigger'
```

Hay **tres tipos declarados y ninguna resolución centralizada**:

| Acción       | Implementaciones | Ubicaciones                                                      |
| ------------ | ---------------- | ---------------------------------------------------------------- |
| `copy-share` | **3**            | `list-view.ts:714`, `detail-view.ts:408`, `post-create-modal.ts` |
| `navigate`   | ad hoc           | `list-view.ts`, `detail-view.ts`                                 |
| `trigger`    | ad hoc           | —                                                                |

Es la única superficie del motor que hoy se resuelve con `if` sueltos en cada
vista. Ver T1.1 del plan.

### 1.8 Lo que el schema controla en el formulario

| Declaración                           | Efecto                                      | Dónde se evalúa                       |
| ------------------------------------- | ------------------------------------------- | ------------------------------------- |
| `visibleWhen`                         | muestra/oculta + aplica clase `field-enter` | `condition-evaluator` + `form-schema` |
| `readonlyWhen`                        | `readonly()` de Signal Forms                | `form-schema`                         |
| `hiddenOn` (`create`/`edit`/`always`) | descarta la ruta según el modo              | `modeAppliesTo()` en `form-schema`    |
| `required`, `pattern`, rangos         | reglas de Signal Forms                      | `form-schema`                         |
| `unique`                              | consulta async al listado                   | `form-schema` + `ApiService`          |
| `colSpan`                             | `colSpanClass()`                            | `field-host`                          |
| `section`, `layout.sections`          | agrupación en detalle                       | `detail-view`                         |

---

## 2. Backend

### 2.1 Catálogo de tipos — el puente al almacenamiento

`api/schema/types/01-types.js`

```js
var FIELD_TYPES = {
  text:        { storage: 'column',      sheetFormat: 'text' },
  boolean:     { storage: 'column',      sheetFormat: 'checkbox' },
  image:       { storage: 'column',      sheetFormat: 'text',
                 validate: 'cloudinary-origin' },
  relation:    { storage: 'column', fk: true, sheetFormat: 'text' },
  group:       { storage: 'group' },
  list:        { storage: 'child-sheet' },
  'string-list': { storage: 'child-sheet', valueColumn: true },
  'key-value':   { storage: 'child-sheet', kv: true },
  …                                    // 20 en total
};
REGISTRY.types.fieldTypes = FIELD_TYPES;
```

- **Vocabulario idéntico al front** (20 tipos) — esa es la sincronización
  _semántica_; la _estructural_ la hace `contract-check`.
- Añade lo que el front no necesita: `storage`
  (`column` | `group` | `child-sheet`), `sheetFormat`, `fk`, `validate`,
  `valueColumn`, `kv`.
- **Sólo declaraciones** al cargar — cero referencias a otros archivos.

> **Regla de oro del back** (`20-storage-map.js:1`): _«agregar un campo no
> requiere tocar código»_.

### 2.2 Declaración de recurso

`api/schema/resources/<id>.js` → `REGISTRY.resources.<id>`

Campos principales (ejemplo real `orders.js`):

| Clave                                   | Rol                                                     |
| --------------------------------------- | ------------------------------------------------------- |
| `id`, `kind`, `sheet`, `keyField`       | identidad y storage                                     |
| `titleField`, `ordering`, `activeField` | presentación y orden                                    |
| `onDelete`, `dependents`                | integridad referencial                                  |
| **`exposeToFront`**                     | ¿viaja en `/admin/schema`?                              |
| **`listProjection`**                    | ¿qué claves llegan al listado?                          |
| `operations.computed`                   | transformaciones en create (`token`, `pin`)             |
| `fields[]`                              | catálogo de campos (el mismo vocabulario `FIELD_TYPES`) |
| `views`, `policies`, `checks`, `hooks`  | consultas, acceso, validación, reacción                 |
| `route`, `scope`                        | override de ruta (default `/<scope or admin>/<id>`)     |

### 2.3 Router — tabla derivada, no cableada

`api/core/10-router.js`

La tabla de rutas se **construye en runtime** a partir de las declaraciones:

1. **`REGISTRY.endpoints`** → `exact[route]` o `keyed[prefix]` con
   `kind: 'handler'` y su política (`access`, `limits`).
2. **`REGISTRY.resources`** → la ruta sale de

   ```js
   function resourceRoute_(resource) {
     return resource.route || '/' + (resource.scope || 'admin') + '/' + resource.id;
   }
   ```

   **Fuente única**: la tabla de despacho y la proyección pública de
   `/admin/schema` derivan de esta misma función, así que el front nunca
   recibe una ruta que el router no sepa resolver.

3. **`sheet: null` se salta** — un descriptor sin storage no publica ruta.
   Es lo que impide que `dashboard` (hoja `null`) pise al endpoint homónimo.

Después: `doGet`/`doPost` (`:153`, `:163`) → match →
`kind: 'handler'` → `REGISTRY.handlers[name]` ·
`kind: 'resource'` → `engine/24-crud`.

**Políticas:** el router sólo _normaliza_ lo declarado; el significado lo dan
`11-auth` (nivel de acceso) y `26-lock-cache` (rate-limit). Sin declaración ⇒
**fail-closed** (`admin`, sin límite).

### 2.4 Cadena de datos

`api/engine/` — módulos en orden numérico:

```
20-storage-map   schema → columnas/hojas hijas   (memoizado por recurso)
21-repo          lectura/escritura de filas
22-assemble      filas → contrato (inverso de contractToFlat_)
23-validate      validación declarativa + checks
24-crud          orquestación de operaciones
25-ordering      posicionamiento
26-lock-cache    locks + rate-limit + cache
27-views         vistas (where/sort/limit/extends)
```

**`storageMap_(resource)`** — una sola pasada del schema:

| `meta.storage`       | Resolución                                                            |
| -------------------- | --------------------------------------------------------------------- |
| `column`             | columna directa; un `group` → columnas con prefijo (`address_street`) |
| `group` en singleton | fila KV con clave aplanada                                            |
| `child-sheet`        | hoja hija con `fk` y `position` (`list`, `string-list`, `key-value`)  |

**Flujo de `POST` (create)** — `24-crud.js:195-235`:

```
preparePayload_          aplica operations.computed (token, pin) si isNew
   │
storageMap_(resource)    cómo se persiste
   │
validateAndThrow_        declarativo + checks (isNew: true)
   │
rowValues_(data.headers, contractToFlat_(map, payload))
   │                     ⚠️ itera los HEADERS DE LA HOJA, no el payload
appendRow_               + posición + computed: 'now'
   │
writeChildren_           hijos en lote
   │
auditWrite_ → cacheInvalidate_ → emitHook_
   │
shapeResponse_ ← readDetail_  ⚠️ RELEE la hoja, no devuelve lo escrito
```

> **Dos flechas marcadas con ⚠️ son el hallazgo R2/R1.** Una clave ausente de
> los headers se descarta en silencio, y la respuesta se forma releyendo la
> hoja — por eso `pin` volvía vacío cuando la columna no existía.

### 2.5 Proyecciones

| Mecanismo                | Qué controla                        | Quién lo consume                                            |
| ------------------------ | ----------------------------------- | ----------------------------------------------------------- |
| `listProjection`         | claves que viajan al listado        | `list-view` (interpola `shareTextTemplate` sobre esta fila) |
| `projectResourceSchema_` | claves que viaja en `/admin/schema` | **nadie en runtime**                                        |
| registro completo        | detail y modal de alta              | `detail-view`, `post-create-modal`                          |

### 2.6 Exposición `exposeToFront`

`api/primitives/handlers/schema.js` — `handleSchema()`

```js
Object.keys(REGISTRY.resources).forEach(function (id) {
  var resource = getResourceSchema(id);
  if (resource === null || resource.exposeToFront !== true) return;
  resources[id] = projectResourceSchema_(resource);
});
```

**Lista blanca** — lo que no se nombra no viaja:

```
id, kind, keyField, titleField, ordering, listProjection,
operations, views, policies, fields
```

Nunca viajan: hojas, columnas internas, reglas, `cache`, `audit`, `lock`,
`limits`, ni el token de firma. Para imágenes sólo el tipo `image`.

**Su rol declarado (D1):** contrato legible para inspección, debug y clientes
futuros. **El admin no lo consume en runtime.**

### 2.7 Reglas computadas, checks y hooks

| Mecanismo             | Ejemplo (`orders`)                                       | Cuándo corre                                 |
| --------------------- | -------------------------------------------------------- | -------------------------------------------- |
| `operations.computed` | `ref ← token(customer_name)`, `pin ← pin(customer_name)` | `preparePayload_`, sólo con `isNew: true`    |
| `checks`              | `not-in-sheet`, `history-append-only`                    | en la validación, junto a los declarativos   |
| `hooks`               | hash del PIN en `_pin`                                   | **después** de escribir — reacción, no causa |
| `views`               | `pendientes`, `entregados`, `pendientes_recientes`       | `27-views`, sobre ítems ya proyectados       |

---

## 3. Cómo se sincronizan los dos motores

**No hay runtime compartido.** La alianza se sostiene en tres puntos:

```
  FRONT (runtime)                     BACK (runtime)
  schemas/*.schema.ts    ←──┬──→     REGISTRY.resources.*
                            │
                  contract-check.mjs        ← offline, CI
                  npm run api:check
```

`scripts/contract-check.mjs` compara hoy, por recurso:

- que el recurso back tenga schema front y viceversa
- `kind`, `endpoint`, `required`, `validators`

**Lo que NO compara** (hueco R6 → T2.4): `enum`, `default`,
`listProjection` ⊇ `listColumns`, `postCreate.summaryFields`,
`detail.headerFields`.

**Un cuarto punto que no existe:** nada verifica que las columnas físicas de
la hoja coincidan con los `fields` del recurso. Ese fue el hueco por el que
entró R1 → T2.5.

---

## 4. Dónde vive lo específico hoy

Mapa honesto de las superficies que rompen el principio «nada específico de un
schema»:

| Superficie                | Situación                               | Gravedad                      |
| ------------------------- | --------------------------------------- | ----------------------------- |
| `FieldHost`               | `Set` + 21 imports a mano + `@switch`   | acoplamiento, pero genérico   |
| `WidgetHost`              | **misma forma duplicada**               | duplicación de patrón         |
| Acciones                  | **sin registro**, 3 implementaciones    | dispersión                    |
| `list-view`               | `@switch` de formatos + acciones `if`   | dispersión                    |
| `detail-view`             | render propio, no reutiliza `FieldHost` | divergencia de comportamiento |
| `confirm-dialog`          | 0 usos                                  | deuda                         |
| `bar-chart`, `chart-line` | implementados, sin declarar             | deuda                         |

**Los componentes** de `shared/components/` son genéricos y no referencian
schemas; el problema no está en ellos sino en **cómo se llega hasta ellos**:
cuatro formas distintas de resolver `type → componente` en vez de una.

---

## 5. Resumen en una página

**Front** — `registry.ts` (7 schemas, estático) → cuatro vocabularios de
resolución:

- **form**: `buildFormSchema` → Signal Forms → `FieldHost` (`@switch` de 20)
- **lista**: `list-view` (`@switch` de 7 formatos)
- **detalle**: `detail-view` (secciones + `kind` de 3)
- **dashboard**: `WidgetHost` (`@switch` de 6)

**Back** — `FIELD_TYPES` (20, mismo vocabulario) → `REGISTRY.resources` →
`10-router` (tabla derivada) → `24-crud` → `storage-map` → `21-repo` →
`23-validate` → `shapeResponse_` releyendo la hoja.

**Puente** — `contract-check.mjs` offline; `/admin/schema` es contrato
legible, no runtime.

**Deuda** — `Set`/`@switch` duplicados entre `FieldHost` y `WidgetHost`,
acciones sin registro, `detail-view` fuera del patrón, y dos verificaciones
que no existen (`enum`/`default`/proyecciones y drift schema↔hoja).
