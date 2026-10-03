# Guía de uso — backend (GAS) ↔ frontend (Angular)

> **Autoridad técnica:** [`doc/baseapi.md`](baseapi.md) · **Estructura del
> backend:** [`api/MAPA.md`](../api/MAPA.md) · **Mejoras ejecutadas:**
> [`api/PLAN-MEJORAS.md`](../api/PLAN-MEJORAS.md) (F0–F7 + P, cerradas).
>
> **Estado actual:** deploy **v17** · 4 recursos (`categories`, `products`,
> `site`, `legal`) · regresión 11/11 · `npm run api:check` en verde.

---

## 0. La idea en una frase

El backend es **Google Apps Script dirigido por esquema**: toda la
información de un recurso (campos, validaciones, rutas, políticas, forma de
la respuesta) vive en **un solo archivo** declarativo
(`api/schema/resources/<id>.js`). El motor (`core/` + `engine/`) es
genérico: **agregar un recurso o un campo no requiere tocar código**.

El frontend (Angular 22) **no conoce recursos hardcoded**: al arrancar lee
`/admin/schema` (proyección pública del esquema) y arma menú, tabla y
formularios a partir de esa metadata, fusionándola con los esquemas locales
cuando existen.

```
┌────────────────── Angular — src/app ──────────────────┐   ┌──────────── GAS — api/ ────────────┐
│                                                       │   │                                    │
│ sidebar ← allSchemas() ← registry (merge local+remoto)│   │ 12-http (auth/parse)               │
│                                                       │   │   ↓                                │
│ RemoteResource ── api.service ── POST envelope ───────┼──▶│ 10-router ← REGISTRY (auto-registro)│
│   ├─ ListView  ← {items,total} (unwrapList)           │   │   ↓                                │
│   ├─ FormView  ← 422 con errors[].path               │   │ engine: 24-crud · 23-validate       │
│   └─ FieldHost ← campos/tipos del schema             │   │       22-assemble · 26-lock-cache  │
│                                                       │   │       27-views · 50-audit         │
│ app.config: API_URL + ADMIN_TOKEN                     │   │   ↓                                │
│ appInitializer → GET /admin/schema (timeout → local)  │◀──│ /admin/schema ← handlers/schema.js  │
└───────────────────────────────────────────────────────┘   │   ↓                                │
                                                            │ Google Sheets (libro + _audit_log) │
                                                            └────────────────────────────────────┘
```

---

## 1. Backend — llamar la API

**Un solo endpoint:** la URL del Web App (`…/exec`). Todo viaja en el
**cuerpo** de un `POST` (el envelope); `Content-Type: text/plain`, sin
cabeceras custom ni `application/json` (criterio 11 de `baseapi.md` §17).
El token de admin **también va en el cuerpo**, nunca en headers.

```json
{ "token": "<ADMIN_TOKEN>", "method": "GET", "path": "/admin/products", "payload": {} }
```

```bash
curl -sS -L -H 'Content-Type: text/plain' \
  --data '{"token":"'$ADMIN_TOKEN'","method":"GET","path":"/admin/products","payload":{}}' \
  "$WEB_APP_URL"
```

| `method` del envelope | Uso                                                                            |
| --------------------- | ------------------------------------------------------------------------------ |
| `GET`                 | lecturas (listado, detalle, `/admin/schema`) — igual se manda como `POST` HTTP |
| `POST`                | alta (`create`)                                                                |
| `PUT`                 | edición (`update`) / reorder                                                   |
| `DELETE`              | baja (`remove`)                                                                |

### Rutas

| Ruta                      | Lectura                                      | Escritura                                           |
| ------------------------- | -------------------------------------------- | --------------------------------------------------- |
| `/admin/<recurso>`        | `GET` → listado                              | `POST` alta · `PUT` edición/reorder · `DELETE` baja |
| `/admin/<recurso>/{key}`  | `GET` → detalle (la clave va **en el path**) | —                                                   |
| `/admin/schema`           | proyección pública para el front             | —                                                   |
| `/admin/upload-signature` | firma de subida (Cloudinary)                 | —                                                   |

