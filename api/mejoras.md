# Backend 100% dirigido por esquema — directriz para el agente

## Objetivo

**Esquema = programa. Backend = intérprete.**
Agregar o cambiar un recurso, endpoint, regla o forma de respuesta se hace
**solo editando/agregando archivos en `schema/`**. `core/`, `engine/` y `routes/`
no se tocan por requisitos de dominio.

Patrón: **intérprete + DSL declarativo + registros de primitivas** (convención
sobre configuración). Los registros contienen _primitivas genéricas_
(operadores, transformaciones, tipos), nunca lógica de negocio.

---

## 1. Diagnóstico: dónde hoy aún se escribe código por recurso

| Fuga                                                                    | Dónde                        | Solución                                        |
| ----------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------- |
| Alta de recurso exige 1 línea en registry + fila en `filePushOrder`     | `04-registry`, `.clasp.json` | Auto-registro (§3)                              |
| `EXTRA_ROUTES` fijo en el router                                        | `core/10-router`             | Tabla de rutas **derivada** del schema (§4)     |
| Reglas de dominio como funciones (`publishable`, `featured`, `related`) | `rules/31-catalog-rules`     | Filtros/vistas declarativos (§5)                |
| Validadores de dominio (`ruc-valid`, `slug-from`, `no-placeholders`)    | `rules/32-validators`        | Primitivas genéricas parametrizadas (§6)        |
| Forma de respuesta atada al recurso completo                            | `engine/22-assemble`         | `views`/`shape` declarativos por operación (§7) |
| Permisos y rate-limit fijos (`/admin/*`, 10/min en upload)              | `11-auth`, `40-upload-…`     | `access` y `limits` declarativos (§8)           |

---

## 2. Arquitectura objetivo (3 capas declarativas)

```
schema/
  types/        → tipos de campo (primitivas)            [raro de tocar]
  enums/        → catálogos
  resources/    → UNO por recurso: modelo + endpoints + reglas + vistas + acceso
  endpoints/    → (opcional) endpoints no-CRUD declarados (ej. upload-signature)
engine/         → intérprete genérico (CRUD, queries, orden, lock, caché, audit)
core/           → router, auth, http, props (sin conocimiento de dominio)
primitives/     → operadores, transforms, checks, handlers reutilizables
```

Un `resource` declara **tres bloques**:

1. `model` — campos, tipos, relaciones, hijos, almacenamiento.
2. `operations` — qué endpoints existen y cómo se comportan.
3. `policies` — acceso, límites, caché, auditoría.

---

## 3. Auto-registro (restricción GAS: un scope global, sin `import`)

- `00-registry.js` (primero en `filePushOrder`) declara **solo**:
  `const REGISTRY = { resources: {}, types: {}, enums: {}, endpoints: {}, ops: {}, transforms: {}, checks: {}, handlers: {} };`
- Cada archivo de schema se registra a sí mismo en su top-level
  (asignación a objeto literal, sin ejecutar lógica):
  `REGISTRY.resources.products = { ... };`
- `getResourceSchema(id)` = `REGISTRY.resources[id]`. **Se elimina** el índice manual de `04-registry`.
- `filePushOrder` lista solo: `00-registry`, `primitives/*`, `core/*`, `engine/*`, `setup/*`, `50-audit`.
  Los archivos de `schema/resources/*` van **después** y no se vuelven a listar
  uno a uno (verificar con `clasp push --dry` que clasp los incluye tras los listados;
  si no, dejar un único `schema/_manifest` generado por script `npm run sync-order`).
- Regla: el top-level **solo declara**; toda referencia cruzada se resuelve en runtime.

---

## 4. Rutas derivadas (adiós `EXTRA_ROUTES`)

`resolveRoute_` construye la tabla **una vez por ejecución** recorriendo `REGISTRY`:

- Cada resource → `/{scope}/{id}` y `/{scope}/{id}/{key}` (singleton: sin `key`).
  `scope` y `route` salen del resource (`route: '/admin/products'` solo si se quiere override).
- Cada operación declarada → ruta + método lógico (`list|get|create|update|patch|delete|reorder|<vista>`).
- Cada `endpoints/*` → ruta propia con `handler` nombrado.
- Rutas de introspección automáticas: `/{scope}/schema` y `/{scope}/schema/{id}`.
- El router **nunca** menciona un recurso por nombre.

---

## 5. Operaciones y consultas declarativas

Las "reglas de catálogo" pasan a ser **consultas** interpretadas por el motor:

```js
REGISTRY.resources.products = {
  id: 'products',
  kind: 'collection', // collection | singleton
  scope: 'admin',
  model: {/* fields, children, storage… igual que hoy */},

  operations: {
    list: { projection: 'list', sort: [{ field: 'position', dir: 'asc' }] },
    get: {},
    create: { computed: [{ field: 'slug', transform: 'slugify', from: 'name' }] },
    update: {},
    delete: { guard: [{ ref: 'orders', field: 'product_id', op: 'none' }] },
    reorder: { field: 'position', step: 1000 },
  },

  views: {
    // reemplaza publishable/featured/related/hidden
    publishable: {
      where: [
        { field: 'status', op: 'eq', value: 'published' },
        { field: 'category_id', op: 'in-active', ref: 'categories' }, // fail-closed
      ],
    },
    featured: { extends: 'publishable', sort: [{ field: 'featured_rank', dir: 'asc' }], limit: 6 },
    related: {
      extends: 'publishable',
      where: [
        { field: 'category_id', op: 'eq', from: '$item.category_id' },
        { field: 'id', op: 'neq', from: '$item.id' },
      ],
      limit: 4,
    },
  },

  policies: {
    access: { read: 'public', write: 'admin' },
    cache: { ttl: 300 },
    audit: true,
    limits: { write: '60/min' },
  },
};
```

