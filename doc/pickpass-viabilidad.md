# PickPass — definición e implementación

> Propuesta recibida el 2026-10-04, scope confirmado el mismo día: **dos
> frontends sobre un único backend** (este Apps Script). Cada afirmación
> lleva su archivo; lo que no pudo verificarse queda marcado como tal.

**Cómo leer este documento**

| Parte | Responde                                                        |
| ----- | --------------------------------------------------------------- |
| **A** | _¿Qué es PickPass y qué decidimos?_ — el concepto y las reglas  |
| **B** | _¿Qué se construye, dónde y en qué orden?_ — backend y frontend |
| **C** | _¿Dónde está la evidencia?_ — referencias de código             |

---

# PARTE A — DEFINICIÓN

## A1. Qué es

PickPass autoriza la **recogida de un pedido en el mostrador**: el negocio crea
el pedido, el cliente recibe un enlace con un PIN, y en el mostrador se
comprueba quién puede retirarlo y en qué estado está.

Hay **dos superficies** y un solo backend:

| Superficie                  | Quién la usa | ¿En este repo?                                                 |
| --------------------------- | ------------ | -------------------------------------------------------------- |
| Panel de gestión + métricas | El negocio   | ✅ **Sí.** Es literalmente lo que el panel hace hoy            |
| Página pública con PIN      | El cliente   | ❌ **Otro frontend** — pero **el endpoint va en este backend** |
| Página de solo lectura      | Autorizado   | ❌ **Otro frontend** — misma observación                       |

## A2. Arquitectura

```
                 ┌──────────────────────────────────────────┐
                 │   BACKEND ÚNICO — Apps Script + Sheets   │
                 │   hojas: orders, site_config,             │
                 │          pickpass_config, _pin, _audit_log│
                 │   + REGISTRY.endpoints (datos declarativos)│
                 └────────────┬────────────────┬────────────┘
                              │                │
              token admin     │                │   PIN por pedido
                              │                │
        ┌─────────────────────▼──┐        ┌────▼──────────────────────┐
        │  ESTE PROYECTO (admin) │        │  OTRO FRONTEND (público)  │
        │  crear pedido          │        │  ver pedido sin login     │
        │  validar en entrega    │        │  registrar / cambiar /    │
        │  ver historial         │        │  revocar con PIN          │
        │  dashboard (kind)      │        │  vista del autorizado     │
        │  config (singleton)    │        │                           │
        └────────────────────────┘        └───────────────────────────┘
```

**Lo que esto simplifica:**

- ✅ **Este panel NO necesita lectura pública.** Su `policies.access` se queda en
  `{ read: 'admin', write: 'admin' }` como los otros cuatro recursos.
- ✅ **No hay que inventar permisos por campo.** El frontend público consume un
  **endpoint propio** con un handler que decide qué sale. El patrón ya está
  probado: `handleSchema` (`api/primitives/handlers/schema.js`) y `hiddenList`
  (`api/primitives/handlers/hidden-list.js:18`).
- 🔴 **No se esquiva el PIN.** Ver A5 y B1.5.

## A3. Reglas de negocio → en qué capa vive

| Regla                                        | Capa                                      | Estado                    |
| -------------------------------------------- | ----------------------------------------- | ------------------------- |
| Campos obligatorios, longitudes, formatos    | declarativa (`23-validate`)               | ✅ ya                     |
| `ref` único                                  | `unique`                                  | ✅ ya                     |
| Sólo estados válidos                         | `enum`                                    | ✅ ya                     |
| Foto de referencia (Cloudinary)              | `type: 'image'`                           | ✅ ya                     |
| Orden cronológico / "pendientes de hoy"      | `views` con `where`/`sort`                | ✅ ya                     |
| Trazabilidad de quién cambió qué             | lista hija `history`                      | ✅ sin código nuevo       |
| El anterior queda revocado al autorizar otro | sobrescribir escalar + añadir a `history` | ✅ sin código nuevo       |
| Historial no se borra ni se edita            | **check custom** (capa 2)                 | 🔴 por construir          |
| Pedido entregado → sin nuevas autorizaciones | **check custom** (capa 2)                 | 🔴 por construir          |
| **PIN para editar**                          | **auth + endpoint público**               | 🔴 **bloqueante**         |
| Proyección pública de ciertos campos         | endpoint + handler propio                 | 🟢 patrón ya probado      |
| **Métricas**                                 | `views` / handler / componente front      | 🟢 en alcance, 3 opciones |

### La regla de "revocar al anterior" — por qué es diseño, no código

