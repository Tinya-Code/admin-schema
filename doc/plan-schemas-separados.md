# Plan — Dos schemas separados (sin intercambio en runtime)

> **Instrucciones para el agente**
>
> 1. Ejecuta las fases **en orden**. No abras una fase sin cerrar el criterio
>    de salida de la anterior.
> 2. Marca un checkbox solo cuando esté verificado (compila + tests + check
>    correspondiente en verde).
> 3. Reglas de código: `doc/structure.md` §2 (Angular 22) y §3 (nombres y
>    ubicación de archivos).
> 4. Commits convencionales: tipo en inglés, descripción en español, sin
>    atribución de IA. Un commit por unidad de trabajo al cerrar la fase.
> 5. Si una tarea revela un conflicto con lo acordado, detente y reporta
>    antes de improvisar.

---

## Modelo acordado

Dos instancias separadas que hablan **solo por HTTP de datos**:

- **Backend** (`api/schema/resources/*.js`): sus rutas y sus validaciones de
  integridad. No conoce a ningún frontend.
- **Frontend** (`src/app/schemas/*.schema.ts`): su UI, los endpoints que
  consume y su validación UX. **Nunca pide definiciones al backend.**
- **Contract check** (estático, en `api:check`): no es una conexión — es
  higiene del monorepo. Compara ambos lados y vuelve **rojo** si divergen.
  Se borra sin que la arquitectura se entere si algún día se separan los
  repos.
- **Consecuencias asumidas:**
  - Se pierde F7-4: un recurso nuevo del backend **no** aparece solo en el
    front — hay que declarar su `*.schema.ts`.
  - Cambiar una regla de validación exige tocar ambos lados; el contract
    check evita que la divergencia pase en silencio.
  - Apuntar el front a otro backend = cambiar `environment.apiUrl` (+ paths
    en `*.schema.ts` si difieren). Exponer el back a otro frontend = ya está,
    no hay nada que hacer.

### Decisiones abiertas (confirmar antes de empezar)

- [ ] **D1 — Destino de `/admin/schema`.** Recomendación: **conservarlo** como
      contrato legible (inspección, debug, clientes futuros). El admin ya no
      lo consume; no cambia la arquitectura. Afecta a la Fase 3.
- [x] **D2 — Alcance del contract check.** Recomendación:
      (a) ruta base del recurso, (b) `required` por campo, (c) validators
      declarados en ambos lados (`minLength`, `maxLength`, `pattern`, `min`,
      `max`, `unique`). Regla: para los campos que el front declara,
      cualquier divergencia con el back = rojo. Los campos `system` del back
      ausentes en el front (p. ej. `position`) **no** son divergencia.
      → Ejecutado en la Fase 1, ampliado: campo `required` del back ausente
      en el front = rojo; opcional ausente = aviso.
- [ ] **D3 — Auto-registro del front.** Recomendación: **sí**, con
      `import.meta.glob` + campo `menuOrder`, para cumplir «alta de módulo =
      1 archivo por lado». Si se prefiere no, la alta de módulo suma 1 línea
      en `registry.ts`. Afecta a la Fase 4.

---

## Fase 1 — Contract check estático

**Objetivo:** `npm run api:check` compara backend ↔ frontend y falla ante
cualquier divergencia. Se crea **primero** porque es el guarda que reemplaza
al merge runtime una vez que este desaparezca.

- [x] Crear `scripts/contract-check.mjs` (Node 24 ya instalado: v24.17.0):
  - [x] **Cargar el backend:** leer `api/schema/resources/*.js` y
        evaluarlos con un shim `globalThis.REGISTRY = { resources: {},
endpoints: {} }` (vía `new Function('REGISTRY', código)` o `node:vm`).
        Extraer por recurso: `id`, `kind`, `route`/`scope` (misma fórmula que
        `resourceRoute_`: `route || /<scope>/<id>`), y de `fields[]` cada
        `key`, `required` y validators (`minLength`, `maxLength`, `pattern`,
        `min`, `max`, `unique`).
  - [x] **Cargar el front:** importar `src/app/schemas/*.schema.ts` con el
        type stripping nativo de Node 24 (los `*.schema.ts` solo usan
        `import type` — verificado — así que se eliminan solos). Extraer
        `id`, `endpoint.*`, `keyField` y `fields[]` (`key`, `required`,
        `validators`).
  - [x] **Comparar** según D2: por cada recurso del front (1) que exista en
        el back, (2) ruta base del `endpoint` vs ruta efectiva del back,
        (3) por cada campo del front: `required` y validators vs el back.
        Además: campos `required` del back ausentes en el front = rojo
        (opcional = aviso); `system` y `extraColumns` fuera de alcance.
  - [x] **Salida:** hallazgos legibles (`recurso/campo: back=X front=Y`) y
        `exit 1` si hay divergencias; `exit 0` + resumen en verde si no.
  - [x] **Fallback:** no hizo falta — el type stripping importó los `.ts`
        sin problemas (el fallback a spec de vitest queda descartado).
