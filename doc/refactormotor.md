# Mejoras a los motores — hacia un sistema 100 % guiado por schemas

> Complementa `doc/motor-de-renderizado-estado-actual.md` (cómo funciona hoy) y
> `doc/plan-motor-de-renderizado.md` (T1.1, T2.4, T2.5…). Aquí se propone **qué
> más hay que construir** y **qué reglas de diseño y nomenclatura** hacen falta
> para que añadir cosas en el futuro no rompa nada ni sea engorroso.
>
> Objetivo: **solo se tocan schemas**. Una pantalla, un campo, un endpoint, un
> CRUD, una acción o un cálculo se crean declarándolos, no escribiendo vistas ni
> handlers sueltos.

---

## 0. Diagnóstico en una tabla

| Hoy | Problema | Mejora |
| --- | --- | --- |
| `FieldHost` y `WidgetHost` con `Set` + imports + `@switch` duplicados | Para añadir un tipo hay que editar el host (3 sitios) | **Registro único** de render (F1) |
| Acciones con `if (type === …)` en cada vista | 3 implementaciones de `copy-share` | **Registro de acciones** (F2) |
| `detail-view` dibuja sus propias celdas | Comportamiento divergente de form | **Modo `display`** en el mismo registro (F3) |
| Front con catálogo estático + back con otro | Dos fuentes de verdad, sincronizadas offline y con huecos | **Separar `data` de `ui`** y generar lo compartido (§5) |
| Back: claves ausentes de headers se descartan en silencio | R1/R2: fallos mudos | **Fail-loud** + `sheet-check` (B4) |
| `checks`, `hooks`, `computed` por nombre pero sin contrato formal | Cada uno se añade "a su manera" | **Registros por categoría** con contrato uniforme (B1) |
| Endpoints: solo ruta + política | No hay input/output declarados | **Endpoints declarativos** con schema de entrada/salida (B2) |
| CRUD fijo (todas las operaciones para todos) | No se puede apagar/ajustar por recurso | **`operations` configurables** (B3) |

---

## 1. Principios de diseño (valen para front y back)

1. **El schema es dato puro.** Serializable a JSON: sin funciones, sin clases.
   La lógica se *referencia por nombre* (`validator: 'unique'`, `computed: 'token'`)
   y vive en un registro.
2. **Abierto a extensión, cerrado a modificación.** Añadir una capacidad =
   **1 archivo nuevo + 1 línea de registro** (idealmente 0 líneas con
   autodescubrimiento). Nunca editar el motor.
3. **Un registro por categoría, con el mismo contrato.** Todas las capacidades
   (tipos de campo, widgets, acciones, validadores, operadores, hooks…) se
   registran igual: `{ id, since, config?, handler }`.
4. **Fail-loud, no fail-silent.** Un tipo, clave o referencia desconocida debe
   romper en **arranque/CI/build**, no ignorarse. (R2 fue exactamente esto.)
5. **Compatibilidad hacia adelante.** Campos desconocidos se toleran y se
   registran como warning; nunca rompen un cliente viejo. Solo se **añade**;
   lo viejo se depreca con aviso, no se borra.
6. **Defaults por capas.** `default del tipo` → `default del recurso` →
   `override del campo`. El schema solo escribe lo que difiere.
7. **Meta-schema.** Los schemas también se validan: cada recurso se comprueba
   contra un esquema de esquemas al cargar (typos, claves inexistentes, tipos
   con config inválida).
8. **Separar qué datos hay de cómo se ven.** El back es dueño de la parte
   `data`; el front, de la parte `ui` (ver §5).
9. **Extensiones con namespace.** Todo lo no estándar va bajo `x-…` o
   `ext.<nombre>` para que nunca choque con claves futuras del núcleo.
10. **Un solo vocabulario, mapeos explícitos.** Si hay varios vocabularios
    (`field.type`, `column.format`, `widget.type`, `action.type`) deben tener
    **tabla de equivalencias declarada**, no coincidencias de nombres.

---

## 2. Nomenclatura y convenciones