Un `check` **sólo rechaza, no muta** (`checks.js:3` devuelve
`[{path, message}]`). _"Al autorizar a uno nuevo, el anterior pasa a revocado"_
es una mutación, así que **no cabe en validación**.

La solución no necesita tocar el motor:

```
orders (escalares)                orders.history (lista hija, append-only)
───────────────────               ──────────────────────────────────────
authorized_name   ← el que        [{ at, action, detail }]
authorized_photo    vigente        cambiar = sobrescribir el ESCALAR
auth_state                         + añadir una fila a history
```

"Cambiar de autorizado" deja de ser una transición entre hijos y se vuelve
**sobrescribir el escalar + añadir al historial** — exactamente lo que el CRUD ya
hace sin hooks. El único `check` necesario es el inverso: **prohibir borrar o
editar filas ya existentes de `history`**, comparando `ctx.children` contra
`ctx.current`. Eso sí es validación.

## A4. Decisiones cerradas

| #   | Decisión                                                        | Por qué                                                                                                                                |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Un solo recurso `orders`, no dos**                            | El historial es una lista hija (`type: 'list'`), que vive **dentro** del pedido con la misma clave y ciclo de vida                     |
| 2   | **"Métricas" NO es un schema**                                  | Es derivado. Guardarlo como recurso es estado duplicado que se desincroniza al primer cambio de estado                                 |
| 3   | **`orders` va antes que las métricas**                          | Dependencia lógica, no preferencia: no hay métricas sin pedidos que contar                                                             |
| 4   | **El PIN se valida en este backend**                            | Si lo decide el navegador, un `curl` escribe sin PIN. El frontend es interfaz, no autoridad                                            |
| 5   | **La proyección pública la hace un handler**                    | El handler decide qué sale; así `orders` se queda en `admin/admin` puro                                                                |
| 6   | **El historial de negocio va en `history`, no en `_audit_log`** | `appendAuditRow_` usa `Session.getActiveUser().getEmail()                                                                              |     | 'setup'` (`50-audit.js:12-16`): un cliente sin sesión quedaría como "lo hizo el admin" |
| 7   | **Cambiar autorizado = sobrescribir escalar**                   | Un `check` no puede mutar (`checks.js:3`)                                                                                              |
| 8   | **Los números nunca se guardan**                                | Se derivan en `views` o en un handler; guardarlos es desincronización garantizada                                                      |
| 9   | **URL compartible ≠ autorización**                              | El enlace da acceso a leer; el PIN da acceso a escribir                                                                                |
| 10  | **El dashboard es un `kind` declarativo, no una página fija**   | Toda la UI del admin nace del schema: `registry.ts` es «la ÚNICA fuente de verdad» y `shell.routes.ts` arma las rutas sin tocar código |
| 11  | **Los eventos de uso se reportan con un endpoint declarativo**  | Lo sabe el navegador, no el motor. `REGISTRY.endpoints` + handler ya resuelve; **no hace falta `hooks` en el motor**                   |
| 12  | **La config de PickPass es un singleton propio**                | `site` es config del negocio, no knobs de la app. Singleton nuevo = mismo patrón, cero motor nuevo                                     |
| 13  | **Los eventos de uso nunca son fuente de verdad de estado**     | Son señal de _uso_; el _estado_ lo sigue dando el motor vía `_audit_log`. Mezclarlos convierte las métricas en mentira                 |

### La corrección que evita una trampa: `site` no es "lo que lee el otro frontend"

```js
// site.js         access: { read: 'admin', write: 'admin' }
// endpoints/schema  route: '/admin/schema', access: 'admin'
```

`site` no lo consume el público hoy: es _"los datos del negocio que el admin
administra"_. Si en algún momento el frontend público necesita algo de `site`,
eso es un endpoint de proyección aparte (B1.6) — no meter la config de PickPass
dentro de `site`.

## A5. Riesgos

1. **El PIN es todo el modelo de seguridad** y es la única pieza inexistente.
   No se esquiva poniéndolo en el otro frontend.
2. **El endpoint público es superficie nueva** expuesta a internet: necesita
   rate-limit (`limits` ya son datos declarativos en `REGISTRY.endpoints`,
   `schema/endpoints/schema.js:14-17`) y el PIN **cifrado**, nunca `==` sobre
   texto plano.
3. **`_audit_log` no sirve como evidencia ante reclamos** (A4.6). Sin el
   `history` propio, PickPass pierde justo lo que lo diferencia de WhatsApp.