Singletons (`site`, `legal`) no llevan clave: el `GET` de `/admin/<recurso>`
devuelve el registro único.

### Payload de lectura

```json
{ "view": "publishable", "filter": "…", "key": "…" }
```

- `view`: vista declarada en el schema del recurso (`views: { … }`); vista
  **no declarada o inexistente ⇒ 400**. Recursos sin vistas ⇒ 400 para
  cualquier `view`.
- `filter`: filtro nombrado (legado) — resuelve contra `views`.

### Respuestas

- **Éxito:** HTTP 200 siempre (el estado real va en el cuerpo).
- Si la operación declara `shape.envelope: 'list'` ⇒ el listado viene
  envuelto: `{ "items": [...], "total": n }`.
- **Error:** `{ "error": { "status", "message", "errors?" } }`.

| Status | Cuándo                                                                              |
| ------ | ----------------------------------------------------------------------------------- |
| `400`  | `view`/`filter` inválido                                                            |
| `404`  | ruta inexistente (recurso borrado/renombrado)                                       |
| `409`  | conflicto de lock (escritura concurrente) o `onDelete` con dependientes             |
| `422`  | validación: `error.errors[] = [{ message, path }]` con la **ruta exacta del campo** |
| `429`  | rate-limit de la política de la ruta (spec `'10/min'`)                              |
| `500`  | error de runtime (p. ej. falta una hoja: «Falta la hoja: X»)                        |

---

## 2. Backend — crear o modificar recursos (sin tocar código)

### Recurso nuevo = 1 archivo

Crear `api/schema/resources/<id>.js` con el auto-registro en `REGISTRY`
(el patrón exacto está en `schema/resources/categories.js` — el más
limpio). Esqueleto mínimo:

```js
// schema/resources/reviews — ejemplo ilustrativo (no es un recurso real).
REGISTRY.resources.reviews = {
  id: 'reviews',
  kind: 'collection', // 'collection' | 'singleton'
  sheet: 'reviews', // hoja de Sheets (deriva columnas del schema)
  keyField: 'slug', // clave primaria
  titleField: 'title', // título para UI/logs
  immutableKey: true,
  ordering: 'none', // 'none' | 'positioned'
  activeField: null, // columna de baja lógica, o la clave ('active')
  fields: [
    { key: 'slug', type: 'slug', required: true, unique: true, immutable: true, from: 'title' },
    { key: 'title', type: 'text', required: true },
    {
      key: 'status',
      type: 'select',
      required: true,
      default: 'pending',
      enum: ['pending', 'approved'],
    }, // enum inline: sin tocar 02-enums
    { key: 'created_at', type: 'text', readonly: true, computed: 'now' },
  ],
  operations: {
    list: { shape: { pick: ['slug', 'title', 'status'], envelope: 'list' } },
    // create/get/update/remove existen por defecto en colecciones;
    // declararlos acá sólo agrega metadata (shape, computed, …).
  },
  views: {
    pending: { where: [/* cláusulas declarativas */] }, // → ?view=pending
  },
  policies: {
    access: { read: 'public', write: 'admin' },
    audit: true, // traza create/update/delete en _audit_log
    // cache: { ttl: 300 } · lock: false · rate-limit por ruta
  },
};
```

Luego:

1. `cd api && npx clasp push -f` (altas/modificaciones).
2. **`setupDrift` desde el editor de Apps Script** (menú _Ejecutar_) —
   crea la hoja/columnas faltantes desde el schema; es **idempotente** y
   sólo **reporta** huérfanos (nunca borra).
3. `clasp version "vN - …"` + `clasp deploy -i <deploymentId> -V <n>`
   (la URL sirve una **versión fija**: push solo actualiza el HEAD).

**No hace falta** tocar `core/`, `engine/`, `primitives/` ni `setup/` —
el router arma las rutas del recurso solo y `/admin/schema` lo publica.

