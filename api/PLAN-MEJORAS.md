# Plan de ejecución — Backend 100% dirigido por esquema

Documento derivado de **`mejoras.md`** (esa es la autoridad de diseño; este plan
sólo la desmenuza en **fases y tareas con criterio de cierre**). Fases F0–F7 del
§10 + la prueba de éxito del §12.

Notación de alineación: `mejoras.md` §11.7 dice `MAP.md` — el archivo real es
**`MAPA.md`**; aquí se usa ese nombre. Las rutas `schema/resources/*`,
`schema/endpoints/*` y `primitives/*` son las del §2.

---

## 0. Criterio general (aplica a TODAS las fases)

**Reglas inquebrantables** (§11 — se reiteran aquí para que ningún corte de
contexto las pierda):

1. **Prohibido** mencionar un recurso, campo o ruta concreta en `core/`,
   `engine/` ni `primitives/`.
2. Código nuevo ⇒ primero: _¿es primitiva genérica reutilizable?_ Sí →
   `primitives/` con parámetros; no → `handler` nombrado + justificación.
3. Top-level de cada archivo **sólo declara** (literales y asignaciones al
   `REGISTRY`).
4. Se mantienen: envelope único con HTTP 200 (`12-http`), toda escritura bajo
   lock, toda traza por `50-audit`, propiedades sólo vía `13-props`,
   lecturas/escrituras por rangos.
5. Schema = fuente única (hojas, columnas, validación, rutas, `/schema`,
   respuestas).
6. **Regresión obligatoria por fase**: ninguna fase se cierra con respuestas
   distintas a las de la línea base, salvo cambio declarado y justificado.
7. Al cerrar cada fase: actualizar `MAPA.md` (estructura/contratos) y
   `PLAN.md` (marcar fase). Sin esto, la fase NO está cerrada.

**Estrategia de verificación** — toda fase se cierra con sus 3 niveles:

| Nivel                     | Qué es                                                                                                          | Cuándo corre                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Estática**              | Greps/estructura listados en cada fase (ejecuta en local)                                                       | Siempre                                                                          |
| **Contrato (smoke HTTP)** | POST real al webapp con el envelope `{token, method, path, payload}` comparado contra fixtures de la línea base | Requiere URL de despliegue + `ADMIN_TOKEN` (tarea F0-1, **depende del usuario**) |
| **Front**                 | `ng test` + `ng build`                                                                                          | Sólo F7 (única fase que toca el front)                                           |

> **Disciplina de criterio:** un checkbox de criterio **no se marca** sin la
> evidencia de su nivel de verificación. Si el smoke está bloqueado (falta
> URL/token), la fase puede avanzar con estática + regresión estática, pero el
> cierre queda **pendiente de evidencia** y se anota en el checkbox
> `(cierre pendiente de smoke)`.

**Cadena de dependencias:**

```
F0 (línea base + spikes) → F1 (registry) → F2 (rutas)
    → F3 (vistas)  ┐
    → F4 (checks)  ├─ → F6 (policies) → F7 (/schema + front) → P (prueba §12)
    → F5 (shape)   ┘
```

F3/F4/F5 son **independientes entre sí** (pueden alternarse) pero todas exigen
F1 y F2 terminadas.

---

## Fase 0 — Línea base y desbloqueos

**Objetivo:** poder verificar todo lo demás. Nada de esta fase cambia
comportamiento.

- [x] **F0-1** ✅ Obtener del usuario: URL del webapp desplegado + `ADMIN_TOKEN`
      — **recibidos**. Ojo: el token son **72 caracteres** (dos GUIDs
      concatenados tal como los pegó el usuario); los GUIDs sueltos dan 401.
      No se guarda en el repo.
- [x] **F0-2** ✅ Smoke de línea base y **guardar fixtures** en
      `api/fixtures/` (JSON, una carpeta por caso): detalle y listado de
      `products`/`categories`/`site`/`legal`, `GET /admin/schema`, firma de
      upload, y los errores canónicos **400** (cuerpo inválido), **401**
      (token malo), **404** (ruta desconocida), **409** (lock contención,
      opcional), **422** (validación con `errors[].path`), **429** (límite de
      upload, opcional). — _Resultados: 11 fixtures generados (409/429
      omitidos por ahora); 2º smoke semánticamente idéntico ✓; el 422 con `{}`_
      _**NO escribió** (listado sigue `[]`) ✓; timestamp/signature
      normalizados a `<NORMALIZED>`._
      **Receta de smoke (hallada en F0-2):** `curl -sSL -H 'Content-Type:
text/plain' --data '<envelope>' <URL>` — **sin** `-X POST`: `-X` fuerza
      el método en la segunda salta del 302 de GAS y da 405; con `--data` sól*
      _o, curl convierte a GET como hace el browser._