4. **Sheets como base**: `readSheetData_` recorre la hoja entera para validar
   una FK y para `unique`. Con cientos de pedidos está bien; con miles se nota.
   No es un bloqueo hoy, sí un techo.
5. **Apps Script es el backend de ambos frontends**: un error ahí cae los dos.

## A6. El criterio que gobierna cualquier cambio

> **El schema es el único plano de control.** Si para cambiar el
> comportamiento hay que tocar JS, el DSL falló.

PickPass es la fuerza que lo pone a prueba, pero el criterio no es de
PickPass: vale para todo lo que venga después. La pregunta en cada hueco es
siempre la misma — _**¿se lee lo que quiero en el schema?**_

| Cerrar con…                                             | Cuándo aplica                                                                                  | Coste                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------ |
| **Registro nuevo** (`transforms`, `checks`, `handlers`) | la intención **se lee en el schema**: `transform: 'token'`, `check: 'no-auth-after-delivered'` | **cero** código en `engine/`         |
| **Cláusula nueva** (`aggregate:`, `hooks:`, 3er `kind`) | ni el nombre alcanza para expresar lo que se quiere                                            | toca `engine/` ⇒ **su test primero** |

El motor **ya es de extensión**: cada `REGISTRY.*` es un punto de plugin. Al
registrar una función, el schema ya la usa sin tocar el motor. Por eso el
diagnóstico de C4 no es _"el motor es limitante"_ sino **"los registros están
casi vacíos"**.

**Regla de trabajo:** toda mejora que toque `engine/` nace con su test. El
harness ya existe (`api/__tests__/_harness.js`); `27-views.js` tiene 253
líneas y **cero tests** hoy.

---

# PARTE B — IMPLEMENTACIÓN

## B1. Backend

> **Herramienta:** `npm run test:api` — 29 tests sobre `api/`. Antes de este
> trabajo el backend no tenía **ningún** test (`npm test` sólo cubre `src/`);
> `npm run api:check` sólo verifica reglas estáticas. Toda pieza nueva de
> `api/` se escribe con su test.

| #   | Pieza                                           | Archivos                                                  | Estado       | Bloquea                    |
| --- | ----------------------------------------------- | --------------------------------------------------------- | ------------ | -------------------------- |
| 1   | **Transform `token`** — genera el `ref`         | `api/primitives/transforms.js`                            | 🔴 pendiente | El recurso `orders`        |
| 2   | **Recurso `orders`**                            | `api/schema/resources/orders.js`                          | 🔴 pendiente | Métricas, endpoints, front |
| 3   | **Vistas de métricas** sobre `orders`           | declarativas en `orders.views`                            | ⬜ futuro    | El dashboard               |
| 4   | **Check `history-append-only`**                 | `api/primitives/checks.js`                                | 🔴 pendiente | Historial confiable        |
| 5   | **Check `no-auth-after-delivered`**             | `api/primitives/checks.js`                                | 🔴 pendiente | —                          |
| 6   | **Endpoint público de SOLO LECTURA**            | `api/schema/endpoints/` + `api/primitives/handlers/`      | ⬜ futuro    | El frontend público        |
| 7   | **Hoja `_pin` + endpoint de escritura con PIN** | `api/schema/05-aux-sheets.js` + endpoint + handler + auth | ⬜ futuro    | Escritura pública          |
| 8   | **Singleton `pickpass`** (config de la app)     | `api/schema/resources/pickpass.js`                        | 🔴 pendiente | `copy-share`, dashboard    |
| 9   | **Endpoint `GET /admin/dashboard`**             | `api/schema/endpoints/` + `api/primitives/handlers/`      | ⬜ futuro    | El dashboard               |
| 10  | **Endpoint `POST /admin/events`** (uso)         | `api/schema/endpoints/` + `api/primitives/handlers/`      | ⬜ futuro    | Métricas de adopción       |

### B1.0 Qué NO hay que tocar en el motor

> Verificado con `grep` sobre `api/schema/` + `api/engine/`: **no existe ningún
> hook** (`hook|onSubmit|afterCreate|beforeUpdate|event` → vacío), y
> `REGISTRY` sólo expone `checks, endpoints, enums, handlers, ops, resources,
transforms, types` — `ops` son **operadores de filtro** de `views`
> (`primitives/ops.js:64`), no hooks.