### 2.1 Identificadores

| Elemento | Convención | Ejemplos |
| --- | --- | --- |
| **Valor de `type`/`format`/`kind`** (campos, widgets, acciones, vistas) | `kebab-case`, singular, descriptivo | `string-list`, `key-value`, `copy-share`, `metric-card` |
| **Claves de schema** | `camelCase` | `listProjection`, `visibleWhen`, `keyField` |
| **Id de recurso** | `snake_case` o `kebab-case` (elegir **uno**), plural | `orders`, `pickup_slots` |
| **Hojas / columnas** | `snake_case` | `customer_name`, `created_at` |
| **Columnas de grupo** | `<grupo>_<campo>` | `address_street` |
| **Hojas hijas** | `<recurso>_<campo>` | `orders_items` |
| **Namespaces custom** | prefijo `x-` | `x-analytics`, `x-legacy-id` |

### 2.2 Sufijos y prefijos con significado fijo en las claves

| Patrón | Significa | Ejemplos |
| --- | --- | --- |
| `*When` | condición declarativa (booleano) | `visibleWhen`, `readonlyWhen`, `requiredWhen`, `disabledWhen` |
| `*Template` | cadena con `{placeholders}` | `shareTextTemplate`, `routeTemplate` |
| `*Field` / `*Fields` | referencia a **clave de campo** | `titleField`, `summaryFields`, `headerFields` |
| `*Projection` | lista blanca de claves que viajan | `listProjection` |
| `on<Evento>` | enganche a evento nombrado | `onCreate`, `onDelete`, `onStatusChange` |
| `expose*` | visibilidad hacia fuera | `exposeToFront` |
| `*Ref` | referencia a una entrada de un registro | `validatorRef`, `fetcherRef` |

> Regla: **si una clave nueva encaja en un patrón, usa ese patrón.** Así quien
> lea un schema infiere el significado sin consultar documentación.

### 2.3 Archivos y carpetas

| Capa | Convención |
| --- | --- |
| Front, tipo de campo | `fields/field-<type>/field-<type>.ts` |
| Front, widget | `widgets/widget-<type>/widget-<type>.ts` |
| Front, acción | `actions/action-<type>.ts` |
| Front, descriptor | `…/<type>.descriptor.ts` (junto al componente) |
| Back, tipos | `api/schema/types/NN-<categoria>.js` |
| Back, recurso | `api/schema/resources/<id>.js` |
| Back, capacidades | `api/capabilities/<categoria>/<nombre>.js` (`validators/`, `computed/`, `hooks/`, `checks/`, `operators/`) |
| Back, motor | `api/engine/NN-<nombre>.js` (orden numérico = orden de carga) |

### 2.4 Funciones

- Registro: `register<Categoria>(descriptor)` → `registerFieldType`, `registerAction`, `registerValidator`.
- Consulta: `get<Categoria>(id)`; comprobación: `isSupported<Categoria>(id)`.
- Sufijo `_` en privadas del back (ya existe: `storageMap_`) — **mantenerlo**.

---

## 3. Frontend — mejoras

### F1 · Registro único de render (elimina la duplicación Field/Widget)

Hoy `FieldHost` y `WidgetHost` repiten la misma forma. Se reemplaza por un
registro genérico por **categoría de render**:

```ts
type RenderKind = 'field' | 'column-format' | 'widget' | 'action' | 'view' | 'layout';

interface RenderDescriptor<C = unknown> {
  kind: RenderKind;
  type: string;                    // kebab-case, único dentro de su kind
  since: string;                   // versión del contrato en que apareció
  load: () => Promise<Type<any>>;  // lazy: import('./field-text')
  surfaces?: ('form' | 'display' | 'list' | 'filter')[];  // dónde sabe pintarse
  defaults?: Partial<C>;           // config por defecto del tipo
  configSchema?: MetaSchema;       // para validar el schema que lo use
}
```

- Un único `<app-render-host [kind] [type] [config] [ctx]>` basado en
  `NgComponentOutlet` reemplaza a `FieldHost`/`WidgetHost`.