- [x] **F0-3** ✅ Spike GAS: `const REGISTRY` declarado en el **primer**
      archivo de `filePushOrder` es visible en todos los demás — **resuelto
      por doc oficial** (V8 runtime: _"All script files are executed in a
      global scope. Explicitly order your files if dependencies exist"_ +
      `filePushOrder` en índice 0 garantiza el orden; nuestro "top-level sólo
      declara" evita los TDZ). Confirmación empírica en F1 con smoke.
- [x] **F0-4** ✅ Spike `filePushOrder` parcial — **resuelto por código
      fuente de clasp 3.4.1** (`files.js:494-511`): `filePushOrder` **sólo
      ordena**; la selección la hace `.claspignore`; los archivos no
      listados **sí se suben** y quedan **después** de todos los listados,
      en orden alfabético. _Plan B (`schema/_manifest` + `sync-order`)
      DESCARTADO._ Verificación empírica con `clasp status`: 32 tracked,
      `.md`/`fixtures/` excluidos ✓.
- [x] **F0-5** ✅ Estrategia de despliegue por fase: **push directo al
      scriptId actual** (decisión del usuario) con smoke post-push contra
      fixtures; rollback = `clasp pull` + `push` (el remoto se puede
      re-descargar en cualquier momento; local == remoto verificado).
- [x] **F0-6** ✅ Crear `npm run api:check` → `scripts/api-check.sh`: greps de
      las reglas 1 y 5 (dual-mode pre-F1/F1+ según exista
      `schema/resources/`). — _Rojo de partida documentado: regla 1 = **3
      coincidencias** (las 2 de `EXTRA_ROUTES` en `10-router` + el ejemplo
      `/admin/categories` del mensaje de error de `parseEnvelope_`); regla 5 =
      verde (4 ids ↔ 4 archivos)._

**Criterio de aceptación F0**

- [x] Fixtures de línea base guardadas y mínimamente reproducibles (2º smoke
      ⇒ idéntico). _✓ 11 fixtures; comparación semántica idéntica._
- [x] Spikes F0-3 y F0-4 con resultado anotado y decisión tomada. _✓ ambos
      resueltos (ver tabla de decisiones); F0-5 sigue pendiente de decisión
      del usuario._
- [x] `npm run api:check` corre y documenta el "rojo de partida" de regla 1:
      **3 coincidencias** (2 × `EXTRA_ROUTES` + 1 ejemplo en mensaje de
      error). _Estado esperado hasta F2; regla 5 en verde._

---

## Fase 1 — Auto-registro (`REGISTRY`) y migración de recursos

**Objetivo:** un recurso nuevo = 1 archivo en `schema/`; `getResourceSchema`
lee el registro, no un índice manual. _(§3, criterio F1 de §10.)_

- [x] **F1-1** Crear `00-registry.js` en la raíz (junto a `00-config.js`,
      **primero** en `filePushOrder`) con sólo la declaración del registro:
      `resources, types, enums, endpoints, ops, transforms, checks, handlers`.
      Cero lógica, cero referencias cruzadas (spike F0-3 define `const` vs
      `globalThis`). _(Decisión F0-3: `const REGISTRY`; confirmado en smoke.)_
- [x] **F1-2** Reubicar `schema/03-resources-*.js` →
      `schema/resources/{categories,products,site,legal}.js` (nombre de
      archivo = id del recurso).
- [x] **F1-3** Convertir cada uno a auto-registro top-level:
      `REGISTRY.resources.<id> = { … }` con el contenido **íntegro** de hoy
      (id, kind, keyField, titleField, ordering, fields, children, cache,
      views…), literales puros, resolución perezosa preservada.
- [x] **F1-4** Registrar tipos y enums: `schema/01-types.js` →
      `schema/types/01-types.js` asignando a `REGISTRY.types`;
      `schema/02-enums.js` → `schema/enums/02-enums.js` asignando a
      `REGISTRY.enums`. `05-aux-sheets` queda en sitio (fuera del §2; no
      aporta moverlo — anotar decisión). _(Ver decisión F1-4.)_
- [x] **F1-5** Reescribir `getResourceSchema(id)` →
      `REGISTRY.resources[id] ?? null` en runtime. Verificar todos los
      consumidores (grep `getResourceSchema`): router, engine, setup.
      _(Función vive en `00-registry.js`; 9 consumidores sin cambios de
      firma; `RESOURCE_REGISTRY` (5 iteradores) migrado a
      `Object.keys(REGISTRY.resources)`.)_
- [x] **F1-6** Eliminar `schema/04-registry.js` y su fila de `filePushOrder`.
      Antes: grep de quién lo referencia (debe ser sólo 10-router + 24-crud).
      _(grep posterior: 0 referencias — sólo mención histórica en MAPA/PLAN.)_
- [x] **F1-7** Actualizar `filePushOrder`: `00-registry` primero; resources y
      types/enums fuera de la lista manual según decisión F0-4 (globs o
      manifest). `setup/` y `engine/` siguen listados. _(Quedó: lista
      explícita de 27 — `00-registry` idx 0; `schema/resources/*` NO listados
      → suben alfabéticos al final, decisión F0-4.)_
- [x] **F1-8** Regresión estática: grep de exports viejos de los `03-*`
      (nombres de variables que consumían router/setup) ⇒ 0 usos; los 4
      resources presentes en `REGISTRY.resources`. _(Grep: 0 usos de
      `RESOURCE_REGISTRY`/`RESOURCE_*`/`04-registry` en código; api:check
      regla 5 verde.)_
- [x] **F1-9** Smoke de regresión (fixtures F0-2 idénticas). _(11/11 contra
      v6. **Hallazgo:** la URL sirve una versión fija — el push inicial no se
      reflejó hasta `clasp version` + `clasp deploy -i`; la primera corrida
      midió v3 por eso.)_
- [x] **F1-10** **Prueba del criterio**: crear
      `schema/resources/_prueba.js` temporal con un recurso mínimo →
      endpoints responden con **0** líneas editadas fuera de `schema/` →
      borrar el archivo. _(Evidencia: `git status -uall` antes/después = 1
      línea `?? api/schema/resources/_prueba.js`; `GET /admin/schema`
      expuso `_prueba` con proyección correcta en v4; borrado y republished.)_

**Criterio de aceptación F1** _(§10 F1)_

- [x] Alta de un recurso de prueba = 1 archivo, **0** líneas fuera de `schema/`
      (F1-10 evidenciado).
- [x] `04-registry` y los `03-resources-*` ya no existen.
- [x] `npm run api:check` (regla 5: schema con `REGISTRY`) en verde.
      _(Regla 1 sigue roja = 3 — es de F2, no bloquea F1.)_
- [x] Smokes ⇒ fixtures idénticas.

---

## Fase 2 — Rutas derivadas (adiós `EXTRA_ROUTES`)

**Objetivo:** el router no conoce ningún nombre ni de recurso ni de
endpoint. _(§4, criterio F2 de §10.)_

- [x] **F2-1** `resolveRoute_` construye la tabla **una vez por ejecución**
      (cache con flag por ejecución) recorriendo `REGISTRY`:
      resources → `/{scope}/{id}` y `/{scope}/{id}/{key}` (singleton sin
      `key`), endpoints declarados → su `route` + `method`.
      _(Implementado: `routeTable_()` con `ROUTE_TABLE_` (null por
      re-evaluación de ejecución); `exact` = endpoints + singletons,
      `keyed` = bases de colección.)_
- [x] **F2-2** Sacar `EXTRA_ROUTES` de `core/10-router.js`: los dos endpoints
      actuales (`/admin/schema`, `/admin/upload-signature`) pasan a
      `schema/endpoints/{schema,upload-signature}.js` con
      `REGISTRY.endpoints.<id> = { route, method, access, limits, handler }`
      (§9 — `access`/`limits` por ahora sólo como datos; consumirlos es F6).
- [x] **F2-3** Scope y ruta salen del resource (`scope: 'admin'` por defecto;
      `route` sólo si hay override). El router **no** concatena prefijos
      hardcodeados. _(Sin `path.indexOf('/admin/')` ni slice alguno.)_
- [x] **F2-4** Paridad de mapeo operación ↔ método lógico: documentar y
      hacer explícita la tabla actual (GET→list|get por presencia de `{key}`;
      POST→create; PUT→update (colección sin `key` con `reorder` ⇒
      reorderCollection_); PATCH→patch; DELETE→delete) — la misma semántica
      que hoy, ahora derivada de `operations`.
      _(Tabla explícita en el header del router; coincide línea a línea con
      `dispatchResource_`. Los resources aún no declaran bloque
      `operations` — eso llega con F5; hasta entonces ésta es la tabla
      por defecto del motor.)_
- [x] **F2-5** Destino de los handlers no-CRUD: mover `handleSchema` y
      `handleUploadSignature` a `primitives/handlers/` (§2 elimina la carpeta
      `routes/`) y dejar `routes/` vacío → borrar carpeta. _(Hecho; carpeta
      `routes/` eliminada. Decisión F2-5: `handleSchema` ya es 100%
      genérico desde F1 (recorre `REGISTRY.resources`) — se queda como
      handler declarado con nombre en el endpoint, sin código que
      generalizar.)_
- [x] **F2-6** Rutas de introspección automáticas: `/{scope}/schema`
      (resuelta por el registro de endpoints, sin código en el router).
- [x] **F2-7** Verificación estática:
      `grep -rnE "'/admin/|EXTRA_ROUTES|products|categories|upload-signature" api/core/10-router.js`
      ⇒ **0**; `grep -rn "resolveRoute_" api/core` ⇒ sólo router.
      _(Ambos en verde; `npm run api:check` exit=0 con las 2 reglas.)_
- [x] **F2-8** Regresión: matriz de rutas antes/después — smoke de **cada**
      ruta existente (detalle, listado, create, update, delete, reorder,
      schema, upload-signature) ⇒ fixtures idénticas.
      _(Matriz mutante 18/18 OK en v7 — create/list/detail/PUT/PATCH/
      reorder/DELETE en categorías y productos con restauración a `[]`
      == fixture; regresión 11/11 antes y después de la matriz.)_

**Criterio de aceptación F2** _(§10 F2)_

- [x] `10-router` sin nombres de recurso ni de endpoint (F2-7 en verde).
- [x] `EXTRA_ROUTES` eliminado; endpoints vivos en `schema/endpoints/`.
- [x] Smokes de todas las rutas ⇒ fixtures idénticas.

---

## Fase 3 — Consultas y vistas declarativas (`where/sort/limit`)

**Objetivo:** las reglas de catálogo se vuelven datos en el recurso;
`rules/31-catalog-rules.js` se borra con las mismas respuestas.
_(§5, criterio F3 de §10.)_

- [x] **F3-1** Crear `primitives/ops.js` con el registro de operadores
      genéricos: `eq neq in nin gt gte lt lte contains starts regex empty
  in-active exists` (+ soporte `value` | `from: '$item.x'` | `ref:`).
      _(Hecho: `REGISTRY.ops` con fn puras `fn(actual, expected)` — los
      booleanos pasan por `truthyCell_`, ordenados numérico- si-no-
      lexicográfico, `in-active` fail-closed sobre el mapa de hechos;
      `not: true` lo invierte el intérprete, no cada fn. Cero nombres de
      dominio.)_
- [x] **F3-2** Intérprete de `where/sort/limit` en el motor
      (nuevo `engine/27-views.js` o sección de `24-crud` — decisión por
      coherencia con `listWithRules_`): evalúa ops sobre ítems ya proyectados,
      con **fail-closed** en `ref`/`in-active` (categoría ausente ⇒ no
      publicable, como hoy).
      _(Decisión: **archivo nuevo `engine/27-views.js`** — se mudan
      `listWithRules_`/`readRulesCtx_`/aplicadores y se añaden
      `resolveViewWhere_` (extends con guard anti-ciclo), `evalWhere_` (AND),
      `sortItems_` y `applyDeclaredView_`; `24-crud` sólo llama
      `listWithRules_` en runtime. Operandos sin contexto ⇒ la condición
      falla sin invertir `not`. Ops unarias (`empty`/`exists`) sin operando.
      Fallas descubiertas en el primer despliegue: 500 por exigir operando
      a `empty` → fix en v9.)_
- [x] **F3-3** Migrar las 4 vistas de `products` a declaraciones en
      `schema/resources/products.js`: - `publishable` → `where: [status eq published, category_id in-active ref categories]` - `featured` → `extends: publishable` + sort + `limit: 6` - `related` → `extends: publishable` + `from: '$item.category_id'` +
      `neq: '$item.id'` + `limit: 4` - `hidden-with-reason` (R6) → **tarea de decisión**: intentar
      `where: [NOT publishable]`; si el `reason` (texto con motivo) no es
      expresable con ops ⇒ escape hatch §6: handler nombrado en
      `REGISTRY.handlers` con comentario de justificación. Anotar el
      resultado de la evaluación.
      _(Declaraciones reales = semántica actual, no el ejemplo genérico §5:
      publishable = `active eq true` + `registro_sanitario` no-empty +
      `category_slug in-active ref categories` + `images` no-empty;
      featured = extends + `featured eq true` + `limit: 6` (sin sort, para
      no alterar el orden de hoja); related = extends + `category_slug eq
  $item.category_slug` + `slug neq $item.slug` + `limit: 4`._
      _**Evaluación de hidden**: NO expresable con `where` (a) la población
      es **OR** de dos causas y `where` sólo evalúa AND, (b) anota `reasons`
      (salida enriquecida) ⇒ **escape hatch §6** confirmado: handler
      `hiddenList` en `primitives/handlers/hidden-list.js` con justificación
      y paridad literal de motivos (`inactive` | `missing_health_registry`,
      población sólo por active/registro).)_
- [x] **F3-4** Contexto: alinear `readRulesCtx_`/ctx `{categories, self}` con
      el modelo `ref:` (la resolución de `in-active ref` consume lo que hoy
      construye la Fase 8). Sin regress de valores.
      _(Sin cambio de valores: `readRulesCtx_` se mudó a `engine/27-views`
      con su construcción idéntica — `ctx[<recurso>] = { valor: activo }` es
      exactamente el mapa de hechos que consume `ref: 'categories'`, y
      `ctx.self` es la ancla que leen `from: '$item.x'`; comentario
      actualizado al modelo §5.)_
- [x] **F3-5** Contrato del front preservado: el payload
      `{ filter, view, key }` del listado sigue mapeando — `view: 'featured'`
      ⇒ vista declarada; `filter` legacy ⇒ traducir o mantener equivalente
      (anotar qué filtros nombrados existen hoy y su traducción).
      _(Contrato idéntico: mismas claves y MISMOS mensajes de error
      (`Filtro no disponible`, `Vista no disponible`, `No existe: <key>`) —
      verificado por fixtures de error. Filtros nombrados existentes: SÓLO
      `publishable` (en `resource.rules`) → ahora vive en
      `resource.views.publishable` y `filter` lo resuelve contra `views`
      (el front admin actual no envía filter/view — los filtros de su
      list-view son client-side; el contrato lo consume el front público
      futuro). Ampliación natural: `view: 'publishable'` ahora también
      responde 200 (antes 400) — está en §5.)_
- [x] **F3-6** `rules/30-registry`: quitar el kind `filter`/`view` del
      registro de funciones (deja de tener `featuredRule_` etc.); los kinds
      `computed`/`validator` siguen hasta F4.
      _(RULE_REGISTRY queda con `slug-from`, `no-placeholders`,
      `ruc-valid`; header actualizado. `resource.rules` de products =
      `['slug-from']` — `publishable` salió de `rules` para no romper
      `getRule_` → 500.)_
- [x] **F3-7** Eliminar `rules/31-catalog-rules.js` (+ su fila de
      `filePushOrder`).
      _(Borrado + fila fuera; para propagar el borrado remoto, el truco del
      watcher de F1/F2: `clasp push -w` + trigger temporal — verificado con
      `clasp pull` (rules/ remoto = 30, 32). `engine/27-views.js` y
      `primitives/ops.js` entraron a `filePushOrder`.)_
- [x] **F3-8** Verificación estática:
      `grep -rn "catalog-rules\|publishableRule_\|featuredRule_\|relatedRule_\|hiddenWithReason" api/`
      ⇒ **0**.
      _(0 hallazgos sobre `--include='*.js'` — los .md del plan documentan
      la migración por nombre; 33+2 js con `node --check` ✓, prettier ✓,
      `npm run api:check` exit=0 con ambas reglas — incluye el grep de
      regla 1 sobre `primitives/ops.js` y `hidden-list.js`: 0.)_
- [x] **F3-9** Regresión: fixtures de listado público (publishable/featured/
      related/hidden) ⇒ idénticas; si `hidden-with-reason` pasó a handler,
      justificación presente en código.
      _(Baseline efímero con seed determinista (14 productos + 2 categorías,
      una inactiva — script `f3-views.py`): **10/10 casos idénticos** entre
      v7 (antes) y v10 (después) — listado base, filter publishable,
      featured (limit 6 de 7), related con/sin ancla (limit 4), related con
      clave inexistente → 404, hidden con los 3 `reasons` correctos (d13 con
      cat inactiva queda FUERA, paridad R6), filter+view, y errores 400/400/ 400. **Regresión 11/11** en v10 + fixtures restaurados a `[]`._
      _Justificación §6 del handler: en `primitives/handlers/hidden-list.js`.)_

**Criterio de aceptación F3** _(§10 F3)_

- [x] `31-catalog-rules.js` borrado; vistas declaradas en el resource.
- [x] Mismas respuestas que antes (fixtures idénticas) — 10/10 vistas +
      11/11 regresión.
- [x] Ningún operador específico de catálogo en `primitives/ops.js`
      (grep de `publishable|featured` dentro de `primitives/` ⇒ 0 — son datos,
      no primitivas). _(Verificado en TODO `primitives/`, incluye handlers.)_

---

## Fase 4 — Validación y derivados: primitivas parametrizadas

**Objetivo:** `ruc-valid`, `no-placeholders` y `slug-from` dejan de ser
código de dominio: se vuelven usos de primitivas genéricas. _(§6, criterio F4
de §10.)_

- [x] **F4-1** Crear `primitives/transforms.js`: `slugify` con parámetros
      (`from`, `lower`, `sep`, `keep`) — extraído de `32-validators.js`.
      _(Hecho: `from` vive en la declaración `computed` (F4-3); el transform
      recibe `lower/sep/keep` con defaults = comportamiento canónico.
      Paridad exacta: 'Lomo Saltado Ñoño' → `lomo-saltado-nono`.)_
- [x] **F4-2** Crear `primitives/checks.js`: `pattern` (regex + mensaje
      parametrizable), `mod11` (weights, expected) y `not-in-sheet`
      (sheet, column, patterns) — parametrizados, cero nombres de dominio.
      _(Hecho; `pattern` suma `negate` — ver decisión F4-3.)_
- [x] **F4-3** Declaraciones en el schema que el motor interpreta: - `operations.create.computed: [{ field, transform, from }]` →
      `computeRules_` (migración de `slug-from` → `slugify` desde `name`). - `checks: [{ check, …params }]` a nivel campo o convalidación →
      `validatePayload_`/`23-validate` (migración de `ruc-valid` →
      `pattern: '^\\d{11}$'` + `mod11` con weights actuales; de
      `no-placeholders` → `not-in-sheet: { sheet: '_placeholders' }`).
      _(Hecho con desviación anotada en F4-3: no existen "weights
      actuales" — el validador previo sólo hacía pattern + anti-uniformes.)_
- [x] **F4-4** Recursos migrados: dónde vive hoy cada regla (grep de
      `rules:` en `schema/resources/*` y de `resource.rules` en el motor) →
      mover las 3 a `computed`/`checks` declarados y limpiar `resource.rules`
      de filter/validator legacy.
      _(Hecho: categories/products → `operations.create.computed`;
      legal → `checks: [not-in-sheet, pattern-negate]` (orden de error
      idéntico); site → `checks: [not-in-sheet]`. `resource.rules` ya no
      existe; grep de `rules:`/`resource.rules` ⇒ 0. Alineados `views: []`
      → `{}` en categories/legal/site según decisión F3-5.)_
- [x] **F4-5** `rules/30-registry`: los kinds `computed`/`validator`
      interpretan **declaraciones** (o se retira el registro y la
      resolución pasa al motor). **Decisión anotada** — con F4 el registro
      de reglas quedaría sin funciones propias → si queda vacío, eliminarlo.
      _(Vacío ⇒ eliminado con toda la carpeta `rules/`.)_
- [x] **F4-6** Escape hatch §6: queda documentado que
      `handlers: { … }` sólo aplica cuando una primitiva no llega; ningún
      handler de dominio nuevo sin justificación.
      _(Documento en `MAPA.md` §5: párrafo "Escape hatch §6" tras la
      checklist; `primitives/handlers/hidden-list.js` conserva su
      justificación escrita.)_
- [x] **F4-7** Eliminar `rules/32-validators.js` (+ fila de `filePushOrder`;
      si F4-5 vació `30-registry`, eliminar también ese archivo).
      _(Hecho: carpeta `rules/` borrada, ambas filas de `filePushOrder`
      quitadas y `primitives/transforms.js` + `primitives/checks.js`
      agregadas; borrados propagados con el workaround de `clasp push -w`
      + trigger, verificados con `clasp pull` a dir temp: 36 archivos,
      sin `rules/` ni trigger.)_
- [x] **F4-8** Verificación estática:
      `grep -rn "ruc-valid\|slugFromRule_\|noPlaceholdersRule_\|32-validators" api/`
      ⇒ **0**; `grep -rn "'(products|…)" api/primitives` ⇒ 0 (regla 1).
      _(Verde sobre `.js` ⇒ 0 (mismo criterio que F3-8); en docs sólo
      quedan la directriz `mejoras.md` y el texto histórico de planes.
      `node --check` 0 fallos, prettier ✓, `api:check` VERDE (Reglas 1 y 5).)_
- [x] **F4-9** Regresión de validación: fixtures de **422** ⇒ mismos
      `status`, mismos `errors[].path` (rutas con notación `images[0].image_url`
      intacta, criterio 8) y mismo `computed` (slug idéntico al crear).
      _(v10 vs v11 byte a byte: `legal-422`, `legal-pattern`, `site-422`
      (path `address.street`) y slug `lomo-saltado-nono` idénticos;
      singletons sin mutar; regresión 11/11 ✓; smoke extra: create de
      product → `producto-f4-smoke` + delete limpio. Publicación: v11.)_

**Criterio de aceptación F4** _(§10 F4)_

- [x] `32-validators.js` borrado (o reducido a declaraciones de primitivas,
      documentado). _(Borrado con toda `rules/`.)_
- [x] `ruc-valid`/`no-placeholders`/`slug-from` viven como **usos**
      parametrizados en el schema de sus recursos.
- [x] Smokes de validación ⇒ fixtures idénticas. _(Baseline v10 vs v11
      idéntico + regresión 11/11.)_

---

## Fase 5 — Forma de respuesta declarativa (`shape`)

**Objetivo:** cambiar la salida de un endpoint = editar sólo el schema.
_(§7, criterio F5 de §10.)_

- [x] **F5-1** Soporte de `shape` en el schema, por operación y por vista:
      `pick` (`'list' | 'full' | [campos]`), `rename`, `nest`, `include`,
      `envelope` (`plain | list{items,total}`).
- [x] **F5-2** `22-assemble`: `projectItem_` interpreta `shape` como única
      fuente de proyección; el `listProjection` actual de los recursos pasa a
      ser **equivalente interno** (se traduce a `shape` o se mantiene como
      fallback mientras no haya `shape` — anotar estrategia de transición y
      cuándo se quita el fallback).
- [x] **F5-3** `12-http` **no se toca**: `shape.envelope` modifica el payload
      que llega a `respond_`; el envoltorio éxito/error sigue siendo suyo
      (regla 4). Dejar el comentario correspondiente en el intérprete.
- [x] **F5-4** Aplicar `shape` real a al menos un recurso de prueba (p. ej.
      `pick` en el listado de `products`) y comprobar que el cambio se hace
      **sólo** en `schema/resources/products.js`.
- [x] **F5-5** Regresión: con `shape` presente ⇒ salida esperada; revertir a
      sin `shape` ⇒ fixtures idénticas (la ausencia de `shape` no cambia
      nada).

**Criterio de aceptación F5** _(§10 F5)_

- [x] Cambiar la respuesta de un endpoint = editar sólo el schema (F5-4
      evidenciado con el diff de 1 archivo).
- [x] `22-assemble` sin nombres de campo concretos (grep de campos de
      `resources/*` dentro de `22-assemble.js` ⇒ 0).
- [x] Smokes ⇒ idénticas salvo el recurso con `shape` declarado (documentado).

**Evidencia F5**: v12 (intérprete sin declaraciones) ⇒ regresión 11/11 +
vistas 10/10 byte a byte = "ausencia de shape ⇒ nada cambia"; v13 (shape en
products) ⇒ regresión 11/11 (fixture `products-list.json` ahora
`{items,total}`) + vistas == baseline + `brand` + envelope + smoke con datos
reales (pick exacto de 10 claves, `listPick` con 2 imágenes ⇒ sólo
position=1, detail sin acotar, `categories` sigue siendo arreglo). Test
efímero del intérprete: 38/38.

---

## Fase 6 — Políticas declarativas (`access`, `limits`, `cache`, `audit`)

**Objetivo:** permisos y límites salen del schema; el auth y el upload no
tienen números ni rutas hardcodeados. _(§8, criterio F6 de §10.)_

- [x] **F6-1** Bloque `policies` en cada resource: `access`
      (`read`/`write` por operación, default `admin`), `limits` (por
      operación/endpoint, `'10/min'`), `cache.ttl`, `audit`, `lock`.
      Migrar los 4 recursos actuales (hoy: `cache.ttlSeconds` existente →
      `policies.cache.ttl` + equivalencias).
      _(Hecho: los 4 recursos declaran `access`/`cache.ttl`/`audit`/`lock`;
      `policies.limits` está soportado por el motor (`normalizeLimits_`) pero
      los recursos no lo declaran hoy — ausencia = sin límite; el único límite
      real es el del endpoint upload. Top-level `audit`/`cache.ttlSeconds`
      eliminados.)_
- [x] **F6-2** `11-auth`: resolver el acceso por la política de la **ruta ya
      resuelta** (router pasa la política al auth), no por prefijo
      `/admin/*`. **Fail-closed**: ruta sin política ⇒ `admin`. Mantener
      401/400 actuales y el `scrubToken_` intacto.
      _(Hecho: `requireAccess_` en `11-auth`; `isAdminPath_` eliminado
      (grep ⇒ 0 en .js); el router resuelve primero sólo para leer la
      política y difiere los errores de resolución hasta DESPUÉS del auth —
      paridad exacta de códigos: 400 parseo → 401 → 400/404 → 429 →
      despacho. Ruta desconocida sin token ⇒ 401 antes que 404 (mismo orden
      que antes). Rol no admin ⇒ colapsa al token admin (sólo existe un
      token; sustituible en `requireAccess_` cuando haya roles)._
- [x] **F6-3** Rate-limit genérico único (implementado una vez, en
      `26-lock-cache` o módulo dedicado): parsea `'10/min'`, se aplica a
      operaciones y endpoints desde `policies.limits` (ventana por
      ejecución/CacheService — decisión técnica anotada).
- [x] **F6-4** Quitar `enforceSignatureRateLimit_` de
      `primitives/handlers` (upload): su límite pasa a
      `endpoints.uploadSignature.limits: '10/min'`. Idéntico
      comportamiento (11ª llamada ⇒ 429).
- [x] **F6-5** Pipeline de `24-crud`: `cache`/`audit`/`lock` leídos de
      `policies` (hoy `ttlOf_`, flags internos) — sin cambio de efectos:
      audit sigue yendo a `50-audit`, lock sigue en toda escritura.
      _(Hecho: `ttlOf_` lee `policies.cache.ttl`; `auditWrite_` lee
      `policies.audit`; las 5 escrituras pasan por `withPolicyLock_` —
      con lock salvo `policies.lock === false`.)_
- [x] **F6-6** Verificación estática: `grep -rn "isAdminPath_" api/` ⇒ sólo
      donde queda su uso legítimo (o 0 si se sustituyó); números
      hardcodeados de límites fuera del schema ⇒ 0 (`grep -rn "'10/min'"
api/` ⇒ sólo fixtures/schema).
      _(Verde: `isAdminPath_`/`UPLOAD_SIGNATURES_PER_MINUTE` ⇒ 0 en `.js`;
      `'10/min'` ⇒ sólo `schema/endpoints/upload-signature.js` + la
      directriz/docs; `CONFIG.UPLOAD_SIGNATURES_PER_MINUTE` eliminado.)_
- [x] **F6-7** Regresión: token malo ⇒ 401 igual; rutas sin política ⇒
      401 (fail-closed); upload al límite ⇒ 429 igual; escrituras ⇒ misma
      traza en `_audit_log`; TTL de caché ⇒ mismas lecturas cacheadas.

**Criterio de aceptación F6** _(§10 F6)_

- [x] `11-auth` y el handler de upload sin rutas ni números hardcodeados
      (F6-6 en verde).
- [x] Políticas declaradas en los 4 recursos y consumidas por el motor.
- [x] Smokes de auth/límites/audit/caché ⇒ fixtures idénticas.

**Evidencia F6**: test unitario efímero **41/41** (normalización de
políticas, `requireAccess_` (public/admin/rol/401), `parseLimitSpec_`
(10/min, 5/sec, 2/hour, roto ⇒ 500), `enforceRateLimit_` (10 OK + 11ª 429),
`withPolicyLock_`, `ttlOf_`, `auditWrite_`, y flujo `doPost` completo:
fail-closed 401→404, auth antes que 400 de clave, lectura pública, límite
del endpoint). **v14** publicado: regresión **11/11** (fixtures de error
idénticas: 400/401/404/422), `f6-smoke` **8/8** (ruta desconocida sin
token ⇒ 401; con token ⇒ 404; err-401/err-422 byte a byte; recurso inválido
en cuota ⇒ 400; **10 firmas OK + 11ª ⇒ 429** en ventana limpia; token malo
con cuota agotada ⇒ 401 — auth antes que límite), y E2E **22/22**
(`f5-verify`: seed de 14 productos, vistas, cleanup — ejercita escrituras
con audit+lock y lecturas con caché). Audit: gate unit-testeado
(`policies.audit` on/off) + ~20 escrituras E2E sin 500 (la hoja
`_audit_log` no está expuesta vía API, lectura directa no disponible).

---

## Fase 7 — `/schema` ampliado y front sin conocimiento de recursos

**Objetivo:** el front genera formularios y clientes desde el schema remoto.
_(§12 del contrato; criterio F7 de §10. Única fase que toca el front.)_

- [x] **F7-1** Ampliar `41-schema`: por recurso exponer además de `model` →
      `operations` (métodos y rutas efectivas), `views` (where/sort/limit como
      **metadatos públicos**, sin valores internos), `shape` (lo público:
      `pick`/`envelope`) y `policies.access` (lo mínimo para el menú/acciones).
      _(Hecho en `primitives/handlers/schema.js`: `projectOperations_` /
      `projectShape_` (whitelist `pick|include|rename|nest|envelope`) /
      `projectViews_` (sin `from`; `handler` ⇒ `{custom:true}`) /
      `projectPolicies_` (sólo `access`, fail-closed). Rutas efectivas vía
      `resourceRoute_` extraído en `core/10-router.js` (fuente única con
      `routeTable_`). Publicado en **v15**.)_
- [x] **F7-2** Mantener "nunca se publica" (§12): sin columnas internas, sin
      parámetros sensibles de primitivas, sin propiedades, sin token; `ref`
      de relaciones expuesto como metadato de relación, no como datos.
      _(Checklist §12 como asserts en el test de proyección: 0 fugas de
      internals sobre la salida completa.)_
- [x] **F7-3** Tipos del front: `schema-merge.ts`/`registry.ts`/`SchemaService`
      aceptan las claves nuevas (`operations`, `views`, `shape`,
      `policies`) — merge local-driven preservado (ausencia ⇒ conserva
      local, presencia ⇒ manda el remoto).
      _(Tipos en `schema.model.ts`; merge + sanitizadores en `schema-merge.ts`;
      `ApiService.list()` desenvuelve `{items,total}` ⇒ `T[]`; menú reactivo
      desde `allSchemas()` en `sidebar.ts`.)_
- [x] **F7-4** Criterio de "front sin recursos": un recurso **nuevo** del
      backend (crear `_prueba.js`) debe verse en el front (menú, listado,
      formulario) con **0** cambios en `src/` — verificar con el recurso de
      prueba y dejar evidencia.
      _(Ejecutado con `_prueba.js` temporal: (a) `f7-projection` **69/69** con
      el candado "salida del handler ⊆ fixture congelado";
      (b) `ng test` **15/15** — menú `Pruebas`, listado con columnas
      sintetizadas, formulario `Nueva Prueba`; (c) snapshot `src/` antes/después
      idéntico: `git status` igual y `git diff src/` hash
      `8e2e55396d645cf53341754a63f3e90b85857c7ac6ff4fc1a1d3b68df940e31e`
      = **0 cambios en `src/`**; (d) `_prueba.js` borrado y `api:check` verde
      tras el borrado. El recurso quedó congelado en
      `src/app/schemas/__fixtures__/remote-schema.ts`.)_
- [x] **F7-5** Alcance de vistas en UI: sólo lectura/mapeo (las vistas
      declaradas alimentan filtros/acciones del listado **si** ya existe el
      hook; no diseñar UI nueva en esta fase — anotar alcance real cumplido).
      _(Ver fila F7-5 de decisiones abajo: mapeo/lectura cumplido; sin hook
      de filtros en la UI ⇒ sin UI nueva.)_
- [x] **F7-6** Verificación front: `ng test` (2/2), `ng build` (dev) en
      verde; `npm run api:check` en verde.
      _(Resultado real: `ng test` **15/15** (5 archivos — se sumaron los specs
      de F7-4), `ng build` OK, `api:check` verde, regresión 11/11.)_
- [x] **F7-7** Regresión: `/admin/schema` actual (modelo) sigue siendo
      **subconjunto** del ampliado — el front viejo (si quedara) no se rompe.
      _(Assert "F7-7: fixture v14 ⊆ salida v15" dentro de los 69.)_

**Criterio de aceptación F7** _(§10 F7)_

- [x] El front se sirve de `/schema` sin tener que conocer recursos nuevos
      (F7-4 evidenciado con 0 diffs en `src/`).
- [x] `/schema` ampliado sin fugas de internals (F7-2 con checklist §12).
- [x] `ng test` + `ng build` + smokes ⇒ en verde.
      (15/15 + build OK + regresión 11/11 + f5-verify 22/22 + f6-smoke 8/8 en v15.)

---

## Fase P — Prueba de éxito final (§12)

**Objetivo:** demostrar la directriz de punta a punta con un recurso que
**no existía**.

- [x] **P-1** Crear **únicamente** `schema/resources/orders.js`: `model`
      (pocos campos: clave, estado, fechas), `operations: { list, get,
create }`, `views: { pending: { where: [status eq pending] } }`,
      `policies: { access, audit }`, `shape` en listado.
      _(Hecho: `orders.js` con clave `slug` única/inmutable, `status` con
      enum **inline** (decisión P-1 abajo), `event_date` + `created_at`
      (`computed: 'now'`), vista `pending` y `shape` con `pick` +
      `envelope: 'list'` en listado; prettier y `api:check` (regla 5) en
      verde.)_
- [x] **P-2** `clasp push` + `setup/03-setup-drift` ⇒ hoja `orders` creada
      automáticamente (columnas derivadas del schema, sin tocar `setup/`).
      _(Hecho: push + `clasp version "v16"` + deploy `-V 16`; `setupDrift`
      corrido **desde el editor** (decisión P-2 abajo) ⇒
      `{"ok":true,"createdSheets":["orders"],"schemaVersionChanged":true}`,
      `added: []` — sin tocar `setup/`. El live pasó de `500 «Falta la
      hoja: orders»` a 200.)_
- [x] **P-3** Smokes de `orders`: `GET` listado, `GET` detalle, `POST`
      create (con `computed` si aplica), `?view=pending`, validación con
      `errors[].path`, fila nueva en `_audit_log`, caché en 2ª lectura, y
      `/admin/schema` incluyendo `orders`.
      _(Hecho: **13/13** en v16 — listado `{items,total}`, 422
      `errors[0].path='slug'` (requerido y duplicado), create con
      `created_at` computado, detalle, 2ª lectura idéntica (misma clave de
      caché), `?view=pending` ⇒ sólo `ord-1001` (`ord-1002` es `paid`),
      vista desconocida ⇒ 400, update ⇒ `shipped`, `/admin/schema` en vivo
      **== proyección local**, `products` sin regresión, sin internals.
      **Audit con evidencia directa**: filas `create orders ord-1001`,
      `create orders ord-1002`, `update orders ord-1001` (20:23) + el
      `SCHEMA_VERSION` del drift en `_audit_log`; los 422 **no** auditan
      (correcto: sólo escrituras exitosas).)_
- [x] **P-4** **Cero ediciones** fuera de `schema/resources/orders.js`
      (evidencia: `git status` limpio salvo ese archivo).
      _(Hecho: manifest `find api src -type f` + `shasum -a 256` antes →
      después: **131 → 132 archivos, diff de exactamente 1 línea =
      `orders.js`**; `git status --porcelain` byte a byte idéntico. Tras
      el borrado: manifest de vuelta en 131.)_
- [x] **P-5** Cerrar: borrar `orders` (o dejarlo como ejemplo según
      decisión), actualizar `MAPA.md` (estructura final), `PLAN.md` (marcar
      F1–F7 + P) y este plan (todos los checkboxes + anotaciones de
      decisiones tomadas).
      _(Hecho: **decisión del usuario = borrar** ⇒ `orders.js` eliminado,
      push con workaround de borrados (watch + trigger temporal; `clasp
      push -f` no los propaga) verificado por pull de inspección (36
      archivos sin `orders`), deploy **v17**. Live: `/admin/schema` ⇒ sólo
      los 4 reales, `/admin/orders` ⇒ `404 «Ruta no encontrada»`,
      `api:check` verde (`categories legal products site`), **regresión
      11/11**. `MAPA.md`/`README` sin cambios por P (orders nunca se
      documentó). `PLAN.md` actualizado con el estado de las mejoras.
      La hoja `orders` queda en el libro como **huérfana** (el drift sólo
      la reporta: borrarla a mano desde Sheets si se desea). Guía de uso
      backend ↔ frontend: `doc/guia.md`.)_

**Criterio de aceptación P** _(§12)_

- [x] `orders` completo (endpoints, vista, validación, audit, caché,
      `/schema`) **sin editar ningún otro archivo**.
      _(Cumplido y luego retirado: prueba viva en v16 con evidencia P-4;
      recurso borrado en v17 por decisión del usuario. Todo el ciclo
      cerró con regresión 11/11 y manifest en 131.)_

---

## Registro de decisiones (se rellena durante la ejecución)

| Fase | Decisión                                                         | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F0-3 | `const REGISTRY` vs `globalThis`                                 | **`const REGISTRY` en `00-registry.js` primero** — doc oficial V8: todos los archivos en scope global + orden garantizado por filePushOrder. Confirmar con smoke en F1.                                                                                                                                                                                                                                                                                                                                        |
| F0-4 | `filePushOrder` parcial vs `schema/_manifest` + `sync-order`     | **filePushOrder parcial** — clasp 3.4.1 sólo ordena (`files.js:494-511`); los no-listados se suben después, en alfabético. `_manifest` descartado.                                                                                                                                                                                                                                                                                                                                                             |
| F0-5 | Despliegue: scriptId actual vs script de pruebas                 | **Directo al scriptId actual** (decisión del usuario): push por fase + smoke post-push; rollback = pull+push. _(Corregido en F1: la URL sirve una **versión fija** — `clasp push` sólo actualiza el HEAD; hay que `clasp version "…"` + `clasp deploy -i <deploymentId> -V <n>` tras cada push. Además clasp 3.4.1 **no propaga borrados** (`getChangedFiles` sólo mira locales): workaround = `clasp push -w` + trigger temporal.)                                                                            |
| F1-4 | `05-aux-sheets` queda en sitio (propuesto)                       | **Confirmado en sitio** — catálogo declarativo de hojas auxiliares; moverlo no aporta (queda como var independiente, no en REGISTRY).                                                                                                                                                                                                                                                                                                                                                                          |
| F1-5 | `const` top-level cruzado (spike F0-3)                           | **`const REGISTRY` en `00-registry.js` funciona** — confirmado en runtime GAS v8 con filePushOrder idx 0 (smokes F1-9/F1-10 en v4/v6).                                                                                                                                                                                                                                                                                                                                                                         |
| F2-5 | `handleSchema` genérico vs handler declarado                     | **Handler declarado con cuerpo 100% genérico** — desde F1 el handler sólo recorre `REGISTRY.resources`; vive en `primitives/handlers/schema.js`, su nombre va en `REGISTRY.endpoints.schema`. `routes/` eliminada.                                                                                                                                                                                                                                                                                             |
| F3-3 | `hidden-with-reason` con ops vs handler justificado              | **Escape hatch §6 confirmado** — (a) población = OR de dos causas y `where` sólo evalúa AND; (b) anota `reasons` (salida enriquecida). Handler `hiddenList` en `primitives/handlers/hidden-list.js` con justificación; paridad literal de motivos y población (sólo active/registro) verificada por baseline 10/10.                                                                                                                                                                                            |
| F3-5 | Traducción de `filter` legacy                                    | **Sin traducción necesaria** — único filtro nombrado: `publishable` (estaba en `resource.rules`) → ahora `resource.views.publishable`; `filter` resuelve contra `views`. Contrato `{filter, view, key}` y mensajes de error idénticos. El front admin NO envía filter/view (sus filtros son client-side); lo consume el front público futuro. `view: 'publishable'` amplía de 400 a 200 (§5). Nota: `views: []` de categories/legal/site es compatible (sin nombres ⇒ 400); alinear a `{}` en el deploy de F4. |
| F4-3 | `mod11` en `legal` vs anti-uniformes por `pattern`               | **Primitiva `mod11` creada, NO declarada** — el plan preveía "mod11 con weights actuales", pero no existen: el validador previo SÓLO hacía `^\d{11}$` (lo cubre el pattern declarativo del campo) + rechazo de uniformes, y documentaba por qué NO mod-11 (algoritmo oficial no verificado ⇒ falsos negativos bloquean datos reales). Declaración real: `pattern: '^(\\d)\\1{10}$'` + `negate: true` + mensaje. Paridad verificada por baseline (`Formato inválido` lo sigue emitiendo el pattern del campo, sin duplicar path). `mod11(weights, expected)` queda disponible en `primitives/checks.js` para cuando se verifique el algoritmo. |
| F4-5 | Destino de `30-registry` (interpretador vs eliminación)          | **Eliminado con toda la carpeta `rules/`** — con F4 los kinds `computed`/`validator` no tienen funciones propias: la resolución pasó al motor (`computeRules_` en `24-crud` lee `operations.create.computed`; `validatePayload_` lee `resource.checks`). Registro vacío ⇒ basura; grep de call sites (`validateRules_`, `getRule_`, `RULE_REGISTRY`) ⇒ 0 en `.js`. F4-7 confirmó el borrado en el deploy (clasp pull: 36 archivos, sin `rules/`). |
| F5-2 | Estrategia `listProjection` → `shape` (fallback, fecha de quita) | **Fallback en dos niveles, quitada en F7** — (a) `projectItem_`: sin `shape` de operación ⇒ legacy `listProjection` (comportamiento byte a byte, probado en v12); (b) `listLoadKeys_`: mismas claves para la carga de hijos. Cuando F7-1 amplíe `/schema` y F7-3/7-4 alinen el front (`api.list()` espera `T[]`; hoy con CERO usos), cada recurso declara `operations.list.shape` y el fallback se elimina. `listPick` primary se aplica SIEMPRE (con y sin shape). Fallback documentado en `22-assemble.js:9`, `24-crud.js:132` y `products.js:38`. |
| F6-3 | Mecanismo de rate-limit (ventana/almacén)                        | **Ventana fija deslizante en CacheService** — misma técnica que el limitador previo de firmas: contador `rl:<scope>:<grupo>:<spec>` con `put(ttl = ventana)` en CADA llamada (el TTL se renueva ⇒ ventana que se desliza mientras haya tráfico); sin lock (es control de uso, no seguridad). Spec `'<n>/<min|sec|hour>'`; spec roto ⇒ **500 visible** (no degrada a "sin límite"). Alcance: **scope de la ruta** (`endpoint:<id>` / `resource:<id>`) — el límite de upload pasó de 10/min **por recurso** a 10/min **por endpoint** (más estricto entre recursos; la paridad 11ª ⇒ 429 con un mismo recurso se verificó en v14). Implementado UNA vez en `26-lock-cache` (`enforceRateLimit_`), llamado por el router con la política ya resuelta. `upload-signature` quedó sin limitador propio. |
| F7-5 | Alcance real de vistas en UI                                     | **Sólo lectura/mapeo, cumplido sin UI nueva** — las `views` declaradas viajan como metadato público (`projectViews_`: `where/sort/limit/extends`; `handler` ⇒ `{custom:true}`) y quedan fusionadas en el schema efectivo (`mergeResourceSchema` + `remoteToSchema`: `schema.views` accesible para cualquier consumidor). **No** se alimentan filtros/acciones del listado: no existía el hook (`ListView` consume `schema.filters` local, client-side, y `ApiService` no expone consulta por `?view=`). Diseñar esa UI queda fuera de F7 (fase P / front público). |
| F7-1 | Diseño de la proyección ampliada                                | **Metadatos públicos por whitelist, jamás schema completo** — `projectOperations_` deriva rutas de `resourceRoute_` (fuente única, extraída de `routeTable_` en `core/10-router.js`) y sólo copia `shape` si la operación lo declara (whitelist `pick\|include\|rename\|nest\|envelope`); `projectPolicies_` publica únicamente `access` (cache/audit/lock/rate-limit NO viajan); `projectViews_` omite `from` y colapsa vistas con `handler` a `{custom:true}` (nombre y params son implementación). `from` de campos SÍ se proyecta (widget de slug del front). |
| F7-3 | Fallback `listProjection` (ver F5-2)                            | **NO se quitó en F7** — los recursos locales no declaran `operations.list.shape` (usan `listProjection` legacy); quitar el fallback en `projectItem_`/`listLoadKeys_` rompería el contrato byte a byte sin contrapartida (el front sólo necesita `shape` para sintetizar columnas de recursos **sólo-remotos**, caso cubierto por `_prueba`). Se elimina cuando cada recurso declare su `shape` (fase P). |
| F7-4 | Fixture congelado vs. 0-ediciones                               | **`_prueba.js` temporal, borrado tras la evidencia** — el recurso se congeló ANTES de borrarlo en `src/app/schemas/__fixtures__/remote-schema.ts` (fixture = salida real v15 + `_prueba`), con un candado activo en el test de proyección: si el fixture existe, la salida del handler debe ser ⊆ congelado (así un recurso nuevo del backend no exige editar el fixture para que el test pase, sólo para estrecharlo). |
| P-1   | `enum` inline vs. tocar `02-enums.js`                           | **Enum inline en el campo** — P-1 restringe a UN archivo (`orders.js`) y `schema/enums/02-enums.js` no es editable sin romper la evidencia P-4. El runtime lo soporta: `enumList_` acepta `Array.isArray(field.enum)` y `projectField_` lo proyecta; el front lo mapea a `options` (`remoteToSchema`). |
| P-2   | Cómo invocar `setupDrift` sin editor                             | **Sólo desde el editor** — `clasp run` y la Execution API por REST crudo devuelven `NOT_FOUND` server-side (proyecto no estándar en GCP). No se agregó endpoint de setup (rompería P-4). Corolario: el drift **sólo reporta** hojas/columnas huérfanas (`orphans`), **nunca las borra**. |
| P-3   | Evidencia de audit en P (más estricto que F6)                    | **Lectura directa de `_audit_log` por el usuario** — el §12 de P pide literalmente «fila nueva en `_audit_log`» (F6 aceptó escrituras sin 500 + gate unit-testeado). Se logró la fila directa: `create/update` de `orders` con actor `setup` a las 20:23; los 422 no auditan. |
| P-4   | Forma de probar «cero ediciones»                                 | **Manifest de hashes + `git status`** — `find api src -type f \| shasum -a 256` antes/después: 131→132 con diff exacto de 1 línea (`orders.js`); `git status --porcelain` idéntico. Más fuerte que git solo (api/ está untracked y colapsa en `?? api/`). |
| P-5   | Mantener `orders` como ejemplo vs. borrarlo                     | **Borrado (decisión del usuario)** — «ya están definidos los esquemas que necesito». Push del borrado con workaround (watch + trigger temporal; `clasp push -f` no propaga deletes) verificado por pull de inspección; deploy **v17**; 404 en `/admin/orders`; regresión 11/11; manifest de vuelta a 131. La hoja queda huérfana en el libro (borrado manual opcional). |
| P-6   | Fallback `listProjection` (ver F7-3)                             | **NO se quitó en P** — F7-3 preveía quitarlo «cuando cada recurso declare su `shape` (fase P)», pero P-1 restringe a `orders.js` sólo: los 4 recursos locales siguen con `listProjection` legacy y quitarlo ahora rompería el contrato byte a byte sin contrapartida. Se retira cuando los recursos locales declaren `shape` (fase front). |
| P-7   | Documento de uso backend ↔ frontend                              | **`doc/guia.md` nuevo (pedido explícito del usuario)** — guía de cómo usar el backend (envelope, crear recursos, setup, deploy, verificación), el front (arranque, auth, esquemas locales/remotos, rutas, CRUD) y cómo se conectan; link desde el `README.md` raíz (que era puro boilerplate de Angular). |
