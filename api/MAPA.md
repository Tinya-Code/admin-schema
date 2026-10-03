# Mapa de `api/` — backend (Google Apps Script + Google Sheets)

Documento de navegación para humanos y agentes: qué hace cada archivo, cómo se
enlazan y por dónde fluye una petición. **Sin código** — sólo estructura y
contratos. El detalle de cada archivo vive en su comentario cabecera; el
concepto en `README.md`; las fases en `PLAN.md`.

---

## 1. Cómo se enlazan los archivos (su "importación")

- **Un solo scope global.** Apps Script no usa ES modules: todos los `.js`
  comparten el mismo ámbito global y se llaman por nombre. **No existe
  `import`/`export`.**
- **Orden de carga = `filePushOrder` de `.clasp.json`** (lista en §4). Por eso
  los top-level de cada archivo **sólo declaran** (constantes y objetos
  literales): cualquier referencia a otro archivo se resuelve en **runtime**
  (resolución perezosa vía `globalThis`), nunca al cargar.
- **Convención de visibilidad:** sufijo `_` = función interna de su archivo
  (ej. `parseEnvelope_`); sin `_` = contrato entre módulos (ej. `doPost`,
  `getResourceSchema`, `setupSheets`). El `_` es convención, no
  encapsulamiento real — el mismo scope las ve todas.
- **Qué se empuja:** `.claspignore` sube únicamente `appsscript.json` y
  `*.js` (README, PLAN y `.git` se quedan fuera).
- **Manifiesto (`appsscript.json`):** runtime V8, zona `America/Lima`,
  logging a Stackdriver, webapp `executeAs: USER_DEPLOYING` +
  `access: ANYONE_ANONYMOUS` (el front llama sin sesión; la seguridad es el
  token en el cuerpo).

---

## 2. Flujo de una petición (runtime)

**Entrada única** — todo llega como `POST` con cuerpo `text/plain` que es un
JSON `{ token, method, path, payload }` (el método LÓGICO va dentro del
cuerpo; el HTTP siempre es POST ⇒ sin preflight/CORS):

```
doPost (core/10-router)
  1. parseEnvelope_        → 400 si el cuerpo no cumple (method → path → payload)
  2. resolveRoute_         → tabla DERIVADA de REGISTRY, 1× por ejecución
                             (routeTable_ en el router): endpoints declarados
                             (schema/endpoints/*) + resources (/{scope}/{id} y
                             /{scope}/{id}/{key}; scope/route salen del resource)
                             Cada entrada lleva su POLÍTICA (F6): access/limits
                             del endpoint o de resource.policies
  3. requireAccess_        → 401 según el nivel declarado para el grupo
                             (GET ⇒ read; resto ⇒ write) — SIN política ⇒
                             admin (fail-closed). core/11-auth: SHA-256 del
                             token vs ADMIN_TOKEN_HASH en tiempo constante;
                             el token jamás va a URL ni logs
     (errores de resolución → 400 clave inválida / 404 si no está en la tabla,
      SIEMPRE después del auth, como antes de F6)
  4. enforceRateLimit_     → 429 si la política limits del grupo se excede
                             (engine/26-lock-cache; spec '<n>/min')
  5. dispatchRoute_
        • kind = handler  → handler declarado en primitives/handlers/
                             (devuelve datos)
        • kind = resource → dispatchResource_ (engine/24-crud)
  6. respond_ / errorResponse_ (core/12-http) → SIEMPRE HTTP 200;
        el estado real viaja dentro del JSON
```

**Lectura de recurso** (`GET /admin/{id}`):
`dispatchResource_ → resourceGet_/readList_` → caché (26) → rangos completos
(21) → armar objetos (22) → ordenar → proyectar listado → vistas
declarativas `where/sort/limit` del payload `{ filter, view, key }`
(27-views + `REGISTRY.ops`) → **forma de respuesta `shape`** (F5: si la
operación/vista declara `operations.<op>.shape` ⇒ `pick`/`include` → `nest`
→ `rename` → `envelope {items,total}` en 22; sin declaración ⇒ salida previa)
→ JSON.