- **Autodescubrimiento**: cada `*.descriptor.ts` se registra con
  `provideRenderDescriptors(...)` o `import.meta.glob`; **no hay `Set` ni lista
  de imports manual**.
- El contexto (`pathPrefix`, errores, `FIELD_ARIA`…) sigue entrando **por DI**
  mediante un `RenderContext` tipado.
- `isSupported(kind, type)` sale del registro; `buildFormSchema` lo usa tal cual
  hoy.

**Resultado:** añadir un tipo de campo = crear la carpeta del componente + su
`descriptor.ts`. Cero ediciones en hosts.

### F2 · Registro de acciones (corresponde a T1.1, ampliado)

```ts
interface ActionDescriptor {
  type: string;                                // 'copy-share', 'navigate', 'trigger'…
  surfaces: ('row' | 'detail' | 'header' | 'bulk' | 'post-create')[];
  run: (ctx: ActionContext, action: ResourceAction) => Promise<ActionResult>;
  confirm?: boolean;                           // usa confirm-dialog (hoy 0 usos)
}
interface ActionContext { record; resource; api; router; toast; user }
```

- Un `ActionService.run(action, ctx)` único; las vistas solo llaman a eso.
- `copy-share` se implementa **una** vez (hoy: 3).
- `trigger` pasa a llamar a una **acción de backend declarada** (ver B3).
- Acciones nuevas candidatas: `open-url`, `download`, `duplicate`, `bulk-update`,
  `print`, `confirm-then-trigger`.

### F3 · `detail-view` sobre el mismo registro (modo `display`)

- Cada descriptor de campo declara si sabe pintarse en `display`; si no, usa un
  `display` por defecto según tipo.
- `detail-view` deja de derivar `kind` a mano (`image|badge|text`) y usa el host
  genérico con `mode="display"`.
- `column.format` se convierte en un **registro propio** (`kind: 'column-format'`)
  en vez de un `@switch` en `list-view`.
- Tabla de **formato por defecto según `field.type`** (declarada, no implícita);
  `column.format` solo existe para sobreescribirla.

### F4 · Vistas como tipos registrables (no solo list/detail/form/dashboard)

Hoy hay cuatro ramas fijas. Pasarlas a registro (`kind: 'view'`):

```
list · detail · form · dashboard   (existentes)
kanban · calendar · tree · timeline · map · wizard   (futuras, sin tocar el shell)
```

- `shell.routes.ts` genera rutas desde `schema.views` por `type`, no por
  suposición.
- Cada recurso declara qué vistas ofrece: `views: [{ type: 'list' }, { type: 'kanban', groupBy: 'status' }]`.

### F5 · Layout declarativo

Registro de layouts (`kind: 'layout'`): `grid`, `tabs`, `sections`, `steps`,
`columns`. Permite que un formulario largo sea tabs o wizard **cambiando una
línea del schema**, sin tocar componentes. `colSpan` y `section` quedan como
casos particulares del layout `grid` / `sections`.

### F6 · Lenguaje de condiciones ampliado

`condition-evaluator` hoy cubre `visibleWhen/readonlyWhen/hiddenOn`. Ampliarlo
a un lenguaje pequeño y **extensible por registro de operadores**:

```ts
{ all: [ { field: 'type', eq: 'delivery' }, { not: { field: 'paid', eq: true } } ] }
{ any: [ … ] }
{ field: 'total', gte: 100 }
{ ref: '$mode', eq: 'create' }     // $mode · $user · $root · $parent
```

Aplicable a: `visibleWhen`, `readonlyWhen`, `requiredWhen`, `disabledWhen`,
`hiddenOn`, y a **acciones** (`visibleWhen` en una acción). Los operadores
(`eq`, `ne`, `in`, `gte`, `matches`, `empty`…) viven en un registro compartido
con el back (B6).

### F7 · Validadores extensibles y compartidos

```ts
validators: [ { name: 'unique' }, { name: 'min-words', args: { max: 80 } } ]
```