| Se quiere                         | ¿Toca `engine/*`? | Por qué                                                                                                              |
| --------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| Reportar un evento del navegador  | **NO**            | `REGISTRY.endpoints` + handler. Precedente: `upload-signature.js` es un `POST` declarativo con `limits: '10/min'`    |
| Hecho de negocio (crear/entregar) | **NO**            | Ya está: `_audit_log` vía `24-crud.js:706` con `create\|update\|delete\|reorder`                                     |
| Métricas derivadas                | **NO**            | `views` + handler                                                                                                    |
| Config de la app                  | **NO**            | `kind: 'singleton'` ya existe (`site.js:1`)                                                                          |
| Que el back **reaccione solo**    | **SÍ**            | Haría `REGISTRY.hooks` + dispatch en `24-crud`. **No lo necesitamos**: los eventos se _reportan_, no se _reaccionan_ |
| 3er `kind: 'dashboard'`           | **1 línea**       | `02-setup-sheets.js:getSheetSpecs_` empuja `resource.sheet` sin condición → guardar con `if (resource.sheet)`        |

**Esa es la única modificación sobre el setup**, y es un guard, no una pieza
de lógica. El CRUD (`24-crud`), la validación (`23-validate`) y las vistas
(`27-views`) **no se tocan**.

### B1.1 El paso 1 tiene tres piezas que juntas desbloquean todo

```
REGISTRY.transforms.token        api/primitives/transforms.js
        │  fn(valor, params) → string aleatoria
        ▼
resource.operations.create.computed
        │  [{ field: 'ref', transform: 'token', from: 'customer_name' }]
        ▼
api/schema/resources/orders.js   ← el recurso
```

**Dos restricciones verificadas en el código:**

- **`from` es obligatorio.** `24-crud.js:598` tira 500 si `decl.from` no es
  string. Un token aleatorio no se deriva de ningún campo, así que el transform
  **ignora su entrada** y `from` sólo dispara la generación. No se puede usar
  `created_at`: `'now'` se aplica en storage (`24-crud.js:218/303/389`),
  **después** de `preparePayload_`.
- **`ref` NO puede ser `system: true`.** Ver A5-nota abajo.

> ### ⚠️ Nota de diseño — por qué `ref` no es `system`
>
> El primer borrador marcaba `{ key: 'ref', system: true }`. Eso habría hecho
> **imposible crear cualquier pedido**:
>
> ```
> 24-crud.js:583  computeRules_()   → escribe 'ref' en el payload
> 24-crud.js:175  validateAndThrow_ → ve 'ref', pasa required + unique ✓
> 24-crud.js:205  contractToFlat_(map, payload)
>   └ 22-assemble.js:49  if (col.system || col.computed) return;  ← LO DESCARTA
> ```
>
> La fila se escribía **sin `ref`**, con `keyField: 'ref'` roto y sin ningún
> error: validación pasaba y salía basura. Hoy ese descarte está cubierto por
> `api/__tests__/contract-to-flat.spec.js`.

## B2. Frontend (este admin)

| #   | Pieza                             | Archivos                                                                         | Estado       | Coste     |
| --- | --------------------------------- | -------------------------------------------------------------------------------- | ------------ | --------- |
| 1   | **Schema `orders`** + registro    | `src/app/schemas/orders.schema.ts` + `registry.ts`                               | 🔴 pendiente | —         |
| 2   | **3er `kind: 'dashboard'`**       | `schema.model.ts:339` (tipos) + `ResourcePage.ts:26` (rama) + `pages/dashboard/` | ⬜ futuro    | 2 ramas   |
| 3   | **Singleton `pickpass`** front    | `src/app/schemas/pickpass.schema.ts` + `registry.ts`                             | 🔴 pendiente | —         |
| 4   | **Componentes nuevos** (ver B2.1) | `src/app/shared/components/`                                                     | ⬜ futuro    | ver abajo |

**Precondición:** el dashboard está bloqueado en el **paso backend 2** — sin
`orders` no hay filas que contar. Se define con datos reales en pantalla, no en
abstracto.

### B2.0 Por qué el dashboard NO lleva ruta nueva

`shell.routes.ts` ya resuelve **cualquier** `:id` contra el registry:

```ts
{ path: ':id', loadComponent: () => import('../pages/resource-page/resource-page') }
// ResourcePage.ts:26
} @else if (schema.kind === 'collection') { <app-list-view/> }
} @else                              { <app-form-view/> }   // ← falta el 3er caso
```

Al ser el dashboard un `kind`, **se agrega agregando su `*.schema.ts` al
registry** — la misma regla de «agregar recurso no tocar rutas». Lo único que
cambia es una rama en `ResourcePage` y, si querés que sea la landing, el
redirect de `app.routes.ts:10` (`'' → schemas[0].id`) apuntando a `dashboard`.