**Escritura** (`POST`/`PUT`/`PATCH`/`DELETE`):
`computeRules_` (derivados declarados en `operations.create.computed`, sólo
al crear) → validar declarativo (23: acumula TODOS los errores con ruta +
`resource.checks` al final, en orden declarado) → **lock** (26) → releer y
re-validar → fila principal + hijos en lote (21) → campos computados →
auditar (`50-audit` → `_audit_log`) → invalidar caché → responder recurso
armado.

**Reorder** (`PUT /admin/{colección}` con `{ reorder: { key, after | toStart |
toEnd } }`): `reorderCollection_` (24) → `applyReorderIntent_` +
`assignPositions_` (25: paso 1000, rebalanceo si el hueco no alcanza, todo
bajo lock) → la respuesta es **el listado fresco completo**.

**Errores:** cualquier `apiError_(status, mensaje)` o `validationError_`
lanzado cae en el `catch` de `doPost` → `errorResponse_` →
`{ error: { status, message, errors?: [{ path, message }] } }`. Estados:
400 · 401 · 404 · 409 · 422 · 429 · 500.

**Setup (fuera del runtime):** funciones manuales que se ejecutan desde el
editor de Apps Script o `clasp run-function`, siempre en este orden:
`00-check-properties` → `01-setup-spreadsheet` → `02-setup-sheets` →
`03-setup-drift` → `04-setup-seed`. Todas idempotentes.

---

## 3. Árbol: qué hace cada archivo

### Raíz de `api/`