- [x] Integrar en `scripts/api-check.sh` como último paso, antes del
      `exit $ROJO`, con `node scripts/contract-check.mjs`.
- [x] **Verificación positiva:** `npm run api:check` verde con el estado
      actual. Si sale rojo, el rojo es real: decidir qué lado gana y alinear
      **antes** de continuar. → Encontró 8 divergencias; ganó el back en las
      8 (el merge viejo ya las daba así: remote pisaba `required` y metía
      `unique`), alineadas en los `*.schema.ts` locales.
- [x] **Verificación negativa:** romper a propósito (p. ej. quitar
      `required: true` de `name` en `categories.schema.ts`) → check rojo con
      mensaje claro → revertir → verde.
- [x] `npm test` completo en verde (22/22).
- [x] Commit: `fix(front): alinear required y unique...` + `test(api): contract check que compara schemas back<->front` (2 unidades de trabajo).

**Criterio de salida:** `api:check` verde con el check activo y prueba
negativa demostrada.

---

## Fase 2 — Front: eliminar el intercambio en runtime

**Objetivo:** el front jamás pide definiciones al backend; solo quedan sus
schemas locales.

- [x] `src/app/app.config.ts`: quitar
      `provideAppInitializer(() => inject(SchemaService).load())` y los
      imports de `SchemaService` / `inject` si quedan sin uso.
- [x] Eliminar `src/app/core/services/schema.service.ts` (39 líneas).
- [x] Reescribir `src/app/schemas/registry.ts` (81 líneas):
  - [x] Quitar `remoteSchemas` (signal), `mergedSchemas` (computed),
        `setRemoteSchema` y los imports de `schema-merge`.
  - [x] Conservar la API pública **sin cambios de firma**: `schemas`,
        `getSchema()`, `allSchemas()` — sidebar, relation, resource-page,
        list-view y form-view no se tocan.
  - [x] `getSchema`/`allSchemas` leen directo del array de catálogo.
  - [x] Actualizar el JSDoc: catálogo estático, sin capa remota ni F7-4.
- [x] Eliminar:
  - [x] `src/app/schemas/schema-merge.ts` (537 líneas).
  - [x] `src/app/schemas/schema-merge.spec.ts` (137 líneas).
  - [x] `src/app/schemas/__fixtures__/remote-schema.ts` (672 líneas).
- [x] Reparar los specs que importan lo eliminado:
  - [x] `src/app/shell/sidebar/sidebar.spec.ts`: el primer test usa
        `setRemoteSchema` — reescribirlo para el catálogo estático (menú con
        los 4 recursos en orden y sus `href`s). El segundo test («sin schema
        remoto») pasa a describir el único camino: fusionarlo si aporta
        ruido.
  - [x] `src/app/pages/remote-resource.spec.ts` (86 líneas): **eliminar** —
        su premisa (recurso solo-remoto, F7-4) ya no existe. Anotar la
        pérdida de cobertura en el mensaje del commit.
- [x] Grep de limpieza: cero coincidencias en `src/` de
      `SchemaService|parseSchemaResponse|setRemoteSchema|mergeResourceSchema|remoteToSchema|RemoteResource|schema-merge|remote-schema`
      (el histórico en `doc/` se resuelve en la Fase 5).
- [x] `npm test` en verde → **14 tests reales** (22 − 5 merge − 2
      remote-resource − 1 sidebar = 14, como predijo el plan).
- [x] `npm run build` en verde.
- [x] Prettier sobre los archivos tocados.
- [x] Commit: `refactor(front): quitar el intercambio runtime de schema`.