- Registro de validadores con **los mismos nombres que el back** (un solo
  vocabulario). `buildFormSchema` los resuelve del registro en vez de un `if`
  por regla.
- Validadores async soportados con *debounce* declarable.

### F8 · Fuentes de datos declaradas (para widgets, relations y selects)

En vez de que cada widget/campo sepa de qué endpoint tirar:

```ts
source: { resource: 'products', view: 'activos', params: { category: '{category}' },
          labelField: 'name', valueField: 'id' }
```

- Registro de *fetchers* + caché por `resource+view+params`.
- Los widgets del dashboard pueden pedir **agregaciones declaradas** (ver B6)
  y dejan de depender de `data[widget.key]` armado a mano por un handler.

### F9 · Degradación controlada y pruebas automáticas

- **Tipo desconocido:** en dev, componente `UnknownRender` con aviso visible;
  en prod, se omite y se loguea. Nunca pantalla rota.
- **Test de contrato** (corre en CI): recorre `registry.ts` entero y verifica
  que cada `type/format/action` existe en su registro, que cada `*Field`
  apunta a un campo real y que cada `config` valida contra su `configSchema`.
- **Galería por tipo** (Storybook o página interna): un caso por descriptor
  generado desde `configSchema` → documentación viva.

### F10 · Otros puntos de extensión útiles

- **Permisos en UI**: `policies` del recurso gobiernan botones, campos y
  acciones (ocultar/solo-lectura) sin código por vista.
- **i18n**: `label`/`help` aceptan clave de traducción (`i18n:orders.status`)
  además de texto.
- **Estados vacíos y de error por recurso**: `emptyState`, `errorState`
  declarativos.
- **Filtros declarados**: `filters: [{ field, control: 'select'|'range'|'search' }]`
  usando el mismo registro de render (`surface: 'filter'`).

---

## 4. Backend — mejoras

### B1 · Registros por categoría con contrato uniforme

Hoy existen `FIELD_TYPES`, `checks`, `hooks`, `computed`, `handlers`, pero cada
uno nació por separado. Unificarlos:

```js
REGISTRY.capabilities = {
  fieldTypes:  { … },   // storage, sheetFormat, validate…
  validators:  { … },   // validación declarativa por nombre
  checks:      { … },   // reglas cross-field / cross-record
  computed:    { … },   // generadores: token, pin, now, slug, sequence, uuid, fromField
  hooks:       { … },   // reacciones post-escritura
  operators:   { … },   // para views/condiciones: eq, in, gte, contains, between…
  handlers:    { … },   // endpoints custom
  adapters:    { … },   // storage (B5)
};
```

Cada entrada: `{ id, since, argsSchema, run }`. Con eso:

- `registerCapability(category, descriptor)` es la **única** puerta de entrada.
- Al cargar se valida que cada referencia en un recurso (`computed: 'token'`,
  `check: 'not-in-sheet'`) exista y que sus `args` cumplan `argsSchema`.
- Nada nuevo se añade tocando `engine/`.

### B2 · Endpoints declarativos completos

Hoy el endpoint declara ruta + `access` + `limits`. Añadir:

```js
REGISTRY.endpoints['/public/pickup-status'] = {
  method: 'GET',
  handler: 'pickupStatus',
  access: 'public',
  limits: { perMinute: 30 },
  input:  { query: { ref: { type: 'text', required: true } } },   // mismo vocabulario de campos
  output: { status: { type: 'select', options: [...] } },
  cache:  { ttl: 60, key: ['ref'] },
  since:  '1.2',
};
```

- **Entrada/salida con el mismo vocabulario `FIELD_TYPES`** → el router valida
  automáticamente antes de llamar al handler y puede validar la salida en dev.
- De ahí se **genera documentación** (OpenAPI-lite) y un contrato para el front.
- Soporte de `method` por ruta (hoy `doGet`/`doPost` separados) y rutas con
  parámetros (`/orders/:id/actions/:name`).
- `fail-closed` se mantiene como default.