### Cambios comunes

| Quiero...                          | Hago...                                                   |
| ---------------------------------- | --------------------------------------------------------- |
| Campo nuevo                        | agregarlo en `fields` + `setupDrift` (crea la columna)    |
| Validación nueva                   | `required` / `unique` / `pattern` / `checks` en el schema |
| Cambiar columnas del listado       | `operations.list.shape.pick` (o `listProjection` legacy)  |
| Vista filtrada                     | declararla en `views` → `?view=<nombre>`                  |
| Auditoría / caché / lock / límites | `policies` (`audit`, `cache.ttl`, `lock`, rate-limit)     |

### Setup inicial (una vez, **desde el editor** — la Execution API no está

habilitada en este proyecto)

| Función                | Qué hace                                                                       |
| ---------------------- | ------------------------------------------------------------------------------ |
| `01-setup-spreadsheet` | crea/valida el libro y guarda `SPREADSHEET_ID` en Script Properties            |
| `02-setup-sheets`      | crea las hojas base con sus cabeceras                                          |
| `04-setup-seed`        | datos de demostración opcionales                                               |
| `03-setup-drift`       | **idempotente**: sincroniza hojas ⇄ schema (crea faltantes, reporta `orphans`) |

Los secretos (token, IDs, claves de Cloudinary) viven **sólo en Script
Properties** (`13-props`), jamás en el repo.

---

## 3. Backend — deploy y verificación

```bash
cd api
npx clasp push -f                    # altas/modificaciones
# …borrados (clasp 3.4.1 NO los propaga con push -f)…
nohup npx clasp push -w &            # 1) watch en background
#   2) crear y borrar un trigger temporal (zz-tmp-trigger.js) para
#      dispara la sync completa  3) matar el watch
npx clasp version "vN - …"           # versión fija
npx clasp deploy -i <deploymentId> -V <n>
```

Verificación local (no red):

```bash
npm run api:check                    # reglas: sin nombres de dominio en
                                     # core/engine/primitives + registry ↔ archivos
bash scripts/api-regression.sh       # 11 fixtures handler-a-handler
```

Verificación live: envelope `{token, method, path, payload}` con `curl`
(ver §1) — el patrón completo de smokes quedó como referencia en los
scripts temporales de las fases (`f5-verify`, `f6-smoke`, § P de
`PLAN-MEJORAS.md`).

---

## 4. Frontend — uso

### Configuración (obligatoria)

Los valores viven en `src/environments/environment.local.ts` (gitignored;
`app.config.ts` sólo hace `{ provide: API_URL, useValue: environment.apiUrl }`,
igual para `ADMIN_TOKEN`). Para clonar el proyecto:

```bash
cp src/environments/environment.local.example.ts src/environments/environment.local.ts
# completar apiUrl y adminToken
```

`angular.json` aplica ese archivo con `fileReplacements` en las configs
`development` y `production`. `environment.ts` (committeado) lleva los dos
valores vacíos. Secretos: `baseapi` §2.3 — **jamás** en el repo.
`apiUrl` vacío = mismo origen (útil sólo con proxy).

### Arranque

1. `provideAppInitializer` ⇒ `SchemaService.load()` corre **antes** del
   primer render: `GET /admin/schema` con **timeout**; cualquier fallo
   (red, timeout, shape raro) ⇒ `remote = null` y **manda el esquema
   local** (el bootstrap jamás se bloquea).
2. Router: `''` → redirect al primer recurso del registry; el resto vive
   en el shell (`Layout`):

| Ruta             | Componente                  |
| ---------------- | --------------------------- |
| `/:id`           | detalle/lectura del recurso |
| `/:id/new`       | alta                        |
| `/:id/:key/edit` | edición                     |

### Autenticación

Sin interceptor de auth: `ApiService.send()` arma
`{ token, method, path, payload }` y lo manda con
`Content-Type: text/plain` (sin cabeceras custom — criterio 11). Sólo hay
un interceptor de errores de API (`api-error.interceptor`).