Los widgets se declaran en el schema, igual que en los otros recursos:
**agregás un widget tocando el schema, no el template**.

> **⚠️ Corregido en ejecución:** este análisis proponía declararlos en
> `fields`. **No compila** — `FieldSchema` exige `FieldBase` (`required`,
> `visibleWhen`, `validators`…) y un widget no lo es; medido, fueron 18+
> errores de tipos en 4 ficheros. Van en `ResourceSchema.widgets?`
> (decisión en `motor-plan.md`, sección T5). La intención de esta frase —
> declarar en el schema, no en el template — se mantiene intacta.

> **A tener en cuenta:** `contract-check.mjs:229` exige que todo id declarado en
> `registry.ts` exista también en `api/schema/resources/`. Por eso el dashboard
> necesita su entrada de back (B1.9) — o vivir fuera de `registry.ts` si se
> decide que es un descriptor aparte.

### B2.1 Los 5 componentes nuevos

| Componente                           | Para qué                                                                                              | Coste                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------- |
| `pages/dashboard/`                   | Orquesta las métricas; necesita **ruta propia** (`app.routes.ts` hoy redirige `''` al primer recurso) | —                          |
| `metric-card/`                       | Cifra suelta: "3 pendientes", "ticket promedio"                                                       | **0**                      |
| `bar-chart/` (CSS/SVG)               | Barras por estado, entregas por día                                                                   | **~1 K gz**                |
| `chart-line/` **detrás de `@defer`** | Serie temporal con tooltip                                                                            | **61,4 K gz bajo demanda** |
| `copy-share/`                        | Enlace + PIN → portapapeles / `navigator.share` / `wa.me`                                             | **0** (APIs nativas)       |

**Ya existen y NO se recrean:** `badge`, `button`, `confirm-dialog`, `drawer`,
`empty-state`, `modal`, `skeleton`, `toast`.

**Sobre Chart.js — medido, no opinado** (método del criterio 439: esbuild
`--minify` + `gzip -9`):

| Escenario                   | gzip       | vs. bundle actual (167,2 K) |
| --------------------------- | ---------- | --------------------------- |
| A. Barras + líneas          | **61,4 K** | **+36,7 %**                 |
| B. + donut                  | 64,7 K     | +38,7 %                     |
| C. `chart.js/auto` (todo)   | 68,5 K     | +41,0 %                     |
| Barras/líneas con CSS o SVG | **~1 K**   | ≈ 0                         |

Para referencia: **las nueve fases de UI/UX completas costaron +13,2 K
comprimido**. Chart.js con lo mínimo son **4,6× ese esfuerzo**. Por eso va
**detrás de `@defer`**, en chunk propio: el bundle inicial no se mueve y el
peso sólo lo paga quien abre el gráfico. Y el `@placeholder` puede ser la
versión CSS, así que hay fallback gratis.

## B3. Frontend público (otro repo)

Fuera de este repositorio. De este lado sólo se le sirve:

- `GET /p/orders/:ref` → proyección pública (B1.6)
- `POST/PUT /p/orders/:ref/…` con `{ ref, pin, … }` → escritura (B1.7)

---

## B4. Especificación: el recurso `orders`

Contrato compartido back ↔ front. La sincronización la valida
`npm run api:check` (`scripts/contract-check.mjs`: paths + required +
validators; hoy compara `['minLength','maxLength','pattern','min','max','unique']`).

> **Los `checks` del back NO los ve el chequeo estático** — sólo aparecen como
> error 422 en runtime.