### B3 · CRUD configurable por recurso + acciones de dominio

```js
operations: {
  list:    { view: 'default', pageSize: 50 },
  read:    true,
  create:  { computed: [...], hooks: ['onCreate'] },
  update:  { immutable: ['ref', 'created_at'] },
  delete:  { mode: 'soft', activeField: 'active' },   // soft | hard | forbidden
  reorder: false,
  bulk:    { update: ['status'] },
},
actions: {                                             // acciones de dominio en el back
  markDelivered: { from: ['ready'], set: { status: 'delivered' }, hooks: ['onDelivered'] },
  resendPin:     { handler: 'resendPin', access: 'admin' },
}
```

- Cada operación se puede **encender/apagar y tunear**; las no declaradas
  devuelven 405 (fail-closed).
- Las `actions` se publican solas como `POST /admin/<recurso>/:id/actions/<name>`
  y son lo que invoca `action.type: 'trigger'` en el front.
- Máquinas de estado simples: `transitions: { pending: ['ready','cancelled'], … }`
  validadas por el motor (reemplaza `checks` ad hoc tipo `history-append-only`).

### B4 · Fidelidad de escritura y *drift* schema ↔ hoja (cierra R1/R2/T2.5)

- **`rowValues_` no puede descartar en silencio.** Si el payload trae una clave
  que el `storageMap` espera y la hoja no tiene la columna → **error explícito**.
- **`sheet-check`** (arranque + CI): compara `storageMap_` de cada recurso con
  los headers reales y reporta columnas faltantes/sobrantes.
- **`ensureColumns_` opcional** (migración): crea columnas faltantes bajo flag
  explícito, nunca por defecto.
- **La respuesta de `create/update` se construye desde lo escrito + computed**
  (y se relee solo para confirmar), de modo que un campo computado jamás vuelva
  vacío por un fallo de lectura.

### B5 · Capa de storage con adaptadores

Aislar `21-repo` detrás de una interfaz:

```js
adapter = { readAll(sheet), append(sheet,row), update(sheet,key,row),
            remove(sheet,key), query(sheet,where,sort,limit), ensureSchema(map) }
```

- Hoy: adaptador `sheets`. Mañana: `sql`, `firestore`, `memory` (para tests).
- `FIELD_TYPES.storage` ya separa `column | group | child-sheet`; cada adaptador
  decide cómo materializarlo.
- El `adapter: 'sheets'` es una clave del recurso (default global) → un recurso
  puede migrar de almacén sin tocar el resto.

### B6 · Vistas/consultas más potentes + agregaciones

`27-views` hoy: `where/sort/limit/extends`. Ampliar de forma aditiva:

```js
views: {
  pendientes: {
    where:  { all: [ { field: 'status', in: ['pending','ready'] },
                     { field: 'created_at', gte: '{today-7d}' } ] },
    sort:   [ { field: 'created_at', dir: 'desc' } ],
    select: ['ref','customer_name','status','total'],   // proyección por vista
    page:   { size: 50 },
    expand: ['customer'],                                // relaciones
  },
},
aggregates: {
  ventas_por_dia: { fn: 'sum', field: 'total', groupBy: 'day(created_at)', view: 'entregados' },
  pedidos_por_estado: { fn: 'count', groupBy: 'status' },
}
```

- Operadores desde el registro `operators` (compartido con el front, F6).
- **Los `aggregates` alimentan directamente los widgets** (`metric-card`,
  `chart-line`, `bar-chart`) → el handler `dashboard` deja de ser código a mano.
- Paginación por cursor/offset estandarizada en la respuesta
  (`{ items, nextCursor, total? }`).

### B7 · Relaciones e integridad

- `relation` con `expand`/`include` (`?expand=customer`) resuelto por el motor.
- `onDelete: 'restrict' | 'cascade' | 'nullify'` ya existe en espíritu
  (`onDelete`, `dependents`): formalizar los tres modos y validarlos en el
  meta-schema.
- Relaciones inversas declarables (`hasMany`) para listar hijos sin hojas hijas.