**Criterio de salida:** grep limpio, tests y build verdes; el menú, las rutas
y los formularios funcionan igual que antes usando solo `*.schema.ts`.

---

## Fase 3 — Backend: destino de `/admin/schema` (según D1)

**Objetivo:** dejar documentado el rol del endpoint según la decisión D1.

- [x] **Si D1 = conservar (recomendado):** rama ejecutada.
  - [x] Actualizar el JSDoc de `api/primitives/handlers/schema.js`: el front
        ya **no** hace merge — el endpoint queda como contrato legible
        (inspección, debug, clientes futuros). Quitar toda mención a
        «fusionada por key» / «capa de presentación». → Hecho (header del
        archivo + comentario de `from`). Extra fuera de la lista original:
        `api/README.md` describe el mismo merge como vigente (párrafo
        «Front sin conocimiento de recursos») → renombrado a «Contrato
        legible (D1)». Los `PLAN*.md` son histórico: sin tocar.
  - [x] Sin cambio funcional → `api/fixtures/schema-get.json` **sin tocar**
        (lo confirma la regresión: 11/11 idénticos).
  - [x] Verificar `npm run api:check` (verde) y `./scripts/api-regression.sh`
        → **11/11 idénticos**. `node --check` OK.
  - [x] Commit: `docs(api): /admin/schema como contrato legible`.
- [ ] **Si D1 = retirar** (NO ejecutada — D1 = conservar): eliminar
      `api/primitives/handlers/schema.js`, la entrada de endpoint en
      `api/schema/endpoints/schema.js`, los flags `exposeToFront` de los 4
      resources, `api/fixtures/schema-get.json`, el `call schema-get` de
      `scripts/api-regression.sh` y las referencias en `doc/baseapi.md`.
      Re-ejecutar `api:check` + regresión (queda 10 llamadas).
- [x] **Ejecutar solo la rama elegida en D1, nunca ambas.** → sólo la rama conservar.

**Criterio de salida:** `api:check` + regresión verdes bajo la rama elegida.

---

## Fase 4 — Auto-registro del front (según D3)

**Objetivo:** alta de módulo = 1 archivo por lado (solo si D3 = sí).

**Resultado del probe (plan: «verificar que import.meta.glob compila en
ng build y en ng test»): NEGATIVO.** Compila sí, pero no transforma:

| Pipeline                   | Qué hace con el glob                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `ng build` (esbuild, prod) | Lo deja crudo → `TypeError` en el navegador; los `*.schema.ts` NO entran al bundle (`seo_title`: 0 en todos los chunks) |
| Dev server (`npm start`)   | Transforma a `Object.assign({})` **vacío** → catálogo sin schemas                                                       |
| `ng test` (vitest)         | Funciona → tests en verde                                                                                               |

Peor combinación posible: tests verdes y app rota (`app.routes.ts` hace
`schemas[0].id` con el catálogo vacío). Causa: `import.meta.glob` es un
transform de **Vite** (`importGlobPlugin`) y `@angular/build` no lo incluye —
no es config, es una feature que este bundler no tiene. El probe se revirtió
entero (repo verde antes de decidir).

- [x] **Decisión: D3 = no** (rama que el plan ya tenía escrita). El
      auto-registro se descarta; se gana la _intención_ de D3 con el check.
- [x] `registry.ts` explícito: imports estáticos de los 4 `*.schema.ts`,
      orden del array = orden del menú. **No se tocaron** `ResourceSchema`
      ni los 4 schemas (`menuOrder` queda innecesario).
- [x] Contract check ampliado: nuevo `checkRegistry()` — lee `registry.ts`
      como texto (no es importable en Node: sus imports van sin extensión),
      extrae los `./x.schema` y los compara con el disco **en ambas
      direcciones**. Archivo sin registrar ⇒ rojo; import huérfano ⇒ rojo.
- [x] Verificación positiva: `npm run api:check` verde (4 recursos,
      62 campos).
- [x] Verificación negativa (2 direcciones): creado `tmp.schema.ts` sin
      registrar ⇒ rojo «falta importar './tmp.schema'»; borrado ⇒ verde.
      Y un import a `ghost.schema` inexistente ⇒ rojo «no existe».