El motor expone cada `view` como `GET /{scope}/{id}?view=featured` (o ruta propia).
`where` se interpreta con **operadores genéricos** de `primitives/ops`:
`eq neq in nin gt gte lt lte contains starts regex empty in-active exists`.
`from: '$item.x'` / `ref:` cubren contexto y relaciones.

---

## 6. Validación y derivados: solo primitivas parametrizadas

- `checks` (validación) y `transforms` (derivados) viven en `primitives/` y se
  invocan **por nombre + parámetros** desde el schema:
  `{ check: 'pattern', value: '^\\d{11}$' }`, `{ check: 'mod11', weights: [5,4,3,2,7,6,5,4,3,2] }`,
  `{ check: 'not-in-sheet', sheet: '_placeholders' }`, `{ transform: 'slugify', from: 'name' }`.
- `ruc-valid`, `no-placeholders`, `slug-from` dejan de ser archivos de dominio:
  pasan a ser **usos** de primitivas genéricas.
- Escape hatch permitido: `handler: 'nombre'` registrado en `REGISTRY.handlers`,
  **solo** cuando no se pueda expresar con primitivas. Cada uso debe justificarse en un comentario.

---

## 7. Forma de respuesta declarativa

Por operación o vista, `shape` controla la salida sin tocar `12-http`:

```js
shape: {
  pick:   ['id', 'name', 'price'],          // o 'list' | 'full'
  rename: { image_url: 'image' },
  nest:   { address: ['address_street', 'address_city'] },
  include: ['images', 'variants'],          // hijos
  envelope: 'plain'                         // plain | list{items,total} | custom por endpoint
}
```

`12-http` sigue siendo el **único** lugar que envuelve éxito/error (HTTP 200 siempre).
`22-assemble` solo interpreta `shape`; no conoce campos concretos.

---

## 8. Políticas declarativas

- `access`: `public | admin | <rol>` por operación. `11-auth` lee la política; no
  decide por prefijo de ruta.
- `limits`: rate-limit genérico por operación/endpoint (`'10/min'`), implementado una
  vez en `26-lock-cache`. `upload-signature` deja de tener limitador propio.
- `cache`, `audit`, `lock`: flags del resource; el pipeline CRUD ya los aplica.

---

## 9. Endpoints no-CRUD (ej. upload-signature)

Declarados, no cableados:

```js
REGISTRY.endpoints.uploadSignature = {
  route: '/admin/upload-signature',
  method: 'POST',
  access: 'admin',
  limits: '10/min',
  handler: 'cloudinarySign', // único código: la primitiva
  input: { folder: { fixed: 'products' }, formats: { fixed: ['jpg', 'png', 'webp'] } },
};
```

---

## 10. Fases (cada una deja el sistema funcionando)

| #   | Tarea                                                                                         | Criterio de aceptación                                                           |
| --- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| F1  | Crear `00-registry` + auto-registro; migrar los 4 `03-resources-*`; quitar `04-registry`      | Alta de un recurso de prueba = 1 archivo, **0** líneas fuera de `schema/`        |
| F2  | Router con tabla de rutas derivada; mover `EXTRA_ROUTES` a `schema/endpoints/*`               | `10-router` sin nombres de recurso ni de endpoint                                |
| F3  | Intérprete de `where/sort/limit` + `primitives/ops`; migrar `31-catalog-rules` a `views`      | Se borra `31-catalog-rules.js`; mismas respuestas que antes (tests de regresión) |
| F4  | `checks`/`transforms` parametrizados; migrar `32-validators`                                  | Se borra `32-validators.js` o queda solo como primitivas genéricas               |
| F5  | `shape` declarativo en `22-assemble`                                                          | Cambiar la respuesta de un endpoint = editar solo el schema                      |
| F6  | `policies` (`access`, `limits`, `cache`) leídas del schema                                    | `11-auth` y `40-upload` sin rutas ni números hardcodeados                        |
| F7  | `/schema` ampliado (operaciones, vistas, shape) para que el front genere formularios/clientes | El front se genera desde `/schema` sin conocer recursos                          |

---

## 11. Reglas inquebrantables para el agente

1. **Prohibido** mencionar un recurso, campo o ruta concreta en `core/`, `engine/` o `primitives/`.
2. Si algo nuevo requiere código, primero preguntar: _¿es una primitiva genérica reutilizable?_
   Si sí → `primitives/` con parámetros; si no → `handler` nombrado, justificado.
3. Top-level de cada archivo **solo declara** (literales y asignaciones al `REGISTRY`).
4. Se mantienen: envelope único (`12-http`), toda escritura bajo lock, toda traza por `50-audit`,
   acceso a propiedades solo por `13-props`, lecturas/escrituras por rangos.
5. Schema = fuente única: hojas, columnas, validación, rutas, `/schema` y respuestas salen de él.
6. Mantener compatibilidad: cada fase pasa pruebas de regresión del contrato actual antes de avanzar.
7. Actualizar `MAP.md`/`PLAN.md` al terminar cada fase (estructura y contratos, sin código).

## 12. Prueba de éxito final

Agregar `orders` (modelo + `list/get/create` + una vista `pending` + `access` + `shape`)
**solo creando `schema/resources/orders.js`**, correr `setup/03-setup-drift`, y tener
endpoints, validación, auditoría, caché y `/schema` funcionando sin editar ningún otro archivo.