### B8 · Políticas más finas

Hoy `access` por endpoint. Ampliar a:

- **Por operación**: `policies: { list: 'staff', delete: 'admin' }`.
- **Por campo**: `field.access: { read: 'staff', write: 'admin' }` (el campo ni
  viaja si no corresponde).
- **Por fila** (`scope`): condición declarativa que filtra qué filas ve cada rol.
- Siempre **fail-closed**; el front consume estas políticas para ocultar UI (F10).

### B9 · Hooks y eventos con contrato

Hoy `hooks` corre *después* de escribir. Formalizar:

```js
hooks: {
  beforeCreate: ['normalizeName'],       // puede modificar/vetar
  afterCreate:  ['hashPin', 'notify'],   // reacción, no causa
  afterUpdate:  [...],
  onStatusChange: { to: 'delivered', run: ['sendReceipt'] },
}
```

- Orden determinista, **idempotentes**, con política de fallo declarada
  (`onError: 'ignore' | 'log' | 'rollback'`).
- Evento interno único (`emitEvent_(name, payload)`) → permite suscripciones
  futuras (webhooks, colas) sin tocar el CRUD.

### B10 · `computed` extensible

`operations.computed` hoy: `token`, `pin`, `now`. Pasarlo a registro con
generadores reutilizables: `slug(from)`, `sequence(prefix)`, `uuid`,
`hash(field)`, `copy(field)`, `now`, `currentUser`, `lookup(resource, field)`.
Cada uno con `argsSchema`. Se declara por operación (`create`/`update`).

### B11 · Validación compartida

- Mismos nombres de validador que el front (F7).
- Mensajes de error con **código estable** (`VALIDATION_REQUIRED`,
  `VALIDATION_UNIQUE`) además del texto → el front mapea por código para i18n.
- `serverErrors[prefix+key]` ya existe; mantener la forma exacta de las claves
  para no romper el mapeo en `FieldHost`.

### B12 · Meta-schema y arranque seguro

`validateRegistry_()` al cargar (y en CI):

- claves desconocidas en un recurso → **error** (detecta typos);
- referencias rotas (`titleField`, `listProjection`, `dependents`, `relation`);
- tipos/ validadores/ computed/ hooks inexistentes;
- `listProjection` ⊇ lo que `listColumns` del front necesita (cierra R6).

### B13 · Versionado y migraciones

- `schemaVersion` global y `since` por capacidad.
- Migraciones declarativas de hoja (`migrations: [{ v: 3, addColumns: [...] }]`)
  ejecutadas por `sheet-check --apply`, nunca implícitas.
- `/admin/schema` incluye `schemaVersion` → el front puede avisar si está
  desfasado.

### B14 · Otras capacidades típicas de un backend (para el futuro)

Todas siguiendo el mismo patrón *declarar → registro → motor*:

| Capacidad | Cómo se declararía |
| --- | --- |
| **Importar/Exportar** CSV/JSON | `operations.import/export: { fields, format }` |
| **Búsqueda** | `search: { fields: ['name','ref'], mode: 'contains' }` |
| **Archivos/uploads** | tipo `file` con `validate: 'origin' \| 'mime' \| 'size'` (como `image`) |
| **Jobs programados** | `schedules: [{ cron, handler, args }]` |
| **Webhooks salientes** | `webhooks: [{ on: 'afterCreate', url, sign }]` |
| **Notificaciones** | `notify: { on, channel: 'email'\|'whatsapp', template }` |
| **Auditoría** | `audit: { fields, retention }` (ya existe; hacerla configurable) |
| **Rate-limit y cache** | ya existen; moverlos al contrato de endpoint (B2) |
| **Idempotencia** | `idempotencyKey` en `create` para evitar duplicados |

---

## 5. Contrato front ↔ back: una sola fuente de verdad

Hoy hay **dos catálogos** (front estático y back `REGISTRY`) vigilados por
`contract-check`, que no compara `enum`, `default`, proyecciones ni columnas
físicas. Propuesta en dos pasos:

### Paso A (corto plazo) — completar la vigilancia
- `contract-check` compara también: `enum`, `default`, `listProjection ⊇ listColumns`,
  `postCreate.summaryFields`, `detail.headerFields` (**T2.4**).
- `sheet-check` para el drift schema↔hoja (**T2.5**, B4).
- Ambos en CI (`npm run api:check`) y bloqueantes.

### Paso B (medio plazo) — separar `data` y `ui`

Cada recurso se parte en dos mitades con dueño claro:

```
DATA  (dueño: back)                 UI  (dueño: front)
─────────────────────               ─────────────────────────
id, kind, keyField, fields[]        listColumns, format, colSpan
type, required, enum, default       layout, sections, widgets
validators, policies, views         labels, help, icons, i18n
operations, actions, aggregates     detail.sections, postCreate
```

- La mitad **DATA** se **genera** para el front desde `/admin/schema` en *build
  time* (codegen → `schemas/*.data.ts`). El runtime sigue siendo estático
  (decisión D1 intacta), pero ya no se escribe dos veces.
- La mitad **UI** la escribe solo el front, referenciando campos de DATA por
  `*Field`; el test de contrato (F9) comprueba que esas referencias existan.
- Con esto `enum`, `required`, `validators` y `default` **no pueden divergir**
  porque solo se definen una vez.

---

## 6. Cómo debería quedar «añadir X» (criterio de éxito)

| Quiero añadir… | Hoy | Objetivo |
| --- | --- | --- |
| Un **tipo de campo** (`color`) | componente + `Set` + import + `@case` + `FIELD_TYPES` back | `field-color/` + `descriptor.ts` · 1 entrada back en `fieldTypes` |
| Un **widget** | componente + `Set` + import + `@case` | `widget-x/` + `descriptor.ts` |
| Una **acción** (`duplicate`) | `if` en list y detail | `actions/action-duplicate.ts` (1 archivo) |
| Un **formato de columna** | `@case` en `list-view` | descriptor `column-format` |
| Un **recurso** nuevo | schema front + schema back + hoja | 1 declaración DATA (back) + 1 UI (front) |
| Un **endpoint** | handler + ruta + política | 1 entrada en `endpoints` con input/output |
| Una **operación de dominio** | handler a medida | 1 entrada en `actions` del recurso |
| Un **validador/computed/hook** | código dentro de `engine/` | 1 archivo en `capabilities/<categoria>/` |
| Una **vista nueva** (kanban) | no existe | descriptor `view` + `views: [{type:'kanban'}]` |
| Un **dashboard** | handler que arma `data[key]` | widgets + `aggregates` declarados |

> **Criterio:** si añadir X obliga a editar `engine/`, `FieldHost`, `WidgetHost`
> o una vista existente, el motor todavía no está terminado.

---

## 7. Reglas para no romper nada al crecer

1. **Solo aditivo.** Nuevas claves/tipos/operaciones nunca cambian el
   significado de las existentes. Lo que se retire se marca `deprecated` y se
   mantiene al menos una versión.
2. **Todo lo nuevo trae `since`** y un **default** que reproduce el
   comportamiento anterior.
3. **El contrato se versiona** (`schemaVersion`); el front avisa si no coincide.
4. **CI bloqueante:** `contract-check` + `sheet-check` + test de registros +
   meta-schema. Si falla, no se despliega.
5. **Un cambio de capacidad = un cambio de registro.** Prohibido añadir `if
   (type === …)` fuera de un registro (revisión de código lo rechaza).
6. **Tests dorados por descriptor:** cada tipo/acción/operador tiene al menos
   un caso mínimo de ejemplo que sirve de documentación y regresión.
7. **Un cambio, un nombre.** Antes de nombrar algo, buscar el patrón en §2; si
   existe, se usa; si no, se añade a la tabla de §2.
8. **Todo error silencioso es un bug** (B4): preferir romper en arranque a
   descartar datos.

### Anti-patrones a evitar