| Archivo           | Función                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00-config.js`    | Constantes no sensibles + **manifiesto de propiedades**: sólo NOMBRES y límites (required/secret/source), jamás valores.                                                                                                  |
| `00-registry.js`  | **`REGISTRY`** (auto-registro: `resources, types, enums, endpoints, ops, transforms, checks, handlers`) + `getResourceSchema(id)`. **Primero en `filePushOrder`**: el resto de archivos se auto-registra en su top-level. |
| `50-audit.js`     | **Única** implementación de la traza en `_audit_log` (`appendAuditRow_`). La comparten setup-drift y el CRUD: un solo formato de fila.                                                                                    |
| `README.md`       | Concepto v2: restricciones del entorno + árbol explicado.                                                                                                                                                                 |
| `PLAN.md`         | Plan de 12 fases con tareas y criterios (Fases 0–10 ✓, Fase 11 pendiente).                                                                                                                                                |
| `appsscript.json` | Manifiesto GAS (V8, zona, webapp anónimo).                                                                                                                                                                                |
| `.clasp.json`     | `scriptId` + **`filePushOrder`** (orden de carga, §4). Local, no se commitea.                                                                                                                                             |
| `.claspignore`    | Sólo empuja `appsscript.json` y `*.js`.                                                                                                                                                                                   |

### `core/` — marco común (no conoce hojas ni reglas)

| Archivo        | Función                                                                                                                                                                                                                                                                 | Funciones clave                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `10-router.js` | Punto de entrada del web app: parsea el envelope, resuelve la ruta y su **política** (F6), aplica auth + rate-limit, delega; barre el token de cualquier log/error.                                                                                                     | `doPost`, `doGet`, `parseEnvelope_`, `resolveRoute_`, `dispatchRoute_`, `normalizePath_`, `policyFor_`, `normalizeAccess_`, `normalizeLimits_`, `policyAccess_` |
| `11-auth.js`   | Autenticación **por política de ruta** (F6, §8): el nivel (`public`/`admin`/rol) sale de `endpoint.access` o `resource.policies.access` — no del prefijo del path. `public` sin token; sin política ⇒ admin (fail-closed). SHA-256 en tiempo constante; sin hash → 500. | `requireAccess_`, `requireAdmin_`, `constantTimeEqual_`                                                                                                         |
| `12-http.js`   | Envelope de respuesta: éxito = JSON plano, error = `{error:{…}}`; siempre HTTP 200 (GAS no deja fijar el estado).                                                                                                                                                       | `respond_`, `respondError_`, `apiError_`, `validationError_`, `errorResponse_`                                                                                  |
| `13-props.js`  | **Único** punto de acceso a `PropertiesService`: lee 1× por ejecución y cachea; escribe sólo vía `setAll`; falta una requerida → 500 sin revelar valores.                                                                                                               | `propsLoad_`                                                                                                                                                    |

### `engine/` — motor genérico parametrizado por `schema/`

| Archivo             | Función                                                                                                                                                                                                                                                                                                                                                                                                                        | Funciones clave                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20-storage-map.js` | Mapa recurso → almacenamiento: campo → columna (grupos con prefijo `address_street`), fila KV (singleton) u hoja hija (list/string-list/key-value con `fk` y `position`). El resto del motor sólo consume este mapa.                                                                                                                                                                                                           | `storageMap_`, `columnEntry_`, `childEntry_`, `childSpec_`                                                                                                             |
| `21-repo.js`        | Lectura/escritura **por rangos** (nunca celda a celda); mapeo fila ↔ objeto por NOMBRE de cabecera ⇒ el orden de columnas es irrelevante. Asigna posiciones densas 1..N a hojas hijas.                                                                                                                                                                                                                                         | `readSheetData_`, `writeRowsBlock_`, `spliceChildRows_`, `itemsToRows_`, `flatEntries_`                                                                                |
| `22-assemble.js`    | Filas planas ↔ objetos de contrato que consume el front (grupos anidados, multiselect CSV → `[]`, hijos siempre con el padre) + **proyección de listado** (`listProjection`/`listPick`) + **intérprete de `shape`** (F5: `validateShape_`/`applyShape_`/`shapeEnvelope_`/`shapeResponse_`/`resolveListShape_`/`listLoadKeys_` — sin nombres de campo concretos).                                                               | `flatToContract_`, `contractToFlat_`, `assembleFull_`, `projectItem_`, `childRowsToItems_`, `applyShape_`, `shapeResponse_`, `shapeEnvelope_`                          |
| `23-validate.js`    | Reglas **declarativas** del schema: requerido, único, inmutable, enum, patrón, rangos, palabras, FK (+ onlyActive), mín/máx de lista, origen Cloudinary de imágenes. Acumula TODOS los errores con ruta (`images[0].image_url`) y al final corre `resource.checks` (F4) en orden declarado, en el mismo 422.                                                                                                                   | `validatePayload_`, `validateScalar_`, `validateRelation_`, `validateChild_`                                                                                           |
| `24-crud.js`        | **Corazón del backend**: pipeline genérico de lectura/escritura, una sola implementación parametrizada por recurso. Entrada del router: `dispatchResource_`. Soporta detalle, listado, create, update, delete y reorder. Interpreta `operations.create.computed` (F4: `computeRules_`), envuelve get/create/update/delete en `shapeResponse_` (F5; reorder queda fuera) y lee `policies.cache/audit` + `withPolicyLock_` (F6). | `dispatchResource_`, `resourceGet_`, `readList_`, `resourceCreate_`, `resourcePut_`, `reorderCollection_`, `resourceDelete_`, `computeRules_`, `ttlOf_`, `auditWrite_` |
| `25-ordering.js`    | El backend es **dueño de `position`**: convierte la intención del front (siguiente/anterior/inicio/fin) en coordenadas con paso 1000 y rebalancea si no hay hueco.                                                                                                                                                                                                                                                             | `applyReorderIntent_`, `assignPositions_`, `rebalancePositions_`, `nextPosition_`                                                                                      |
| `26-lock-cache.js`  | **Lock** exclusivo en toda escritura (dos reorders se serializan; timeout → 409; condicional vía `policies.lock`, F6) + **caché** troceada por "generación" (CacheService no lista claves): escritura nueva ⇒ clave nueva, las viejas expiran solas. + **rate-limit genérico único** (F6-3): aplica specs `'10/min'` declarados en la política de la ruta.                                                                     | `withLock_`, `withPolicyLock_`, `cacheGet_`, `cachePut_`, `cacheInvalidate_`, `cacheGenKey_`, `enforceRateLimit_`, `parseLimitSpec_`                                   |
| `27-views.js`       | **Vistas declarativas** (F3): interpreta `where/sort/limit/extends` de `resource.views` con ops de `REGISTRY.ops`; la lectura con intención `{ filter, view, key }` (`listWithRules_` se mudó aquí desde 24). Escape hatch: `view.handler` → `REGISTRY.handlers`. Fail-closed en operandos sin contexto. Con F5 aplica la **forma efectiva** (shape de la vista > shape del listado) y envuelve el resultado.                  | `listWithRules_`, `applyViewFilter_`, `applyDeclaredView_`, `resolveViewWhere_`, `evalWhere_`, `sortItems_`, `readRulesCtx_`                                           |