- [x] `npm test` en verde (14/14).
- [x] `doc/structure.md`: alta de módulo = 1 archivo + 1 línea, con el
      contract check como red.
- [x] Commit: `test(api): contract check exige registrar cada schema en registry`.

**Criterio de salida:** una alta olvidada en `registry.ts` sale rojo en
`api:check` en vez de perderse en silencio.

---

## Fase 5 — Documentación

**Objetivo:** la documentación describe el modelo de dos instancias, sin
mención al merge.

- [x] `doc/guia.md`:
  - [x] §0 «La idea en una frase» y el diagrama: sin flecha de
        `/admin/schema` al front; el front consume **datos**, no definiciones.
        Bonus: `RemoteResource` ya no existe → `ResourcePage` (bug preexistente
        del doc) y deploy v17 → v20 (también desactualizado).
  - [x] Tablas de endpoints: `/admin/schema` → «contrato legible (el admin
        **no** lo consume)». Quitado de la tabla de `ApiService.request`.
  - [x] §4 «Esquemas: local, remoto y merge» → «Esquemas: dos instancias
        separadas» (front declara UI/paths/UX; back declara rutas/reglas;
        contract check como sincronización; F7-4 retirado).
  - [x] Arranque (§4 y §5): fuera `appInitializer`/`setRemoteSchema`/merge —
        catálogo estático alimenta menú y rutas directo. §2 («recurso nuevo»)
        ahora dice que del lado del front hace falta el `*.schema.ts` +
        registro.
  - [x] Contract check y pérdida de F7-4 mencionados (§0, §4 y nota).
- [x] `doc/baseapi.md`: §12 reescrito («El schema del backend y el del
      front»: dos instancias + contract check + D1), `exposeToFront` con D1,
      paso 10 «Ajustar el front» → crear `*.schema.ts` y registrarlo.
      La línea 372 del plan (diagrama `41-schema`) **no necesita cambio**: el
      endpoint sigue existiendo.
- [x] `doc/structure.md`: hecho en la Fase 4 («1 archivo + 1 línea», D3 = no).
- [x] Grep final en `doc/`: `setRemoteSchema`, `appInitializer`, `merge`,
      `F7-4`, `fusiona`, `presentación local`, `RemoteResource`, `schema-merge`
      → única coincidencia: «**no hay merge**» en guia.md (negación, correcta)
      y 2 menciones de F7-4 que explican que **ya no existe**. El propio plan
      obviamente menciona lo que había que quitar.
- [x] Commit: `docs: modelo de dos schemas separados`.

**Criterio de salida:** grep de docs limpio; ningún texto describe el
intercambio runtime como vigente.

---

## Fase 6 — Verificación final y cierre

**Objetivo:** evidencia completa de que el modelo nuevo funciona de punta a
punta.

- [ ] `npm run api:check` (reglas + contract check) en verde.
- [ ] `npm test` en verde (total anotado).
- [ ] `npm run build` en verde.
- [ ] Prettier en verde (`npx prettier --check` sobre archivos modificados).
- [ ] `./scripts/api-regression.sh` 11/11 (requiere `api/.gas-smoke.env`).
- [ ] Smoke manual con backend real (`npm start`): menú con los 4 recursos,
      abrir cada formulario, validaciones de caracteres (intro ≥ 100,
      description ≥ 100), CRUD completo con toast, responsive (offcanvas).
- [ ] Smoke de puertoabilidad: cambiar `environment.apiUrl` a un backend
      inválido → la app arranca y renderiza desde los schemas locales (los
      datos fallan, la UI no).
- [ ] Deploy solo si las fases 3/4 tocaron código backend con efecto
      funcional: `npx clasp version "v21 - …"` +
      `npx clasp deploy -V 21` (si fueron solo comentarios/docs, el deploy
      queda a discreción).
- [ ] `mem_save` con la decisión final (modelo de dos schemas) +
      `mem_session_summary`.

**Criterio de salida:** todos los checks verdes, smoke aprobado, estado
persistido en memoria.

---

## Fuera de alcance

- Cambios en el CRUD backend, `23-validate.js` o las políticas.
- Migrar `api.service` a `httpResource` (imperativo a propósito).
- Auth guard / autenticación (hallazgo de la auditoría Angular 22, aparte).
- Refactors de Signal Forms o de los componentes de campo.