- Lógica de negocio dentro de componentes de vista o de `engine/`.
- Funciones o lambdas dentro de un schema.
- Tipos con el mismo nombre y significados distintos entre front y back.
- Claves booleanas sueltas (`isFoo`, `hasBar`) donde cabe una condición `*When`.
- Handlers a medida para cosas que son un `view`, un `aggregate` o una `action`.
- Rutas, columnas o claves "mágicas" deducidas por convención oculta.

---

## 8. Hoja de ruta sugerida

| Fase | Contenido | Impacto | Esfuerzo | Riesgo |
| --- | --- | --- | --- | --- |
| **1 · Red de seguridad** | B4 (fail-loud + `sheet-check`), B12 (meta-schema), F9 (test de contrato), `contract-check` ampliado | Muy alto | Bajo-medio | Bajo |
| **2 · Registros** | F1 (registro de render), F2 (acciones), B1 (capacidades back) | Muy alto | Medio | Medio |
| **3 · Unificación de ramas** | F3 (detail en `display`), column-format registrable, F7 + B11 (validadores compartidos) | Alto | Medio | Medio |
| **4 · Backend declarativo** | B2 (endpoints con input/output), B3 (CRUD + actions), B9 (hooks), B10 (computed) | Alto | Medio-alto | Medio |
| **5 · Datos declarativos** | B6 (views + aggregates), F8 (fuentes de datos), widgets sin handler | Alto | Alto | Medio |
| **6 · Contrato único** | §5 Paso B (codegen DATA, UI separada), B13 (migraciones) | Alto a largo plazo | Alto | Medio-alto |
| **7 · Expansión** | F4/F5 (vistas y layouts nuevos), B5 (adaptadores), B7/B8, B14 | Según necesidad | Variable | Bajo (ya hay base) |

> Orden recomendado: **1 → 2 → 3** antes de añadir funcionalidad nueva; cada
> fase deja el sistema funcionando y es reversible por separado.

---

## 9. Decisiones abiertas (a resolver antes de la fase 2)

1. **¿Autodescubrimiento o registro manual de una línea?** (autodescubrimiento =
   menos fricción; manual = más explícito y fácil de depurar).
2. **¿`snake_case` o `kebab-case` para ids de recurso?** Elegir uno y fijarlo en
   el meta-schema.
3. **¿El codegen DATA→front es obligatorio o solo advertencia?** (define cuánto
   se acopla el build del front al back).
4. **¿Qué parte del lenguaje de condiciones se comparte literalmente entre
   front y back?** (ideal: mismo paquete/spec de operadores).
5. **¿Hasta dónde llegan los `aggregates` en Sheets?** (límites de rendimiento
   frente a cuándo conviene un adaptador SQL).
6. **Política de deprecación:** cuántas versiones se mantiene un tipo/clave
   marcado `deprecated`.

---

## 10. Resumen en una página

- **Idea:** el schema manda; el motor interpreta; los componentes y handlers
  son piezas enchufables.
- **Mecanismo clave:** **registros por categoría con contrato uniforme**
  (`{ id, since, argsSchema, handler }`) en front **y** back. Añadir = crear un
  archivo, no editar el motor.
- **Front:** un registro de render (`field`, `column-format`, `widget`,
  `action`, `view`, `layout`), un host genérico, detalle en modo `display`,
  acciones centralizadas, condiciones y validadores extensibles, fuentes de
  datos declaradas.
- **Back:** capacidades registradas (validadores, checks, computed, hooks,
  operadores, handlers, adaptadores), endpoints con input/output, CRUD y
  acciones de dominio configurables, vistas con agregaciones, políticas finas,
  fail-loud y meta-schema.
- **Puente:** separar `data` (back) de `ui` (front), generar lo compartido y
  vigilar el resto con `contract-check` + `sheet-check`.
- **Reglas:** aditivo, `since` + defaults, `*When`/`*Template`/`*Field`/`on*`
  como sufijos con significado fijo, `kebab-case` para tipos, `camelCase` para
  claves, `x-` para extensiones, nada de `if (type===…)` fuera de un registro.