```js
REGISTRY.resources.orders = {
  id: 'orders',
  kind: 'collection',
  sheet: 'orders',
  keyField: 'ref',
  immutableKey: true, // ref no cambia tras crearse (patrón products.js:11)
  titleField: 'customer_name',
  ordering: 'none', // SÓLO 'none' | 'positioned' (20-storage-map.js:26)
  activeField: null, // orders no tiene campo `active`
  onDelete: 'restrict', // un pedido entregado no se borra (24-crud.js:497)
  dependents: [],
  imageFolder: 'orders', // OBLIGATORIO: hay campos `image` (upload-signature.js:26)
  exposeToFront: true,
  listProjection: ['ref', 'customer_name', 'status', 'pickup_date', 'auth_state'],
  operations: {
    // `from` es OBLIGATORIO (24-crud.js:598): el transform ignora el valor
    // y sólo lo usa como detonante de la generación.
    create: { computed: [{ field: 'ref', transform: 'token', from: 'customer_name' }] },
  },
  checks: [
    { check: 'not-in-sheet', sheet: '_placeholders' },
    // { check: 'no-auth-after-delivered' },  ← POR CONSTRUIR (capa 2)
    // { check: 'history-append-only' },      ← POR CONSTRUIR (capa 2)
  ],
  policies: {
    access: { read: 'admin', write: 'admin' }, // el público va por endpoint propio (A4.5)
    cache: { ttl: 60 },
    audit: true,
    lock: true,
  },
  views: {}, // ← acá viven las métricas (B1.3)
  fields: [
    // SIN `system: true` — ver la nota de A5; lo pone y lo valida el backend
    // en create, y `immutableKey` impide tocarlo después.
    { key: 'ref', type: 'text', required: true, unique: true },
    { key: 'customer_name', type: 'text', required: true, maxLength: 80 },
    { key: 'description', type: 'textarea', required: true, minWords: 3, maxWords: 120 },
    { key: 'pickup_date', type: 'date', required: true },
    {
      key: 'status',
      type: 'select',
      required: true,
      default: 'PENDIENTE',
      enum: ['PENDIENTE', 'ENTREGADO', 'CANCELADO'],
    },
    { key: 'reference_photo', type: 'image' },
    { key: 'customer_notes', type: 'textarea', maxLength: 500 },

    // Autorizado vigente (escalar → cambiar = sobrescribir, A3)
    { key: 'authorized_name', type: 'text', maxLength: 80 },
    { key: 'authorized_photo', type: 'image' },
    { key: 'authorized_notes', type: 'textarea', maxLength: 300 },
    {
      key: 'auth_state',
      type: 'select',
      default: 'NINGUNO',
      enum: ['NINGUNO', 'ACTIVA', 'REVOCADA'],
    },

    { key: 'created_at', type: 'readonly-text', system: true, computed: 'now', format: 'date' },
    { key: 'updated_at', type: 'readonly-text', system: true, computed: 'now', format: 'date' },

    // Historial inmutable (append-only, validado por `history-append-only`)
    {
      key: 'history',
      type: 'list',
      min: 0,
      max: 200,
      itemFields: [
        { key: 'at', type: 'readonly-text', system: true, computed: 'now', format: 'date' },
        {
          key: 'action',
          type: 'select',
          enum: ['PEDIDO_CREADO', 'AUTORIZADO', 'AUTORIZADO_CAMBIADO', 'REVOCADO', 'ENTREGADO'],
        },
        { key: 'detail', type: 'text', maxLength: 120 },
      ],
    },
  ],
};
```

### Piezas auxiliares — **no son recursos del admin**

| Pieza                   | Qué es                                                 | Por qué                                                                                                                    |
| ----------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `_pin`                  | Hoja auxiliar `[ref, pin_hash, created_at, used_at]`   | El PIN **nunca** puede estar en la hoja pública; precedente: `_audit_log`, `_placeholders` (`api/schema/05-aux-sheets.js`) |
| `GET /p/orders/:ref`    | `REGISTRY.endpoints` + handler de proyección           | Lee sin token, devuelve sólo campos públicos (A4.5)                                                                        |
| `POST /p/orders/:ref/…` | `REGISTRY.endpoints` + handler con verificación de PIN | La única superficie de escritura pública (A5.1)                                                                            |
| `metrics`               | **No existe**                                          | Es derivado (A4.2)                                                                                                         |
| `pickpass_config`       | Singleton `pickpass` — knobs internos del admin        | Mismo patrón que `site` (`kind: 'singleton'`, `listProjection: null`)                                                      |
| `GET /admin/dashboard`  | `REGISTRY.endpoints` + handler de agregación           | `views` no agrega (sólo `where`/`sort`/`limit`, `27-views.js:7-13`) → suma/promedio van en el handler                      |
| `POST /admin/events`    | `REGISTRY.endpoints` + handler de eventos              | Precedente `upload-signature.js` (`method`/`access`/`limits` declarativos)                                                 |

## B5. Secuencia

> Orden corregido respecto al planteo original (_"primero las métricas"_): las
> métricas se derivan de los pedidos, así que **`orders` es previo obligatorio**.