### `primitives/` — operadores genéricos + handlers no-CRUD

| Archivo                   | Función                                                                                                                                                                                                                                                                                | Funciones clave                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `ops.js`                  | **Operadores genéricos de consulta** (F3): `eq neq in nin gt gte lt lte contains starts regex empty exists in-active` → `REGISTRY.ops` (`fn(actual, expected)`; booleanos vía `truthyCell_`, `in-active` fail-closed). Cero nombres de dominio — son DATOS, no primitivas de catálogo. | `opEq_`, `opIn_`, `opOrdered_`, `opInActive_`          |
| `transforms.js`           | **Derivados parametrizados** (F4): `slugify` (`lower/sep/keep`, réplica de `slugify.ts`) → `REGISTRY.transforms`, invocado por `computeRules_` desde `resource.operations.create.computed`. Cero nombres de dominio.                                                                   | `REGISTRY.transforms.slugify`                          |
| `checks.js`               | **Checks declarados** (F4): `pattern` (regex + `negate` + mensaje), `mod11` (weights/expected, sin consumidor aún), `not-in-sheet` (hoja de patrones vs todos los strings del contrato) → `REGISTRY.checks`; el motor los corre desde `resource.checks`.                               | `REGISTRY.checks`, `checkScanValue_`, `checkPatterns_` |
| `handlers/hidden-list.js` | **Escape hatch §6** de la vista `hidden-with-reason` (R6): población OR de dos causas + anotación `reasons` no expresable con `where/sort/limit`. Justificación obligatoria en el comentario del propio handler.                                                                       | `REGISTRY.handlers.hiddenList`                         |

Los handlers de endpoints se resuelven por **nombre declarado** en
`schema/endpoints/*` (`REGISTRY.endpoints.<id>.handler`) — no hay tablas de
rutas en `core/`.

| Archivo                        | Función                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Funciones clave                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `handlers/upload-signature.js` | Emite la **firma de subida a Cloudinary** (flujo en dos pasos): el backend nunca habla con la nube ni ve el archivo; el API secret no sale jamás. El cliente NO elige carpeta/formatos: los fija el backend y van dentro de la firma. Rate-limit por recurso → 429.                                                                                                                                                                                                                          | `handleUploadSignature`, `cloudinarySign_`, `enforceSignatureRateLimit_`                                             |
| `handlers/schema.js`           | **Proyección pública del schema** para el front (`/admin/schema`): estructura (campos, tipos, required, enums, rangos, relaciones, `listProjection`) + desde F7 **metadatos públicos por recurso**: `operations` (rutas efectivas vía `resourceRoute_` + `shape` por whitelist), `views` (declarativas; `handler` ⇒ `{custom:true}`) y `policies.access`. Nunca hojas, columnas internas, reglas, propiedades ni internals de caché/audit/lock. 100% genérico: recorre `REGISTRY.resources`. | `handleSchema`, `projectResourceSchema_`, `projectField_`, `projectOperations_`, `projectViews_`, `projectPolicies_` |

### `schema/endpoints/` — endpoints no-CRUD declarados (§9)

| Archivo               | Declara                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `schema.js`           | `REGISTRY.endpoints.schema` → `{ route, method, access, limits, handler: 'handleSchema' }`                   |
| `upload-signature.js` | `REGISTRY.endpoints.uploadSignature` → `{ route, method, access, limits, handler: 'handleUploadSignature' }` |

`method`/`access`/`limits` son **datos declarativos** (consumirlos: F6).

### `rules/` — ya no existe (F4)

La carpeta entera se eliminó: `31-catalog-rules.js` (vistas) migró a
`resource.views` declarativo (F3) y `30-registry` + `32-validators`
(reglas nombradas) a declaraciones que el motor interpreta solo:
`resource.operations.create.computed` → `primitives/transforms.js` (F4) y
`resource.checks` → `primitives/checks.js` (F4). Ningún archivo de
`engine/` o `core/` las referencia.