### Esquemas: local, remoto y merge

- **Locales:** `src/app/schemas/<id>.schema.ts` (`categories`, `products`,
  `site`, `legal`) — declaran el lado de UI: etiquetas, columnas de tabla,
  filtros client-side, tipos de campo.
- **Remoto:** `/admin/schema` → `setRemoteSchema(…)`.
- **Merge** (`schemas/registry.ts`): por cada id, el remoto **pisa** la
  presentación local (`mergeResourceSchema`); un recurso que existe **sólo
  en remoto** se **sintetiza** completo (etiquetas derivadas del id, columnas
  desde `shape`/`listProjection`). `allSchemas()` = catálogo efectivo (es lo
  que consume el menú lateral, reactivo).
- `schemas[]` (array local) **nunca cambia**; sólo cambia el efectivo.

### CRUD

`ApiService` (`core/services/api.service.ts`):

| Método    | Envelope                     | Notas                                                                                   |
| --------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| `list`    | `GET /admin/<recurso>`       | desenvuelve `{items,total}` → `T[]` (**único** punto que habla de listas: `unwrapList`) |
| `get`     | `GET /admin/<recurso>/{key}` | reemplaza `{key}` con `encodeURIComponent`                                              |
| `create`  | `POST`                       | devuelve el registro                                                                    |
| `update`  | `PUT`                        | devuelve el registro                                                                    |
| `remove`  | `DELETE`                     |                                                                                         |
| `request` | ruta libre                   | reorder (`{reorder:…}`), `/admin/schema`, upload-signature                              |

Si la operación no existe para el recurso, `list`/`get` fallan con
«Operación no disponible para este recurso» (los endpoints vienen del
schema).

### Vistas y filtros

- Las `views` del backend viajan en el schema como **metadato público**
  (`schema.views`), pero **el admin no las usa todavía**: los filtros del
  listado son **client-side** sobre `schema.filters` local (decisión F7-5).
- El consumo de `?view=` queda para el front público.

---

## 5. Flujo end-to-end (cómo se conectan, paso a paso)

**Arranque:** boot de Angular → `appInitializer` → `GET /admin/schema` →
`setRemoteSchema` → merge en `registry` → `allSchemas()` arma el menú →
redirect al primer recurso.

**Listado:** ruta `/admin/products` → `RemoteResource` → `ApiService.list`
→ envelope `GET /admin/products` → router resuelve contra `REGISTRY` →
pipeline (`27-views` aplica vista → `24-crud` lee hoja → `22-assemble`
proyecta `shape` → `26-lock-cache` cachea) → `{items,total}` →
`unwrapList` → `ListView` renderiza columnas del schema.

**Alta:** `/:id/new` → `FormView` (campos desde `schema.fields` con sus
tipos/required) → `ApiService.create` → `23-validate` (422 ⇒
`errors[].path` se muestra campo a campo) → insert en Sheets +
`auditWrite_` + invalidación de caché → respuesta con el registro →
redirect al detalle.

**Detalle:** `/:id/:key` → `ApiService.get` (clave en el path) → lectura
(potencialmente cacheada) → `FormView`/vista de lectura.

---

## 6. Documentos de referencia

| Doc                   | Qué cubre                                                                      |
| --------------------- | ------------------------------------------------------------------------------ |
| `doc/baseapi.md`      | **autoridad**: contrato completo (auth, envelope, rutas, hojas, §17 criterios) |
| `doc/api.md`          | contrato de datos (hojas y columnas)                                           |
| `api/MAPA.md`         | estructura de archivos del backend y sus funciones                             |
| `api/README.md`       | resumen del backend y sus tablas de rutas                                      |
| `api/PLAN-MEJORAS.md` | mejora F0–F7 + P: qué cambió y por qué (registro de decisiones)                |
| `api/PLAN.md`         | plan original por fases + estado de las mejoras                                |