| #   | Paso                                | Qué consigo                                                                                                                  | Depende de |
| --- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | **Recurso `orders` + `token`**      | El negocio crea pedidos, anota el autorizado, marca ENTREGADO y lee el historial. **Sustituye el WhatsApp desde el día uno** | —          |
| 2   | **Singleton `pickpass` (config)**   | `public_base_url` y el mensaje de compartir: habilita `copy-share`, que es lo que hace útil el enlace                        | —          |
| 3   | **Vistas de métricas + dashboard**  | 3er `kind` + `GET /admin/dashboard`: números en el panel con widgets declarados                                              | 1, 2       |
| 4   | **Endpoint público de lectura**     | Enlace compartible que le sirve al cliente y al autorizado. **Sin PIN todavía**                                              | 1, 2       |
| 5   | **PIN**                             | Escritura pública protegida. Es el mayor y sólo se justifica si los anteriores confirman que el flujo tiene sentido          | 4          |
| 6   | **Eventos de uso** (`POST /events`) | Trazabilidad de adopción: aperturas del enlace, usos del PIN, botones. **No bloquea nada**                                   | 4          |

**Veredicto:** viable para **validar la idea** empezando por un solo archivo.
No lanzable hasta el paso 5.

> Los pasos 2 y 3 se pueden hacer en paralelo con el 1: ninguno de los dos
> toca `engine/*` y ninguno depende del otro más allá de `orders`.

---

# PARTE C — EVIDENCIA

## C1. Lo que PickPass pide y el modelo ya resuelve

| Qué pide PickPass                                 | Cómo lo resuelve el modelo hoy                                                     | Referencia                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| URL única del pedido                              | `keyField` + `unique`                                                              | `api/schema/resources/legal.js` (campo `ruc`)       |
| Identificador único                               | `unique: true` sobre un campo                                                      | `23-validate.js:65-75`                              |
| Estado del pedido (PENDIENTE/ENTREGADO/CANCELADO) | `type: 'select'` + `enum`                                                          | `23-validate.js:147-155`                            |
| Fecha de entrega                                  | `type: 'date'` (valida `YYYY-MM-DD`)                                               | `23-validate.js:200-204`                            |
| Foto de referencia                                | `type: 'image'` + Cloudinary                                                       | `23-validate.js:186-192`                            |
| Historial de autorizaciones                       | `type: 'list'` (hoja hija, `itemFields`)                                           | `schema/types/01-types.js:36`                       |
| Fechas de creación/modificación                   | `readonly-text` + `system: true` + `computed: 'now'`                               | `legal.js:44-51`                                    |
| Orden cronológico                                 | `views: { sort: [...] }`                                                           | `engine/27-views.js:7-13`                           |
| "Sólo pendientes" / "entregados hoy"              | `views` con `where` sobre el estado                                                | `27-views.js:48-52`                                 |
| Trazabilidad                                      | `policies.audit: true` → `_audit_log`                                              | `api/50-audit.js:1-18`                              |
| Pedido entregado → no se borra                    | `onDelete: 'restrict'`                                                             | `engine/24-crud.js:497`                             |
| Campos inmutables                                 | `immutable: true`                                                                  | `23-validate.js:78-83`                              |
| Proyección pública de una hoja                    | **endpoint + handler propios**                                                     | `schema/endpoints/schema.js`, `handlers/schema.js`  |
| Recurso nuevo                                     | 1 archivo en `schema/resources/<id>.js` + 1 línea en `src/app/schemas/registry.ts` | `api/00-registry.js:12-14`                          |
| Sincronización back ↔ front                       | `npm run api:check`                                                                | `scripts/contract-check.mjs`                        |
| **Página de config**                              | `kind: 'singleton'` → hoja KV + form directo, `listProjection: null`               | `api/schema/resources/site.js:1-6`                  |
| **Datos desde un endpoint**                       | `REGISTRY.endpoints` + `handler` (el router arma request/response)                 | `endpoints/upload-signature.js`, `10-router.js:285` |
| **Evento reportado por el cliente**               | `POST` declarativo con `access` + `limits` como datos                              | `endpoints/upload-signature.js:14` (`'10/min'`)     |
| **Tercer tipo de página**                         | ampliar `kind` + una rama en `ResourcePage`                                        | `ResourcePage.ts:26`                                |

## C2. Límites del motor (por qué no todo es declarativo)

- **`computed` sólo corre al crear** y sólo si el destino viene vacío
  (`24-crud.js:588-605`). No hay derivados en update.
- **Sólo hay un transform registrado: `slugify`.** Por eso falta `token`.
- **No hay agregados.** `views` sólo admite `where`/`sort`/`limit`/`extends`
  (`27-views.js:7-13`).
- **Un `check` sólo rechaza, no muta** (`checks.js:3`).
- **No hay hooks ni eventos.** `grep hook|onSubmit|afterCreate|event` en
  `api/schema/` + `api/engine/` → vacío. `REGISTRY` sólo expone `checks,
endpoints, enums, handlers, ops, resources, transforms, types`; `ops` son
  operadores de filtro de `views` (`primitives/ops.js:64`).