### `schema/` — 🧠 fuente única declarativa (**auto-registro en `REGISTRY`**)

| Archivo                   | Función                                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types/01-types.js`       | Catálogo de 20 tipos de campo (idéntico al front) + metadatos de almacenamiento que consume `engine/20-storage-map` → `REGISTRY.types`.                                                                   |
| `enums/02-enums.js`       | Catálogos de valores permitidos (availability, days, risk_class…) → `REGISTRY.enums`. Alimenta desplegables (setup) y validación (23).                                                                    |
| `resources/categories.js` | Colección reordenable de categorías → `REGISTRY.resources.categories`.                                                                                                                                    |
| `resources/products.js`   | Colección con hojas hijas (imágenes, variantes, atributos…): se leen/escriben SIEMPRE con el padre, reemplazo en lote → `REGISTRY.resources.products`.                                                    |
| `resources/site.js`       | Singleton de configuración del sitio (KV con grupos aplanados `address_street…`; hijas `hours` y `social`) → `REGISTRY.resources.site`.                                                                   |
| `resources/legal.js`      | Singleton legal (libro de reclamaciones, IGV), mismo formato KV → `REGISTRY.resources.legal`.                                                                                                             |
| `05-aux-sheets.js`        | Columnas fuente única de hojas auxiliares (`_enums`, `_placeholders`, `_audit_log`) para que setup y audit no hardcodeen cabeceras. No existe `_media`: con subida directa el backend no ve cada archivo. |

**Regla de oro (Fase 1):** recurso nuevo = **1 archivo en
`schema/resources/<id>.js`** con `REGISTRY.resources.<id> = { … }` ⇒
**cero** líneas fuera de `schema/` (F1-10 evidenciado). El índice manual
`04-registry.js` y los `03-resources-*` ya no existen.

### `setup/` — manual, idempotente, desde el editor

| Archivo                   | Función                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `00-check-properties.js`  | Verifica propiedades `manual` (si faltan, lista cuáles y **se detiene**), genera las `generated` faltantes y expone `rotarToken`. Primero de todo.                                               |
| `01-setup-spreadsheet.js` | Crea o reutiliza el libro; el ID vive sólo en `SPREADSHEET_ID`.                                                                                                                                  |
| `02-setup-sheets.js`      | Crea hojas y cabeceras **desde el schema** (nada hardcodeado), estilos, protege fila 1. 2ª corrida ⇒ 0 cambios.                                                                                  |
| `03-setup-drift.js`       | Evolución schema ↔ hojas: crea columnas faltantes (nunca toca datos), **reporta** huérfanas (jamás borra), **bloquea** cambios de tipo incompatibles, actualiza `SCHEMA_VERSION` + `_audit_log`. |
| `04-setup-seed.js`        | Puebla `_enums`, `_placeholders` y las filas KV iniciales de singletons. Sólo agrega lo que falta.                                                                                               |

---

## 4. Orden de carga (`filePushOrder` de `.clasp.json`)

```
00-registry (REGISTRY) → 00-config
→ schema/types/01-types → schema/enums/02-enums → schema/05-aux-sheets
→ core/10-router → core/11-auth → core/12-http → core/13-props
→ engine/20-storage-map → 21-repo → 22-assemble → 23-validate → 24-crud → 25-ordering → 26-lock-cache
→ engine/27-views → primitives/ops → primitives/transforms → primitives/checks
→ setup/00-check-properties → 01-setup-spreadsheet → 02-setup-sheets → 03-setup-drift → 04-setup-seed
→ 50-audit
→ sin listar (alfa al final): schema/endpoints/*, schema/resources/*, primitives/handlers/*
```

Prefijos numéricos (`00-`, `10-`, `20-`, `30-`, `40-`, `50-`) = capa y orden;
el orden real lo manda `filePushOrder`. `00-registry` va **idx 0** porque los
`schema/resources/*` se auto-registan en su top-level al evaluar: `REGISTRY`
debe existir primero (confirmado en runtime GAS v8, smokes F1-9/F1-10).

### Despliegue (⚠️ `push` ≠ publicación)

```
clasp push -f            # actualiza el HEAD del script (no la URL)
clasp version "vN - …"   # crea una versión inmutable desde el HEAD
clasp deploy -i <deploymentId> -V <n>   # re-apunta la MISMA URL a vN
```

La URL del webapp sirve una **versión fija** (`clasp deployments`): sin el
paso 2–3 los smokes miden el código viejo. Dos gotchas de clasp 3.4.1:

- **No propaga borrados**: `getChangedFiles()` sólo mira locales ⇒
  `push` dice "already up to date". Workaround: `clasp push -w` + crear y
  borrar un trigger temporal (el watcher detecta `unlink` y ejecuta
  `push()`, que manda `updateContent` con **todo** el contenido local).
- `filePushOrder` **sólo ordena**; la selección es `.claspignore`.

Rollback = `clasp pull` (o backup local) + `push -f` + `version` + `deploy`.

---

## 5. Contratos para extender (checklist de agente)

| Quiero…                        | Tocar                                                                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Recurso estándar nuevo         | **1 archivo** `schema/resources/<id>.js` (`REGISTRY.resources.<id> = {…}`) + migración con `setup/03-setup-drift`. **Cero** cambios fuera de `schema/` ⇒ cero cambios en engine/core.                                                                              |
| Endpoint no-CRUD nuevo         | `schema/endpoints/<id>.js` (`REGISTRY.endpoints.<id> = { route, method, handler }`) + handler en `primitives/handlers/<id>.js`. **Cero** cambios en `core/` (Fase 2: sin `EXTRA_ROUTES`).                                                                          |
| Vista/filtro nuevo             | **declaración** en `resource.views` (`{ where, sort, limit, extends }`) con ops de `primitives/ops.js` — cero código. Sólo si `where/sort/limit` no alcanzan ⇒ escape hatch §6: `handler` + registro en `REGISTRY.handlers` con justificación.                     |
| Derivar un valor al crear      | **declaración** `resource.operations.create.computed = [{ field, transform, from }]` con transforms de `primitives/transforms.js` (F4) — corre sólo al crear y sólo si el destino viene vacío. Cero código en `engine/`.                                           |
| Cambiar validación             | declarativa → `schema/resources/<id>.js` (el motor la entiende sola); check parametrizado → `resource.checks` con `primitives/checks.js` (`pattern`/`mod11`/`not-in-sheet`, F4) en el orden de error deseado.                                                      |
| Cambiar forma de respuesta     | **declaración** `operations.<op>.shape` o `views.<n>.shape` en `schema/resources/<id>.js` (`pick`/`include`/`nest`/`rename`/`envelope`, F5) — el intérprete vive en `22-assemble`; sin declaración la salida no cambia. Ejemplo: `products` (v13).                 |
| Cambiar contrato de respuesta  | `core/12-http.js` (único lugar que envuelve éxito/error — el `shape` de F5 sólo modifica el payload **antes** de `respond_`).                                                                                                                                      |
| Cambiar permisos de una ruta   | **declaración** `access` en `schema/endpoints/<id>.js` o `resource.policies.access = { read, write }` en el recurso (`public`/`admin`; sin declaración ⇒ admin fail-closed) — lo consume `requireAccess_` vía la política de la ruta (F6). Cero código en `core/`. |
| Limitar frecuencia de una ruta | **declaración** `limits: '<n>/min'` en el endpoint o `resource.policies.limits = { read, write }` — el router aplica el rate-limit genérico de `26-lock-cache` desde la política de la ruta (F6). Cero código; ejemplo: upload-signature 10/min.                   |
| Tocar propiedades/secretos     | sólo vía `core/13-props.js`; nombres en `00-config.js`.                                                                                                                                                                                                            |

**Escape hatch §6:** `handlers: { … }` (vistas y endpoints) sólo aplica
cuando **una primitiva no llega** — primero se declara con `ops`,
`transforms` o `checks`; un handler de dominio nuevo exige justificación
escrita en su propio archivo. Ninguna fase autoriza handlers sin ella.

Reglas transversales: **todo pasa por el envelope de `12-http`** (200 siempre),
**toda ruta se autentica por su política** (F6: sin política ⇒ admin),
**toda escritura bajo lock** (`26`), **toda traza por `50-audit`**, y el
**schema es la fuente única** — hojas, columnas, validación, storage-map,
permisos, límites y TTL salen de él.