- **No hay acciones custom.** `request.action` no aparece en `10-router.js`
  ni en `24-crud.js`; el único dispatch de acción es
  `appendAuditRow_(_, action, …)` con `create|update|delete|reorder`
  (`24-crud.js:706`).
- **`getSheetSpecs_` empuja `resource.sheet` sin condición**
  (`02-setup-sheets.js:108-114`): todo recurso crea hoja. Es el único punto
  que habría que blindar para un recurso sin storage.
- **`readSheetData_` recorre la hoja entera** para validar FK y `unique`.

## C3. Cómo se verifica

| Comando                | Qué cubre                                                                 |
| ---------------------- | ------------------------------------------------------------------------- |
| `npm run test:api`     | Backend (`api/`): 29 tests — transforms, computeRules_, contractToFlat_   |
| `npm test`             | Frontend (`src/`): 69 tests                                               |
| `npm run api:check`    | 3 reglas estáticas: nombres · registry ↔ ficheros · contract back ↔ front |
| `npx prettier --check` | Formato                                                                   |

## C4. Inventario del DSL contra el criterio (A6)

> **El DSL es muy bueno describiendo _forma_ y muy pobre describiendo
> _comportamiento_.** 20 tipos de campo contra **1** transform y **3** checks.

| Registro / cláusula                                   | Contenido                                                                                                                                                                | Nº     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `FIELD_TYPES` (`schema/types/01-types.js:9`)          | text, textarea, slug, number, currency, boolean, select, multiselect, url, email, phone, date, time, readonly-text, relation, image, group, list, string-list, key-value | **20** |
| `REGISTRY.ops` (`primitives/ops.js:64`)               | eq, neq, in, nin, gt, gte, lt, lte, contains, starts, regex, empty, exists                                                                                               | **13** |
| validators (`23-validate.js`)                         | minLength, maxLength, pattern, min, max, unique, minWords, maxWords                                                                                                      | **8**  |
| `views` (`27-views.js:7-13`, shape en `:162`)         | where, sort, limit, extends, handler, shape                                                                                                                              | **6**  |
| `kind`                                                | collection, singleton                                                                                                                                                    | **2**  |
| `REGISTRY.checks` (`primitives/checks.js:14`)         | pattern, mod11, not-in-sheet                                                                                                                                             | **3**  |
| `REGISTRY.transforms` (`primitives/transforms.js:15`) | slugify                                                                                                                                                                  | **1**  |
| `REGISTRY.handlers` (`handlers/hidden-list.js:18`)    | hiddenList                                                                                                                                                               | **1**  |

### Huecos priorizados

| Quiero…                             | Hoy                                                       | Cómo se cierra (A6)                                         | Prioridad    |
| ----------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------- | ------------ |
| Generar un `ref` único              | ❌ sólo `slugify`                                         | **registro**: `transforms.token`                            | 🔴 paso 1    |
| Reglas de negocio de `orders`       | ⚠️ 3 checks genéricos                                     | **registro**: `checks['history-append-only'`, `…delivered`] | 🔴 paso 1    |
| Métricas agregadas                  | ⚠️ sólo el escape hatch `views.handler` (JS por métrica)  | **cláusula**: `aggregate: 'count'\|'sum'\|'avg'`            | 🟡 paso 3    |
| Un tipo de página nuevo (dashboard) | ❌ 2 kinds; `ResourcePage.ts:26` ramifica sólo en 2       | **cláusula**: 3er `kind` + 1 guard en setup                 | 🟡 paso 3    |
| Config de la app                    | ✅ `kind: 'singleton'` existe (`site.js:1`)               | ya está — sólo declarar el recurso                          | 🟢 inmediato |
| Datos desde un endpoint             | ✅ `REGISTRY.endpoints` + handler                         | ya está                                                     | 🟢 inmediato |
| **Reaccionar a un evento**          | ❌ **no existe**: `grep hook\|afterCreate\|event` → vacío | **cláusula**: `REGISTRY.hooks` + dispatch en `24-crud`      | ⚪ futuro    |
| Widget de panel declarado           | ❌ no existe                                              | **cláusula**: `fields` de tipo widget                       | ⚪ futuro    |

**Lo que esto dice:** los tres huecos 🟢 ya se cierran con lo que hay; los dos
🔴 son sólo registros; **sólo los ⚪ y parte de los 🟡 justifican tocar
`engine/`**, y A6 exige que nazcan con su test.
