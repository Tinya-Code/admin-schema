# Plan 2 — Refactor del motor hacia un sistema 100 % guiado por schemas

> **Objetivo:** una pantalla, un campo, un endpoint, un CRUD, una acción o un
> cálculo se crean **declarándolos**, no escribiendo vistas ni handlers
> sueltos. **Sólo se tocan schemas.**
>
> **Fuentes:** `doc/refactormotor.md` (mejoras F1–F10 / B1–B14) y
> `doc/auth.md` (autenticación, audiencias, overrides).
> **Absorbió** `doc/plan-motor-de-renderizado.md` (31 tareas, **borrado por
> D8** el 2026-10-06) — ver mapa §3.
>
> Precedido por `doc/plan-limpieza.md` (limpieza y decisión de arranque).

---

## Cómo ejecutar este plan

- **Una tarea a la vez.** Checkbox sólo tras su verificación.
- **Gates por tarea afectada:**

  ```bash
  npm test
  npm run test:api
  npm run api:check
  npm run build
  npx prettier --check . 2>&1    # ⚠️ warnings en stderr
  ```

- **Criterio de desempate (decisión del mantenedor, 2026-10-08).** Ante
  cualquier bifurcación técnica se elige **lo que deje el motor más limpio y
  consistente**, aunque cueste más trabajo. Una solución rápida que deja un
  `switch` o un `if` especial en un fichero compartido **pierde** frente al
  rediseño. Si una tarea chiquita requiere trabajo extra para que el motor
  quede bien, **se hace el trabajo extra** y se anota en §4 — no se parchea.
  (Procedencia: D32. No es «rediseñar siempre»: hay que poder articular por
  qué la opción limpia es mejor técnicamente.)
- **Reglas no negociables** (`refactormotor.md` §1 y `auth.md` §0):
  1. El **schema es dato puro** — serializable a JSON; la lógica se
     **referencia por nombre** y vive en un registro.
  2. **Abierto a extensión, cerrado a modificación** — añadir capacidad =
     1 archivo nuevo + 1 línea de registro. **Nunca editar el motor.**
  3. **Un registro por categoría, contrato uniforme:** `{ id, since, argsSchema, handler }`.
  4. **Fail-loud, no fail-silent** — romper en arranque/CI, no ignorar.
  5. **Solo aditivo** — nada cambia de significado; lo viejo se depreca con
     aviso, no se borra.
  6. **Dos schemas, jamás uno** — back y front son independientes; los une
     sólo `contract-check`.
  7. **Fail-closed** — ruta sin `access` ⇒ `role:admin`.
  8. **Los secretos nunca en Sheets ni en el front** — `PropertiesService`.
  9. **Gotcha zsh:** cita los flags (`grep --include='*.ts'`).

---

## ⚖️ Precedencia: `auth.md` manda sobre `refactormotor.md`

> **Jerarquía de autoridad (confirmada por el mantenedor):**
>
> 1. **`doc/auth.md`** — el **más reciente**. Sus reglas son las correcciones
>    e inconsistencias que se encontraron en `refactormotor.md`.
> 2. **`doc/refactormotor.md`** — base válida **donde `auth.md` no dice nada
>    en contra**.
>
> **Regla operativa:** donde los dos documentos difieran, **gana `auth.md`**.
> Lo que `auth.md` no toca, se mantiene de `refactormotor.md`.

### Overrides explícitos (`auth.md` §10)

**No son sugerencias: son correcciones.** Aplican aquí y no pueden saltarse:

| #      | En `refactormotor.md`                                                        | Corrección en `auth.md`                                                                                              |
| ------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **O1** | §5 Paso B: generar la mitad `DATA` del front desde `/admin/schema` (codegen) | **No unir `data` ni `ui`.** Dos schemas independientes + contrato vigilado **por consumidor** + audiencias           |
| **O2** | B2/B3 con rutas tipo `/orders/:id/...`                                       | **Rutas lógicas**: sin verbos HTTP ni `:id` en el path — la ruta lógica viaja en el cuerpo (`route`, `op`), como hoy |
| **O3** | B4/B12 con chequeos en cada ejecución                                        | Los chequeos pesados se hacen en **despliegue (Node) o a demanda**, nunca en cada request de Apps Script             |
| **O4** | B9 con `onError: 'rollback'`                                                 | **No hay rollback real en Sheets** → se usa **compensación**                                                         |
| **O5** | B14 con jobs, webhooks, notificaciones                                       | Sujetos a **triggers y cuotas de Apps Script**                                                                       |
| **O6** | —                                                                            | Añadir sección **A · Entorno y reglas inviolables** (Apps Script, Sheets, 3 componentes independientes)              |

### Tres precisiones que se desprenden de dar más peso a `auth.md`

- **O7 · El sobre de respuesta se conserva.** `auth.md` §4.5 es explícito:
  _«Si hoy ya existe un formato de respuesta, **se conserva** y sólo se añaden
  los códigos `AUTH_*`»_. Hoy `api/core/12-http.js` emite
  `{ error: { status, message, errors? } }` — **no se cambia a `{ ok:false }`**
  en el núcleo. La decisión exacta queda en D10-5.
- **O8 · `/p/...` NO se "corrige" a `/public/*`.** `auth.md` §2 contempla
  **tres superficies**, no dos: admin (`/admin/*`), público (`/public/*`) y
  **«flujos con credencial de recurso»** — pickpass ref+PIN, `access: public`
  con validación por `check`, **separado de la sesión**. Las rutas
  `/p/orders/:ref` y `/p/orders/:ref/pin` **son correctas** y la app pública
  (otro repo) las consume tal cual.
- **O9 · La nomenclatura de `auth.md` §6 se suma**, no sustituye, a la de
  `refactormotor.md` §2. Ver §5 de este documento.

**Reglas inviolables de `auth.md` §0** que gobiernan todo el plan:

1. Dos schemas, jamás uno — sólo los une `contract-check`.
2. Dos audiencias con reglas distintas: `admin` exige sesión · `public` nunca.
   Un token de una audiencia no vale en la otra (`aud`).
3. Fail-closed por defecto.
4. **Apps Script no autentica a nadie por nosotros** — todo es código nuestro.
5. Secretos sólo en `PropertiesService`; en la hoja, hashes.

---

## 0. Criterio de éxito

De `refactormotor.md` §6 — si añadir X obliga a editar `engine/`,
`FieldHost`, `WidgetHost` o una vista existente, **el motor no está
terminado**:

| Quiero añadir…          | Hoy                                          | Objetivo                                          |
| ----------------------- | -------------------------------------------- | ------------------------------------------------- |
| Tipo de campo (`color`) | componente + `Set` + `@case` + `FIELD_TYPES` | `field-color/` + `descriptor.ts` + 1 entrada back |
| Widget                  | componente + `Set` + `@case`                 | `widget-x/` + `descriptor.ts`                     |
| Acción (`duplicate`)    | `if` en list y detail                        | `actions/action-duplicate.ts`                     |
| Formato de columna      | `@case` en `list-view`                       | descriptor `column-format`                        |
| Recurso                 | schema front + back + hoja                   | 1 declaración `data` + 1 `ui`                     |
| Endpoint                | handler + ruta + política                    | 1 entrada con `input`/`output`                    |
| Operación de dominio    | handler a medida                             | 1 entrada en `actions`                            |
| Validador/computed/hook | código en `engine/`                          | 1 archivo en `capabilities/<categoria>/`          |
| Vista (kanban)          | no existe                                    | descriptor `view` + `views: [{type:'kanban'}]`    |
| Dashboard               | handler que arma `data[key]`                 | `widgets` + `aggregates` declarados               |

---

## Fase 0 — Punto de partida

**Objetivo:** línea base, decisiones de arranque y plan único.

- [x] **R0.1** — Confirmar `doc/plan-limpieza.md` cerrado ✅ **HECHO**
  - **Resultado:** **33/33** tareas, fases 1–6 marcadas, **12/12 decisiones**
    cerradas, 5 gates verdes, commit `a32c0e8` (2026-10-06).
  - **Hecho cuando:** Fases 1–6 del plan de limpieza marcadas y gates verdes. ✅

- [x] **R0.2** — Baseline de gates con cifras ✅ **HECHO**
  - **Pasos:** ejecutar los 5 gates; anotar en §7.
  - **Resultado:** §7 completada y **corregida** — el prettier figuraba
    «18 → 16»; el valor real es **17**.
  - **Hecho cuando:** §7 tiene los 5 resultados con fecha. ✅

- [x] **R0.3** — Resolver `refactormotor.md` §9 (6 decisiones) ✅ **HECHO**
  - **Resultado:** las 6 resueltas y escritas en **§6** (veredicto) y con la
    evidencia completa en `plan-limpieza §5.2`. **(3)** ya venía resuelta por
    **O1**: _dos schemas independientes + contrato por consumidor_.
  - **Hecho cuando:** las 6 están en §6.

- [x] **R0.4** — Resolver `auth.md` §9 (7 decisiones) ✅ **HECHO**
  - **Resultado:** las 7 resueltas y escritas en **§6**, con la evidencia
    completa en `plan-limpieza §5.1`. **(5)** resuelta por **O7** (sobre de
    respuesta conservado).
  - **Hecho cuando:** las 7 están en §6.

- [x] **R0.5** — Cerrar D8: absorción del plan anterior ✅ **RESUELTA**
  - **Decisión del mantenedor: absorber y borrar.** El mapa §3 ya cubre las
    31/31 tareas.
  - **Ejecutado:** `git rm doc/plan-motor-de-renderizado.md` + citas
    reparadas en `motor-renderizado-actual.md:7` y `refactormotor.md:4`.
  - **Hecho cuando:** no hay dos planes paralelos compitiendo. ✅

- [x] **R0.6** — Fijar nomenclatura vigente ✅ **HECHO**
  - **Pasos:** confirmar §5 con las tablas de `refactormotor.md` §2
    (identificadores, sufijos, archivos, funciones).
  - **Resultado:** §5 completa con **ambas** fuentes. **D9-2 fijada a
    `kebab-case`** (la fila y la nota de colisión estaban sin resolver).
  - **Hecho cuando:** quien escriba código tiene una referencia única. ✅

- [x] **R0.7** — Documentar los gates y el flujo de trabajo ✅ **HECHO**
  - **Archivo:** `README.md`
  - **Pasos:** tabla de comandos + aviso del `2>&1` de prettier.
    _(Absorbe T6.3.)_
  - **Resultado:** sección **«Gates»** añadida al inicio del `README` con los
    5 comandos, el aviso de `stderr` y el baseline con el aviso de **no
    reformatear la deuda**.
  - **Hecho cuando:** un agente nuevo sabe qué correr sin preguntar. ✅

- [x] **R0.8** — Inventario de consumo de endpoints ✅ **HECHO**
  - **Pasos:** evidencia archivo:línea para los 6 endpoints
    (`schema`, `uploadSignature`, `dashboard`, `events`, `publicOrder`,
    `pinVerify`). _(Absorbe T2.1.)_
  - **Evidencia y veredicto:**

    | Endpoint          | Registro back                                              | Consumidor front                                         | Veredicto                   |
    | ----------------- | ---------------------------------------------------------- | -------------------------------------------------------- | --------------------------- |
    | `schema`          | `endpoints/schema.js:10`                                   | 57 ficheros en `src/`                                    | ✅ vivo                     |
    | `dashboard`       | `endpoints/dashboard.js:8`                                 | 6 ficheros en `src/`                                     | ✅ vivo                     |
    | `uploadSignature` | `endpoints/upload-signature.js:10`                         | `upload.service.ts:49` (`POST /admin/upload-signature`)  | ✅ vivo                     |
    | `publicOrder`     | `endpoints/public-order.js:6`                              | **otro repo** — web pública `/p/…`                       | ✅ vivo por diseño (**D1**) |
    | `pinVerify`       | `endpoints/pin-verify.js:8`                                | **otro repo** — flujo público de PIN                     | ✅ vivo por diseño (**D1**) |
    | **`events`**      | `endpoints/events.js:10` + `primitives/handlers/events.js` | **ninguno** — no existe servicio de analíticas en `src/` | 🔴 **huérfano**             |

  - **Conclusión:** los 3 dudosos quedan con veredicto fundado. `publicOrder`
    y `pinVerify` **no son código muerto** — 0 en este front es lo esperado
    porque sirven a la web pública de otro repo. **`events` sí es huérfano**
    y está registrado como **D16** (§4): _retirar o justificar_.
  - **Hecho cuando:** los tres dudosos (`events`, `publicOrder`, `pinVerify`)
    tienen veredicto fundado. ✅

---

## Fase 1 — Red de seguridad

> **Es la primera por un motivo:** es lo que hace que todo lo demás sea
> reversible. Impacto muy alto, esfuerzo bajo-medio, riesgo bajo
> (`refactormotor.md` §8).

**Precondición:** Fase 0.

### 1.1 Fail-loud en la escritura (B4 — cierra R1/R2)

- [x] **R1.1** — `rowValues_` no puede descartar en silencio ✅
  - **Archivo:** `api/engine/21-repo.js` (`rowValues_`) y
    `api/engine/24-crud.js` (`setHeaderCell_`)
  - **Pasos:** si el payload trae una clave que `storageMap` espera y la hoja
    **no** tiene la columna → **error explícito** (422/500), no descarte.
  - **Verificación:** test que mande un campo sin columna y falle ruidoso.
  - **Hecho cuando:** imposible que un campo vuelva vacío por esta vía.
  - ✅ **Hecho en las DOS puntas de la cadena del bug `pin`:**
    - `rowValues_` (`21-repo.js:90`) devuelve **500** listando las claves de
      `flat` sin columna. 500 y no 422 porque falla el almacén (la hoja está
      desincronizada del schema), no el payload del cliente.
    - `setHeaderCell_` (`24-crud.js:755`) hacía `if (idx !== -1)`: si la
      columna no existía **se tragaba el valor en silencio**. Ahora tira 500
      con «Correr setupDrift».
  - **Spec:** `api/__tests__/row-values.spec.js` (5 tests) — 4 de ellos
    fallan con el fix revertido.

- [x] **R1.2** — `sheet-check` (drift schema ↔ hoja) ✅
  - **Archivo nuevo:** `scripts/sheet-drift-check.mjs`
  - **Pasos:**
    1. Comparar `storageMap_` de cada recurso con los headers reales.
    2. Reportar **faltantes y sobrantes**.
    3. ⚠️ **O3**: corre en Node/despliegue, **no** en cada ejecución de GAS.
    4. `clasp pull` a **directorio temporal** — `clasp pull --rootDir` no
       existe en clasp 3.4.1 y pisaría cambios.
  - **Verificación:** detecta un campo ficticio añadido a un recurso.
  - **Hecho cuando:** habría fallado antes de R1.
  - ✅ **Decisión del usuario: endpoint admin + script Node** (frente a
    `clasp pull`). El `NOT_FOUND` de `PLAN-MEJORAS.md:692` (P-2) aplica a
    `clasp run`/Execution API, **no a las rutas webapp**, así que el chequeo
    se expone como `GET /admin/sheet-drift` (`access: 'admin'`, handler
    `handleSheetDrift`) y el script lo consume con la **misma receta de
    `curl`** que `api-regression.sh` — no `fetch`, porque GAS devuelve 302.
  - **Archivos:** `api/schema/endpoints/sheet-drift.js`,
    `api/primitives/handlers/sheet-drift.js`,
    `scripts/sheet-drift-check.mjs` · script `npm run api:drift`.
  - `setupDrift(opts)` acepta **`{ dryRun: true }`**: ejecuta el mismo
    chequeo pero **no** crea hojas/columnas ni toca `SCHEMA_VERSION`.
    Rojo (exit 1) si `blocked`/`createdSheets`/`added`; amarillo si hay
    `orphans`; **aviso + exit 0** si faltan credenciales.
  - **Spec:** 4 tests en `api/__tests__/setup-flujo.spec.js`.
  - ⚠️ **Pendiente de verificación end-to-end:** el script sólo es
    comprobable contra un despliegue real (`clasp push` +
    `api/.gas-smoke.env`). Hoy sólo está verificado el handler.

- [x] **R1.3** — Respuesta desde lo escrito, no desde la relectura ✅
  - **Archivo:** `api/engine/24-crud.js` (`shapeResponse_` + `readDetail_`)
  - **Pasos:** construir la respuesta de `create/update` desde **lo escrito +
    computed**, y releer sólo para confirmar.
  - **Verificación:** test R6.2 (abajo) en verde.
  - **Hecho cuando:** un campo computado jamás vuelve vacío por fallo de
    lectura.
  - ✅ **Hecho:** `create` y `updateCollection_` responden desde
    `writtenEntry_(data.headers, row)` (`22-assemble.js:145`) en vez de
    `readDetail_`; `writeSingletonBlock_` ahora **devuelve** el flat escrito
    y `singletonDetail_` (`24-crud.js:91`) lo ensambla. `readDetail_` y
    `readSingletonDetail_` siguen atendiendo el GET.
  - **Spec:** `api/__tests__/write-response.spec.js` (5 tests), con
    `expect(out).toEqual(reread)` y los computados no vacíos.
  - ⚠️ **Nota:** la referencia «test R6.2 (abajo)» de este enunciado es
    colgante — R6.2 es «Agregaciones (B6)», no un test de esta tarea.

- [x] **R1.4** — `ensureColumns_` bajo flag explícito (opcional)
  - **Pasos:** crea columnas faltantes **nunca por defecto**; sólo con flag
    explícito. Si no, se omite y se documenta por qué.
  - **Hecho cuando:** decidido y registrado.
  - ✅ **Decisión: SE OMITE.** No existe `ensureColumns_` en la ruta de
    escritura — `21-repo`/`24-crud` no crean columnas en ningún punto, así
    que no hay nada que puertear. El único sitio que crea columnas es
    `setupDrift()` (`api/setup/03-setup-drift.js:40`), que **ya es** el flag
    explícito: función aparte, invocada a mano desde el editor y jamás desde
    un request (`PLAN-MEJORAS.md:692` — `clasp run`/Execution API devuelven
    `NOT_FOUND`). Meter creación automática en la ruta de escritura sería
    exactamente el auto-migrado silencioso que B4 prohíbe.
  - **Evidencia:** `grep -rn "insertColumn" api/` → sólo
    `setup/03-setup-drift.js:40` (más el stub del test). `setupDrift` no
    aparece en `primitives/`, `core/` ni `engine/` salvo en mensajes de
    error que mandan a correrlo.

### 1.2 Meta-schema (B12)

- [x] **R1.5** — `validateRegistry_()` al cargar ✅
  - **Archivo nuevo:** `api/schema/validate-registry.js`
  - **Checks:**
    1. claves desconocidas en recurso / policies / operation / campo →
       **error** (detecta typos)
    2. referencias rotas: `titleField`, `activeField`, `keyField`,
       `listProjection`, `dependents`, `relation` (recursivo dentro de
       `group`/`list`, no sólo a nivel raíz)
    3. identificadores inexistentes: `kind`, `type` de campo, `transform`,
       `check`, `hook`
    4. ~~`listProjection` ⊇ `listColumns` del front~~ → **no va acá**: exige
       el front. Vive en **R1.6, check 3**; este fichero sólo contiene
       verdad de back.
  - **Un solo código, dos sitios:** el `assert` va al final del fichero y
    dispara **al cargar**, tanto en GAS como en Node. En Node lo hace correr
    `scripts/contract-check.mjs`, cuyo `loadBackend()` ahora delega en
    `api/__tests__/_harness.js` — el cargador que ya usan los tests — para
    que las tres rutas (GAS, `test:api`, `api:check`) evalúen el mismo árbol
    en el mismo orden y ejecuten el mismo assert.
  - **Semántica que hizo falta descubrir** (no eran bugs, eran reglas mal
    puestas): `kind` tiene tres valores (`collection` · `singleton` ·
    `dashboard`); en un **singleton** `keyField` apunta a la columna `key`
    de la hoja KV (`24-crud.js:116` lo resuelve contra el flat escrito), no
    a un campo del schema; y un **descriptor** (`sheet: null`, el dashboard)
    no tiene filas, así que `keyField`/`titleField` son etiquetas del front.
  - **Verificación:** 9 mutaciones sobre recursos reales, todas en rojo con
    su mensaje exacto — clave, `kind`, `titleField`, `listProjection`,
    `dependents`, `type`, `transform`, `check`, `hook`.
  - **Spec:** `api/__tests__/validate-registry.spec.js` (15 tests): el
    registro real en verde + cada familia de fallo detectada. Verificado
    además que el propio spec se rompe si se rompe el validador.
  - **Hecho cuando:** los checks corren.

- [x] **R1.6** — `contract-check` ampliado _(absorbe T2.4)_ ✅
  - **Archivo:** `scripts/contract-check.mjs`
  - **Comparar además de `kind`/`endpoint`/`required`/`validators`:**
    1. `enum` (back) ↔ `options[].value` (front)
    2. `default` ↔ `default`
    3. `listProjection` (back) ⊇ `listColumns` (front)
    4. `postCreate.summaryFields` y `detail.headerFields` ⊆ campos declarados
  - **Verificación:** `npm run api:check` en verde con los 7 recursos.
  - **Hecho cuando:** si alguna diverge, se **documenta** en §6, no se parchea.
  - ✅ **Hecho** como checks 6–9 de `compareResource`. Tres precisiones que
    hizo falta descubrir sobre la forma real:
    - **`enum` en el back tiene DOS formas**: array literal
      (`orders.status: ['PENDIENTE', …]`) o el **nombre** de una lista en
      `REGISTRY.enums.sheetEnums` (`products.availability: 'availability'`,
      `site.days: 'days'`). Hay que resolver antes de comparar; un nombre
      colgado también es rojo.
    - **`postCreate` y `detail` sólo existen en el front**, no en el back —
      se validan contra los campos que declara el front.
    - **Lo que el back SIRVE en el listado es
      `operations.list.shape.pick` si está declarado, y si no,
      `listProjection`** (F5-2: «sin declaraciones ⇒ fallback»). Comparar
      contra `listProjection` a secas mentiría en `products`, que declara
      `pick` con `brand`, que no está en `listProjection`.
  - `loadBackend()` devuelve ahora el **REGISTRY completo** (no sólo
    `resources`) para poder resolver los enums con nombre.
  - **Ninguna divergencia real** entre los 7 recursos ⇒ §6 queda intacta.
  - **Verificación por mutación (5):** enum con array, enum con nombre,
    `default`, `listProjection` y `summaryFields` — las cinco en rojo con su
    mensaje exacto, y control en verde tras restaurar.

- [x] **R1.7** — Test de contrato del front (F9) ✅ — _ruta y alcance corregidos (D17)_
  - **Archivo nuevo:** `src/app/schemas/contract.spec.ts`
    (el plan decía `src/app/core/registry/contract.spec.ts`; **esa ruta no
    existe** — el registro real es `src/app/schemas/registry.ts`)
  - **Pasos:** recorrer `registry.ts` entero y verificar que cada
    `type`/`format`/`action` existe en su registro, que cada `*Field` apunta a
    un campo real y que cada `config` valida contra su `configSchema`.
  - **Hecho cuando:** un `type` inventado en cualquier schema **falla el
    test**.
  - ✅ **Hecho**, con tres precisiones que cambiaron el diseño:
    - **«un `type` inventado falla» ya lo garantiza `tsc`.** `FieldSchema`,
      `ListColumnFormat` y `ResourceAction` son uniones: meter
      `type: 'txt'` en un schema reviente con **TS2820** en `npm test` (el
      plugin `angular-compiler` type-chequea los specs) — verificado.
    - **El hueco real es el contrario**: un tipo **válido en TS y ausente
      del registro de runtime**. Ahí `tsc` pasa y la UI no pinta nada,
      porque el `@switch` de `field-host` **no tiene `@default`** y el gate
      `isSupportedFieldType()` se lo salta. Se cierra con un **tripwire de
      tipos en `field-host.ts`** (`as const satisfies readonly FieldType[]`
      - `Exclude<FieldType, …>`), que falla el build en ambas direcciones —
        verificado: quitar `'image'` ⇒ **TS2322**.
    - **La cláusula `configSchema` se descarta**: `grep -rn "configSchema"
src/` → 0 resultados. No existe nada que validar.
  - **Corrección sobre `format`:** el `@switch` de `list-view.ts` **SÍ tiene
    `@default`** (línea 301, `{{ cellText(...) }}`) — un formato sin `@case`
    degrada a texto, no se pierde. **No hay hueco que cerrar ahí.**
  - **Sí se cierra el de acciones:** `runAction` sólo ejecuta `copy-share`
    (y lo que tenga `urlTemplate`); `trigger-endpoint` está declarado en
    `ResourceAction` pero **no está implementado** y ningún schema lo usa.
    `ACCIONES_EJECUTADAS = ['copy-share']` convierte eso en rojo si alguien
    lo declara.
  - **Tests (4, en `contract.spec.ts`):** recorrido de tipos por todos los
    schemas (anidados incluidos) + acciones. Front: **151** (era 147).

### 1.3 Pruebas de regresión de los hallazgos

- [x] **R1.8** — Test e2e del mensaje compartido _(absorbe T6.1, cierra R4)_ ✅
  - **Archivo:** `src/app/schemas/orders.schema.spec.ts`
  - **Pasos:** partir de la **respuesta del back simulada** (con `pin`
    presente) y afirmar que el texto copiado termina con el PIN.
    **No** inyectar el PIN en la plantilla.
  - **Hecho cuando:** si el back deja de enviar `pin`, este test falla.
  - ✅ **Hecho**, con una precisión que cambió el test: se usaron las
    **firmas reales de los dos call sites**, no un objeto a mano.
    - **alta:** `interpolateTemplate(tpl, record, configValues)` —
      `post-create-modal.ts:129`
    - **lista:** `interpolateTemplate(tpl, buildInterpolationContext(row))` —
      `list-view.ts:717` (config + fila mezcladas)
    - La versión previa metía `public_base_url` dentro del mismo objeto, así
      que **no podía** fallar por culpa del back ni del call site.
  - **Mutación verificada:** sacar `pin` de la respuesta simulada →
    **1 failed** (`esperado` en línea 139/140). Restaurado → verde.
  - ✅ **Destapó D18 y ya está resuelta**: el test fiel a la firma del
    `alta` mostró que `public_base_url` nunca llegaba al modal de alta
    (enlace copiado sin dominio). Ver §4, D18 — decisión del usuario,
    `ConfigService` inyectado en el componente.
  - Front: **152** (era 147: 4 de R1.7 + 1 de D18).

- [x] **R1.9** — Test back: `create` → respuesta con `pin` _(absorbe T6.2, cierra R1)_ ✅
  - **Archivo:** `api/__tests__/pin-generate.spec.js` (**ya existía** con el
    transform, el hook, el circuito y `listProjection` — faltaba sólo la
    respuesta)
  - **Pasos:** además del transform y del hook, afirmar que la **respuesta**
    incluye `pin` no vacío.
  - **Hecho cuando:** R1 cubierto por test, no por inspección.
  - ✅ **Hecho** — sección 4 nueva, 3 tests:
    1. **La respuesta incluye `pin` no vacío** con un payload que NO lo
       trae (`{key, name}`) ⇒ sólo puede venir del computed.
    2. **`out.pin` == fila escrita == hash de `_pin`**: fija el invariante
       que necesita `pin-verify` — si la respuesta y `_pin` divergieran, se
       verificaría contra otro valor.
    3. **Columna `pin` ausente ⇒ FALLA RUIDOSAMENTE**: el escenario exacto
       de R1 (headers menos `pin`) ahora lanza en vez de descartar en
       silencio. `setHeaderCell_` ya no se traga el valor.
  - **Mutación verificada:** `operations.create.computed: []` → **6 failed**,
    incluidas las dos de R1.9. Restaurado → verde.
  - api: **176** (era 173).

- [x] **R1.10** — Degradación controlada de tipo desconocido (F9) ✅
  - **Front:** en dev, componente `UnknownRender` con aviso visible; en prod,
    se omite y se loguea. **Nunca pantalla rota.**
  - **Hecho cuando:** hay test para tipo desconocido.
  - ✅ **Hecho:**
    - `src/app/fields/unknown-render/unknown-render.ts` — aviso ámbar con el
      `type` y la etiqueta, y la aclaración de que **el valor existe en el
      schema y se conserva** (sólo no se dibuja). Sin `<label for>`: no hay
      `id` al que apuntar (mismo criterio que el bloque `composite()`).
    - `field-host.ts` — rama `@else if (showUnknown())` después del
      `@if (supported())`, `private readonly dev = isDevMode()` y un
      `effect()` que sólo en producción deja `console.warn`.
    - Spec nuevo `field-host.spec.ts` (**3 tests**): tipo desconocido pinta
      el aviso y NO pinta control · tipo del catálogo no lo pinta · campo
      **oculto** de tipo soportado cae en el mismo `@else` y no avisa.
  - **Mutación verificada:** `showUnknown = dev` (sin comprobar catálogo) →
    **1 failed** (el test del campo oculto). Restaurado → verde.
  - ⚠️ **Hallazgo que obligó a diseñar distinto:** `seedValue`
    (`shared/utils/seed.ts`) **no tiene `@default`** ⇒ un tipo desconocido se
    siembra `undefined` y Signal Forms **no le crea nodo**, así que
    `childTree` lanza «El formulario no contiene el campo». `showUnknown`
    por eso **no puede leer `state()`** — y sobrevive el mismo motivo por el
    que `supported()` no explota: el `&&` corta antes. El alcance de
    «nunca pantalla rota» es el **render**; `buildPayload` sí llamaría
    `childTree` de todos los fields y fallaría, pero ese estado no es
    alcanzable con `tsc` (el tripwire de R1.7 lo impide) y queda acá
    documentado en vez de parcheado.
  - Front: **155** (era 152).

- [x] **R1.11** — Gates de la fase ✅ **cerrada 2026-10-08**
  - **Comandos:** 5 gates + `sheet-check`.
  - **Hecho cuando:** todo verde.
  - **Estado: 6/6 verdes** ✅ — front **196** · api **390** · `api:check`
    VERDE (7 recursos, 84 campos) · build ✔ · prettier **17** (baseline) ·
    **`api:drift` VERDE** — «sin faltantes ni sobrantes».
  - **Diagnóstico del bloqueo (D23 — tres causas apiladas, ninguna era el
    token):**
    1. `GAS_URL` apuntaba al deployment **fijado a la versión 29**, no al
       `@HEAD` (el `@HEAD` devuelve HTML, no JSON) — por eso todo devolvía
       `401`.
    2. Ese despliegue era **anterior a Fase 2** ⇒ `401` **sin `code`** (hoy se
       emite siempre: «401 con `code`» prueba que ya trae Fase 2).
    3. **La hoja `_users` no existía** en el spreadsheet real ⇒
       `500 "El sistema de usuarios no está configurado"`.
  - **Cómo se resolvió:** `clasp push -f` + `version` + `redeploy` → **v32** ·
    D23 auto-login del humo · D24 `setupAll()` (una sola corrida en el editor) ·
    D25 reconciliación del admin (`contraseña ACTUALIZADA`) ·
    `npm run smoke:login` → **caché activa** (el token no cambia entre
    corridas) → `npm run api:drift` **VERDE**.
  - **Sin rotar credenciales** (que era lo que D22 dejó pendiente de
    autorización) y **sin `clasp push` en el chequeo** — `api:drift` no muta.
  - Queda R1.2 (verificación end-to-end) como pendiente de Fase 1, ajeno a
    los gates.

---

## Fase 2 — Autenticación

> `auth.md` §7 fases 1–3. **Por qué aquí:** sin roles no hay sentido para las
> políticas finas (F7) ni para `access: session`.

**Precondición:** Fase 1 (puede correr en paralelo — no comparte ficheros).

### 2.1 Núcleo (auth §7.1)

- [x] **R2.1** — Hoja `_users` ✅
  - **Columnas:** `id`, `email` (único), `name`, `role`, `active`,
    `token_version`, `pass_hash`, `pass_salt` (sólo opción B),
    `last_login_at`, `created_at`.
  - ⚠️ **Nunca expuesta** ni en admin ni en público.
  - ✅ **Hecho:**
    - `api/schema/05-aux-sheets.js` — `_users` añadido a `AUX_SHEETS` y al
      final de `AUX_SHEET_ORDER` (se crea en `setupSheets`, se compara en
      `setupDrift` vía `aux: AUX_SHEETS`).
    - Spec nuevo `api/__tests__/aux-users.spec.js` (**7 tests**).
  - **Alcance deliberado:** sólo la **hoja**. El recurso `users` y el tipo
    `secret` son **R7.6 (Fase 7)** — declarar el recurso hoy mandaría
    `pass_hash` a `/admin/schema`. `auth.md §4.2` ya trae el snippet pero
    es de Fase 7.
  - **Mutación verificada:** `REGISTRY.resources.users = {…}` válido →
    **3 failed** (NO-es-recurso · ningún-recurso-apunta · kind≠aux).
    Restaurado → 7/7.
  - ⚠️ **Hallazgo:** `assertRegistryValid_()` se ejecuta **al cargar**
    (`validate-registry.js:325`), así que una mutación malformada la atrapa
    el validador **antes** que cualquier test — la primera pasada de la
    mutación dio `7 skipped`, no `3 failed`. Si un día un spec da
    `skipped` masivo, revisar `beforeAll` y no el test.
  - Gates: api **176 → 183** · `api:check` VERDE · prettier **17**.

- [x] **R2.1b** — KDF de contraseña (D19; **va ANTES de R2.2**) ✅
  - **Por qué acá:** `bootstrapAdmin_` (R2.2) escribe `pass_hash` y
    `/auth/login` (R2.5) lo verifica; el KDF es el que calcula los dos.
    Mandado por `auth.md §9.1` («SHA-256 iterado con salt, **nunca SHA-256
    plano**») y `§4.6` («iteraciones ajustadas a lo que tolere el tiempo de
    ejecución»).
  - **Formato:** `pass_hash` guarda `s256$<iteraciones>$<hex>` ⇒
    **autocontenido**; subir el coste no rompe hashes viejos.
  - **Sal:** en la columna `pass_salt`, separada del hash (rotar sal no toca
    el coste ni el hash). Comparación **en tiempo constante** — ya existe
    `constantTimeEqual_` (`11-auth.js`).
  - **Coste:** `KDF_ITERATIONS` es una **propiedad generada por
    `setupAuth_()`** tras medir en el despliegue real. **No se fija en el
    código.** Sin ella ⇒ `Props.require` falla ⇒ imposible emitir o validar
    un hash sin haber medido.
  - **Hecho cuando:** hash y verificación funcionan, la verificación usa el
    recuento del propio hash (no el global), y falta `KDF_ITERATIONS` ⇒
    error claro.
  - ✅ **Hecho:**
    - `core/11-auth.js` — `KDF_ALGO`, `kdfIterations_`, `kdfNewSalt_`,
      `kdfHash_`, `kdfParse_`, `kdfVerify_`.
    - `00-config.js` — `KDF_BUDGET_MS: 400`, `KDF_ITERATIONS_MIN: 1000`,
      `KDF_ITERATIONS_MAX: 100000` + entrada `KDF_ITERATIONS` en
      `PROP_MANIFEST`.
    - `setup/05-setup-auth.js` — `medirKdf_` (calibra con un puñado de
      iteraciones, **ejecuta el candidato de verdad** y baja hasta entrar;
      4 pasadas máx.) + `cronometrarKdf_`.
  - **Regla de diseño:** sin reloj medible ⇒ **techo**, nunca suelo — un
    hash débil por prisa es peor que un login lento. Coste desbocado ⇒ se
    detiene en `MIN`, el suelo de seguridad gana al presupuesto.
  - **Hallazgo:** `parseInt('3.5')` devuelve `3` **sin quejarse** — una
    propiedad mal editada se tragaba en silencio. `kdfIterations_` ahora
    valida con `/^[0-9]+$/` antes de parsear (fail-closed, como todo el
    resto).
  - **Mutaciones verificadas:** recuento global en vez del del propio hash →
    **2 failed** (incluido el test que afirma el invariante). Restaurado →
    29/29.

- [x] **R2.2** — `setupAuth_()` y `bootstrapAdmin_()` ✅
  - **Pasos:** funciones **sólo ejecutables desde el editor de Apps Script**:
    generan `AUTH_SECRET` (+ `GOOGLE_CLIENT_ID`) en Script Properties y la
    fila inicial de admin.
  - ⚠️ **Nunca por endpoint.**
  - ✅ **Hecho:**
    - **Nuevo** `setup/05-setup-auth.js` — `setupAuth_()` (idempotente: si
      `AUTH_SECRET` y `KDF_ITERATIONS` ya existen **no los toca**; nunca
      loguea el secreto) y `bootstrapAdmin_()` (email del dueño por defecto,
      contraseña **generada y mostrada una sola vez**, `409` por duplicado,
      escribe la fila **por nombre de cabecera** no por posición).
    - **Nuevo guard** `EDITOR_ONLY_FNS = ['setupAuth_', 'bootstrapAdmin_']`
      en `core/10-router.js`, **lo primero** en `dispatchRoute_` ⇒ `403`.
    - **Validación al cargar** en `schema/validate-registry.js` —
      `validateRegistry_()` ahora también itera `REGISTRY.endpoints` y
      denuncia cualquier `handler` editor-only.
    - `00-config.js` — `AUTH_SECRET` (secret, generated) en `PROP_MANIFEST`.
    - `api/.clasp.json` — `filePushOrder` += `setup/05-setup-auth.js`.
  - **Hallazgo de fondo:** `REGISTRY.handlers` está **vacío y nadie lo
    puebla**, así que todo endpoint con `handler` dependía del fallback
    `globalThis[route.handler]`. «Nunca por endpoint» **sólo era cierto por
    suerte** — si alguien pusiera `setupAuth_` en un endpoint, el guard de
    `EDITOR_ONLY_FNS` es lo que lo bloquea. El chequeo al cargar añade la
    segunda barrera.
  - **Mutaciones verificadas:** guard desactivado → **1 failed**; chequeo al
    cargar desactivado → **1 failed**. Restaurados → 29/29.
  - **Hallazgo de tests:** el `beforeAll` de `validate-registry.js` corre al
    cargar, así que una mutación malformada da `7 skipped` (falla el
    `beforeAll`), no `failed`. Un spec con `skipped` masivo ⇒ mirar
    `beforeAll`, no el test.

- [x] **R2.3** — `issueToken_` / `verifyToken_` ✅
  - **Formato:** `base64url(payload) + '.' + base64url(HMAC-SHA256(AUTH_SECRET, …))`
  - **Payload:** `sub, sid, v, iat, exp, aud`.
  - **Requisitos:** HMAC con `Utilities.computeHmacSha256Signature` ·
    comparación en **tiempo constante** (no `===`) · `aud: 'admin'` ·
    TTL ≤ 6 h · **renovación deslizante** (< 25 % de vida ⇒ `meta.renewedToken`).
  - **Rol no viaja en el token** — se lee del snapshot.
  - ✅ **Hecho en `core/11-auth.js`** — `issueToken_`, `verifyToken_`,
    `renewMeta_` + helpers (`authSecret_`, `hmac_`, `bytesToB64Url_`…).
    Constantes en `00-config.js`: `TOKEN_TTL_HOURS: 6`,
    `SESSION_MAX_DAYS: 7`, `TOKEN_RENEW_RATIO: 0.25`.
  - **«El rol no viaja» es estructural, no una convención:** `issueToken_`
    recorta `claims` a una **whitelist** (`sub, sid, v, iat, exp, aud,
orig`). Un `role` pasado de más simplemente no aparece — no hace falta
    que nadie se acuerde de no meterlo.
  - **El payload lleva `orig`** — instante de nacimiento de la **sesión**
    (no del token), que arrastra cada token renovado. Así el **tope
    absoluto de 7 días (D10-2)** se cumple **sin estado en el servidor**: el
    token sigue autocontenido, como pide el título del §3.2. `issueToken_`
    además **recorta `exp`** a `orig + 7d`, de modo que nunca sale un token
    que sobreviva a la sesión aunque `renewMeta_` se salte el chequeo.
  - **La firma se comprueba ANTES de parsear** — nunca se interpreta JSON
    que todavía no está autenticado. `verifyToken_` devuelve un motivo
    estructurado (`malformed` · `bad_signature` · `bad_aud` · `expired`)
    para que R2.5 lo traduzca a `AUTH_INVALID`/`AUTH_EXPIRED` sin adivinar.
  - **Nuevo** `__tests__/token.spec.js` — **30 tests** (whitelist · firma ·
    audiencia · vigencia · renovación · tope). `Utilities` se reemplaza por
    un **doble fiel de Node** (mismo `base64url` y mismo HMAC-SHA256): el
    token que genera el código real lo valida una implementación ajena.
  - **Mutaciones verificadas — 4/4 detectadas:**
    | Mutación                                       | Test que la atrapa                       |
    | ---------------------------------------------- | ---------------------------------------- |
    | Firma movida **después** de parsear            | «la firma manda primero»                 |
    | Sin whitelist (`Object.assign({}, claims, …)`) | «un rol pasado no aparece»               |
    | Sin el tope de 7 días en `renewMeta_`          | «pasados los 7 días ⇒ no renueva»        |
    | Sin el recorte de `exp`                        | «un token con `orig` viejo NO sobrevive» |

- [x] **R2.4** — Niveles de `access` en `11-auth` (aditivo) ✅
  - **Valores:** `public` · `session` · `role:staff` · `role:admin` (alias
    `admin`) · **sin declarar ⇒ `role:admin`** (fail-closed).
  - **Hecho cuando:** los niveles actuales siguen valiendo.
  - ✅ **Hecho en `core/11-auth.js`** — `normalizeAccessLevel_`,
    `roleAllowed_`, `ACCESS_ROLE_RANK` + `requireAccess_` reescrito.
    Router: sólo cambia el comentario `// 401` → `// 401/403`.
  - **Aditivo de verdad:** el schema sólo declara `admin` y `public`, y
    ambos se resuelven **exactamente igual que antes**, con la misma forma
    de identidad (el token plano del envelope). Los niveles nuevos existen
    y resuelven, pero hoy nadie los declara.
  - **`requireAccess_` acepta DOS formas de identidad:**
    - `string` → el token actual: se verifica igual que siempre (**401** si
      no pasa) y se asume rol `admin`. Contrato intacto.
    - `{ role, active }` → identidad ya resuelta. **Es la forma que pasará
      R2.6** cuando la cadena de verificación lea el snapshot; se fija acá
      para que R2.6 tenga el contrato cerrado.
  - **Los niveles `role:*` son un MÍNIMO** (`admin ≥ staff`). De ahí que el
    token admin antiguo pase también por `role:staff` y que ningún nivel
    actual cambie de comportamiento.
  - **403 ≠ 401 (§4.5):** rol insuficiente ⇒ `403 FORBIDDEN` (el front
    muestra «sin permiso» **sin** cerrar sesión); usuario inactivo o
    identidad no establecida ⇒ `401 AUTH_INVALID` (limpiar sesión). Mezclar
    los dos rompería R2.9.
  - **Coincidencia exacta del vocabulario, sin ignorar mayúsculas** — ante
    ruido se cae al nivel más restrictivo, no se adivina. (De paso: la rama
    del alias `admin` es redundante con el default `role:admin`; se queda
    por documentar la intención de §4.4.)
  - **Nuevo** `__tests__/access.spec.js` — **28 tests**.
    _(En R2.6 pasó a **30**: la rama `string` de `requireAccess_` y
    `requireAdmin_` se retiraron, así que los tests que usaban el token
    admin plano ahora prueban identidad `{ role, active }` y hay un test
    nuevo que comprueba que esa forma ya no existe.)_
  - **Mutaciones verificadas — 4/4 detectadas:**
    | Mutación                                          | Test que la atrapa                      |
    | ------------------------------------------------- | --------------------------------------- |
    | Default vuelve `public` (deja de ser restrictivo) | «un nivel desconocido cae a role:admin» |
    | Roles con igualdad exacta en vez de mínimo        | «los niveles `role:*` son un MÍNIMO»    |
    | Rol insuficiente devuelve 401                     | «403 y NO 401»                          |
    | `active` distinto de `true` deja de ser 401       | «activo en falso ⇒ 401, no 403»         |

- [x] **R2.5** — Handlers `/auth/login`, `/auth/me`, `/auth/logout` ✅
  - **Declarativos** (B2): `input`/`access`/`limits` en `REGISTRY.endpoints`.
  - **Sobre de respuesta:** conservar el formato existente y **añadir**
    códigos `AUTH_REQUIRED`, `AUTH_INVALID`, `AUTH_EXPIRED`, `FORBIDDEN`,
    `RATE_LIMITED`.
  - **Cambio 1 — el `code` es aditivo (§4.5 / D10-5).**
    `respondError_`/`apiError_`/`errorResponse_` ganan un 4º parámetro
    opcional `code` → `error.code` en el envelope. **Sólo** los cinco
    códigos de sesión lo usan: 400/404/409/422/500 salen **idénticos** a
    como salían, y `{ ok: false }` sigue sin existir.
  - **Cambio 2 — dónde se pone cada código:**
    | Código                                                                | Sitio                                                                           |
    | --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
    | `AUTH_REQUIRED`                                                       | `requireAdmin_` sin token · `requireAccess_` sin identidad                      |
    | `AUTH_INVALID`                                                        | `requireAdmin_` con token erróneo · identidad `active !== true` · login fallido |
    | `AUTH_EXPIRED`                                                        | `throwTokenError_` ← `authCodeFor_('expired')`                                  |
    | `FORBIDDEN`                                                           | `requireAccess_` con rol insuficiente (403)                                     |
    | `RATE_LIMITED`                                                        | `enforceRateLimit_` (429)                                                       |
    | El mapeo motivo→código de `verifyToken_` vive en `TOKEN_REASON_CODES` |
    - `authCodeFor_` + `throwTokenError_`, **ya probado acá** aunque lo
      consuma la cadena de R2.6: así `AUTH_EXPIRED` no queda definido «en
      algún sitio» hasta la tarea siguiente.
  - **Cambio 3 — cuatro convenciones del código ganan sobre el snippet de
    §4.3** (documentadas en el propio fichero, no improvisadas):
    1. id camelCase + `route`/`method` explícitos, no clave de path.
    2. `limits: '10/min'`, **no** `{ perMinute: 10 }` — esta última forma
       la normaliza `normalizeLimits_` a `null` y **el límite no existiría**.
    3. sin `idToken`: §9.1 eligió la opción B y descartó Google.
    4. `handler: 'handleAuthLogin'`, no `authLogin`: los 7 endpoints del
       repo usan `handle` + endpointId.
  - **`authMe`/`authLogout` no verifican nada por su cuenta.** Su contrato
    es «devolver lo que la cadena ya validó» (`request.user`) o **401** si
    no hay identidad resuelta. Esa verificación es la cadena de §3.4
    (**R2.6**) y duplicarla acá sería una segunda regla que se le
    contradice en cuanto cambie una de las siete etapas. Consecuencia
    explícita: **hasta R2.6, `/auth/me` y `/auth/logout` responden 401
    para cualquier token**, incluido el admin antiguo (que no tiene fila en
    `_users`). Ver **D21**.
  - **`publicUser_` es una WHITELIST, no un `delete`** — `id, email, name,
role, active, last_login_at, created_at`. Si mañana se añade una
    columna a `_users`, no sale sola. Deja `pass_hash`, `pass_salt` y
    `token_version` fuera (R2.17) **antes** de que R2.17 exista.
  - **Nuevo** `primitives/handlers/auth.js` (auto-registra los 3 en
    `REGISTRY.handlers`), `schema/endpoints/auth.js` y
    `__tests__/auth-endpoints.spec.js` — **30 tests**.
    _(En R2.6 pasó a **31**: los dos tests que llamaban a
    `requireAdmin_` ahora llaman a `verifySession_` con el mismo código
    esperado, y se añadió el que verifica que `requireAdmin_`,
    `Props.hashToken`, `rotarToken` y `ADMIN_TOKEN_HASH` ya no existen.)_
  - **Mutaciones verificadas — 7/7 detectadas:**
    | Mutación                                 | Test que la atrapa                       |
    | ---------------------------------------- | ---------------------------------------- |
    | `respondError_` deja de proyectar `code` | «errorResponse_ proyecta el code»        |
    | Login sin comprobar `kdfVerify_`         | «contraseña errónea → mismo estado»      |
    | `requireAdmin_` no distingue 401         | «token erróneo → AUTH_INVALID»           |
    | `authCodeFor_` pierde `AUTH_EXPIRED`     | «mapea cada motivo» + «throwTokenError_» |
    | `publicUser_` con `delete` (filtra mal)  | «NUNCA lleva pass_hash…»                 |
    | Login sin chequear `active`              | «cuenta desactivada → mismo estado»      |
    | Mensaje de login filtrando el email      | «mismo estado, código y mensaje» (×3)    |
  - **Gates:** front **155** · api **300** · `api:check` VERDE · build ✔ ·
    prettier **17**.

- [x] **R2.6** — Cadena de verificación por request (auth §3.4) ✅
  - **Pasos, en orden:** firma HMAC → `exp` + `aud` → `sid` no revocado →
    snapshot (`active`, `v == token_version`) → resolver `access` → ejecutar
    → renovación si la vida es corta.
  - **Implementado en `core/11-auth.js`** (bloque «Cadena de verificación
    por request»): `verifySession_(token)` devuelve `{ payload, user }` o
    lanza 401 con el código de §4.5 — **el mensaje es SIEMPRE el mismo** y el
    motivo exacto vive sólo en el código, para no regalar información a
    quien pruebe tokens ajenos. Componen el paso: `sidRevoked_` (lee
    `CacheService.revoked:<sid>`), `readUsers_`, `snapshotUser_`,
    `findUserByEmail_` (movido acá desde `primitives/handlers/auth.js`) y
    `throwTokenError_` (R2.5) para los pasos 1–2.
  - **Cableado en `core/10-router.js`**: `doPost` calcula
    `accessLevel = normalizeAccessLevel_(policyAccess_(policy, group))` y
    sólo llama `verifySession_` cuando no es `public`; `requireAccess_(…)`
    queda **en la misma posición que antes** ⇒ el 401 sigue por delante de
    cualquier 400/404 (hay tests de orden). `dispatchRoute_(route, envelope,
session)` pone `request.user` / `request.sid` y arranca con
    `session = session || null`, así que las llamadas de 2 argumentos que
    usan el editor y los tests de R2.5 significan «sin identidad», no
    «excepción». `withRenewal_(result, session)` añade
    `result.meta = { renewedToken }` sólo si `renewMeta_` lo devuelve:
    **añade una clave, jamás cambia la forma** de la respuesta.
  - **D21-C — retiro completo del token admin (D21.1, orden 2).** Se borró
    **en el mismo cambio que la cadena**, de modo que el sistema nunca
    convivió con dos credenciales en paralelo:

        | Qué se borró                                                | Dónde                                    |
        | ----------------------------------------------------------- | ---------------------------------------- |
        | `requireAdmin_` (la rama `string` de `requireAccess_` ya no existe) | `core/11-auth.js`                  |
        | `ADMIN_TOKEN_HASH` del `PROP_MANIFEST`                        | `00-config.js`                           |
        | rama `entry.generator === 'token'` y `rotarToken()`           | `setup/00-check-properties.js`           |
        | `Props.hashToken`                                             | `core/13-props.js`                       |
        | `findUserByEmail_` (se mudó, no se borró)                     | `primitives/handlers/auth.js` → `core/11-auth.js` |

    **Sigue declarado pero inerte** `ADMIN_TOKEN` en el front
    (`app.config.ts`, `api.service.spec.ts`): **R2.12** lo retira del lado
    cliente. Hasta entonces **no hay sesión en el navegador**, que es
    exactamente lo que autorizó D21.1 (orden 2). El admin recupera acceso
    con `/auth/login` + contraseña desde el commit de R2.6.

  - **Coste hoy: 1 lectura de `_users` por request protegido.** El
    «coste típico 0 lecturas» del apartado _Hecho cuando_ es **R2.15**
    (cache de 60 s) y todavía no se cumple. La **escritura** de
    `revoked:<sid>` es **R2.16**: aquí sólo se lee.
  - **Spec nuevo:** `api/__tests__/auth-session.spec.js` (**23 tests**) —
    cadena de punta a punta por `doPost`, código exacto por paso, orden
    401→404, y renovación deslizante con/sin `meta`.
  - **Mutaciones 7/7** (script temporal, fuera del repo): `sidRevoked_`
    deja de leer · `verifySession_` sin `active` · sin `token_version` ·
    `withRenewal_` sin `meta` · `dispatchRoute_` sin `request.user` ·
    `requireAccess_` con `null` fall-open · router que resuelve antes del
    auth. **La primera tanda detectó 6/7**: `verifySession_` sin `active`
    se colaba porque `requireAccess_` repite el chequeo y sólo se había
    probado por `doPost`. Se añadió el test que aísla el paso 4 — evidencia
    por paso, no por resultado.
  - **Gates:** front **155** · api **326** · `api:check` VERDE · build ✔ ·
    prettier **17**.

### 2.2 Front (auth §7.2)

- [x] **R2.7** — `AuthService` (signals)
  - **Estado:** `user`, `token`, `isAuthenticated`, `login()`, `logout()`,
    `applyRenewedToken()`.
  - **Hecho:** `src/app/core/services/auth.service.ts` (nuevo, `@Service()`)
    con señales `user` / `token` / `isAuthenticated` / `role` / `returnUrl`,
    `login()` / `logout()` / `restore()` / `applyRenewedToken()` y
    `applyAuthCode()`. **NO inyecta `ApiService`**: el `ApiService` inyecta a
    éste para leer el token, y el ciclo de DI de Angular revienta en el
    arranque, no avisa. Inyecta sólo `HttpClient` + `API_URL` + `Router`.
    `logout()` cierra la sesión en `next` **y** en `error` (best-effort §9.7).
    `restore()` corre desde `provideAppInitializer` en `app.config.ts`, tras
    el `load` de `ConfigService`: revalida contra `/auth/me` antes del primer
    render. Spec `auth.service.spec.ts`.

- [x] **R2.8** — Interceptor de transporte
  - **Pasos:** envolver cada petición en
    `{ route, op, token, payload }` con `Content-Type: text/plain` y **sin
    cabeceras personalizadas** (evita preflight CORS); leer
    `meta.renewedToken`.
  - ⚠️ **Todo autenticado por POST** — nada de tokens en URL/GET.
  - **Hecho:** `api.service.ts` envuelve en
    `{ token, method, path, payload }` — **las claves del código ganan sobre
    las de `auth.md §5.2`**, el mismo precedente que fijó R2.5 para §4.3
    (nota en la cabecera del fichero). `Content-Type: text/plain` ⇒ simple
    request, sin preflight; el token sólo viaja en el cuerpo de un POST.
    `meta.renewedToken` se aplica con `renewedTokenOf()` de `api.model.ts`
    (helper ahí y no en el servicio para no crear un ciclo de imports).
    `AuthService` comparte el mismo transporte por `post()` — tres endpoints
    de sesión, idéntico contrato.

- [x] **R2.9** — Manejo centralizado de `AUTH_*`
  - **Archivo:** interceptor/manejador de errores — **un solo lugar** interpreta
    la tabla de códigos (login / limpiar sesión / «sin permiso» sin cerrar
    sesión / espera).
  - **Hecho:** `api-error.interceptor.ts` extrae `body.error.code` y hace
    **una sola llamada** a `auth.applyAuthCode(code)`; `ApiError` lleva el
    `code` como 4º parámetro. `applyAuthCode` es el ÚNICO intérprete de la
    tabla de §4.5: `AUTH_REQUIRED` / `AUTH_INVALID` limpian sesión,`
`AUTH_EXPIRED`guarda`returnUrl`y limpia,`FORBIDDEN`y`RATE_LIMITED`no tocan la sesión. Las cinco filas están probadas una a una en`auth.service.spec.ts`; el puente interceptor → servicio, en
`api-error.interceptor.spec.ts`.

- [x] **R2.10** — Guards
  - **`authGuard`, `roleGuard`** sobre las rutas generadas desde
    `registry.ts` (`shell.routes.ts`).
  - Menú filtrado por rol (**sólo UX** — la seguridad real es del back).
  - **Hecho:** `src/app/core/guards/auth.guard.ts`. `authGuard` va en
    `app.routes.ts` sobre el shell lazy (todo lo autenticado);
    `roleGuard` en las **4** rutas con `:id` de `shell.routes.ts`. El
    criterio es `AuthService.canAccess(access)`, que acepta las dos formas de
    §4.4/§5.3 (`requires: 'role:admin'` y `roles: ['admin']`) — mismo dato
    visto desde el nivel de acceso y desde el recurso. `roleGuard` ante un
    `:id` desconocido devuelve `true`: decidir «acceso» sobre un recurso que
    el registry no conoce sería inventar política que ningún schema declaró.
    `ResourceSchema.access?: ResourceAccess` es opcional y **ningún schema
    lo declara todavía** (sólo existe `admin`, §9.4) — el filtro queda cableado
    y probado, declarativamente inerte. Menú filtrado en `sidebar.ts`.
    Specs: `auth.guard.spec.ts`, `sidebar.spec.ts`, `canAccess` en
    `auth.service.spec.ts`.

- [x] **R2.11** — Pantalla de login declarada (`authSchema`)
  - **Pieza nueva** en el schema del front: `providers`, `loginFields`,
    `redirectAfterLogin`, `rememberMe`.
  - **Requisito (F1):** `contract-check` verifica que las claves de
    `loginFields` existan en el `input` de `/auth/login`.
  - **Hecho:** `src/app/schemas/auth.schema.ts` + tipos `AuthSchema` /
    `AuthFieldDeclaration` en `schema.model.ts`, re-export en `registry.ts`.
    **Check 10** en `scripts/contract-check.mjs`, bidireccional (clave del
    front que el back no espera y al revés) + `rememberMe === false` +
    `providers` no vacío. `loadFrontend()` salta `auth` por nombre: es un
    schema del front que **no es recurso** (sin `id` ni `fields`). Ruta
    `/login` en `app.routes.ts` **fuera** del shell — si viviera dentro,
    `authGuard` bloquearía el propio login. `pages/login/login.ts` pinta los
    campos desde el schema con `@switch`; no usa `FieldHost` porque el tipo
    `password` es pieza nueva de **Fase 3 (R3.3)** y hoy no existe en
    `FieldSchema`. **Mutaciones 4/4** (`rememberMe:true`, rename `email`,
    `providers: []`, borrar `password` del loginFields).
    _Diferido:_ §5.1 pide campos del registro de render — se resuelve en
    R3.x, cuando exista el descriptor `password`.

- [x] **R2.12** — Almacenamiento del token
  - **Default:** `sessionStorage` (muere con la pestaña). Con «recordarme»:
    `localStorage` — **sólo si D10-3 lo aprueba**.
  - Nunca en la URL ni en `GET`.
  - Al recibir `AUTH_INVALID`/`AUTH_EXPIRED`: borrar token **y** usuario antes
    de redirigir.
  - **Hecho:** **`sessionStorage` siempre** — D10-3 negó `localStorage`, así
    que no hay «recordarme»: ni casilla en el login, ni `true` en
    `authSchema` (el check 10 lo vuelve rojo). `clear()` borra token **y**
    usuario; `goLogin()` sólo corre después de `clear()`. **`ADMIN_TOKEN`
    retirado** de `core/tokens.ts`, `app.config.ts`,
    `environment.ts`, `environment.local.ts` y
    `environment.local.example.ts` (queda una mención comentada en
    `api.service.ts` que explica el retiro). **D22 sigue abierta:** el token
    está en el árbol de commits `d715be6`/`946669b` y rotarlo exige
    autorización.

### 2.3 Robustez (auth §7.3)

- [x] **R2.13** — Rate-limit del login
  - **Declarado** en `limits` del endpoint, **ejecutado** por `26-lock-cache`.
  - Por **cuenta + global** (no por IP — Apps Script no da IP), bajo
    `LockService` (el incremento no es atómico).
  - Mensaje de fallo **siempre genérico**; igual de rápido exista o no el email.
  - **Hecho:**
    - **Declaración** — `limits` pasó de string a objeto para caber las dos
      ventanas en un solo sitio: `{ read: '10/min', write: '10/min',
account: '5/15min' }`. `read`/`write` queda **explícito**: con el
      string, un POST que declare `method: 'GET'` en el cuerpo saldría del
      paso de límite, y al pasar a objeto eso se habría convertido en una
      vía de escape. `auth.md §4.3` ya dibuja `limits` como objeto, así que
      la forma no es nueva — lo era la única ventana.
    - **Gramática** — `parseLimitSpec_` acepta `'<n>/<m><unidad>'`
      (`5/15min` = 5 en 900 s). El multiplicador abre la **ventana**, no el
      contador; sin multiplicador `'10/min'` significa exactamente lo mismo
      que antes ⇒ **cero cambios** en los límites de cualquier otro recurso.
    - **Dos ventanas, un solo mecanismo** — `enforceAccountLimit_` (sólo
      **lee**, sin lock) y `registerAccountFailure_` (incrementa **bajo
      `withLock_`**) en `26-lock-cache.js`. El global de `enforceRateLimit_`
      no se toca: sigue siendo control de uso sin lock, como decidió F6-3.
    - **El router** — `normalizeLimits_` conserva `account` y
      `dispatchRoute_` lo entrega en `request.limits`, así el handler no
      tiene que saber qué endpoint es ni qué id tiene (Regla 1 intacta).
    - **Coste parejado** — `kdfBurn_` (`core/11-auth.js`) quema las mismas
      iteraciones que `kdfVerify_` de un usuario real cuando el email no
      existe. Antes esa rama saltaba el KDF y contestaba en microsegundos:
      era un comprobador de direcciones de correo **con cronómetro**. Si
      falta `KDF_ITERATIONS`, se quema `CONFIG.KDF_ITERATIONS_MIN` — el
      suelo que de todos modos no se baja — en vez de romper el 401.
    - **El 429 tampoco delata** — el contador sube **también** para emails
      inexistentes; si no, el propio corte diría «esta dirección está dada
      de alta».
  - **Números** — `5/15min` sale de §4.6 («5 fallos / 15 min por email») y
    el **límite 5** lo fija §8 («6.º intento fallido → RATE_LIMITED»): la
    ventana es el ejemplo del líder, el conteo es su prueba. Ambos caben en
    una clave de `limits` y se cambian sin tocar código.
  - **Pruebas** — 12 en `auth-endpoints.spec.js` (gramática, corte en el
    6.º, mensaje idéntico con/sin usuario, cuentas aisladas, éxito sin
    consumo, sin declaración ⇒ nunca corta, coste por `Props.hashText`,
    lock en el incremento y **sin** lock en la lectura).
    **Mutaciones 9/9.**
  - **Pendiente de fase:** el mensaje genérico ya lo era («Credenciales
    inválidas») y `RATE_LIMITED` se traduce en el front a «espera» — eso ya
    lo hace la tabla de §4.5 (R2.9).

- [x] **R2.14** — Auditoría de auth
  - **En `_audit`:** `login_ok`, `login_fail`, `logout`, `forbidden`.
    **Nunca** tokens ni contraseñas.
  - **Hecho:**
    - **Una sola implementación** — `authAudit_` vive en `50-audit.js`,
      sobre la MISMA hoja (`_audit_log`) y el MISMO formato de fila que
      `appendAuditRow_`. `entity` siempre es `'auth'`; la acción nombra el
      evento. `appendAuditRow_` gana un `optActor` opcional porque en una
      web app `Session.getActiveUser()` devuelve **al que despliega**, no a
      quien hizo login — el resto de llamadas se resuelve igual que antes.
    - **Columnas** — `actor` = id del usuario (o `anon`); `entity_key` =
      **email**, que es el único identificador que existe en los CUATRO
      casos (un login fallido no tiene id); `summary` = descripción corta
      en español, siempre sin credenciales.
    - **Los cuatro puntos de enganche** — `handleAuthLogin` (ramas de
      éxito y de fallo), `handleAuthLogout` y `requireAccess_` justo antes
      de tirar el 403: ése es el único desfiladero por el que pasa todo
      `FORBIDDEN` del sistema.
    - **Nunca tira el flujo abajo** — `authAudit_` envuelve todo en
      try/catch y devuelve `false`. Fallo silencioso no es fallo silencioso
      de verdad: se manda a `console.error`. Si convirtiera una traza caída
      en 500, cualquiera cortaría el login a distancia.
    - **Los intentos recortados por rate-limit no llegan a auditar**:
      `enforceAccountLimit_` corta antes de mirar credenciales, así que
      `login_fail` cuenta los intentos 1..5 de cada ventana, no el 6.º.
  - **Convención > `auth.md`** — el plan y el líder dicen `_audit`; la hoja
    real se llama `_audit_log` (`schema/05`, `AUX_SHEET_ORDER`). Precedente
    R2.5/R2.8/R2.13: en identificadores gana el código.
  - **Refactor de test** — `fakeSha` y `realUtilities` pasaron a
    `api/__tests__/_auth-fixtures.js` compartido (R2.15/R2.16 van a
    necesitarlo) y `fakeSheet_` gana `appendRow`. Lo antes sólo se podía
    probar parcheando `readSheetData_` a mano; con `fakeSheet_` el spec de
    auditoría deja `readSheetData_` **sin parchear**.
  - **Pruebas** — 11 en `auth-audit.spec.js` (4 eventos, token/contraseña/
    `pass_hash`/`pass_salt` fuera de la traza, hoja ausente, traza que
    revienta, 401 que no se vuelve 500). **Mutaciones 9/9.**
  - **Gates** — front 196 · api **349** · `api:check` VERDE · build ✔ ·
    prettier 17.

- [x] **R2.15** — Snapshot cacheado + `token_version`
  - **TTL 60 s** con `CacheService` → hoja `_users` si falta.
  - Subir `token_version` invalida **todas** las sesiones del usuario
    (firme, efectiva en ≤ 60 s).
  - **Hecho:**
    - **`sessionSnapshot_(sub)`** en `core/11-auth.js`; `verifySession_`
      deja de leer la hoja en cada request. Clave `usnap:<sub>`,
      `SESSION_SNAPSHOT_TTL_S = 60`.
    - **Cumple el «coste típico 0 lecturas» de §3.4** — segunda llamada
      ⇒ ni una hoja abierta.
    - **No cachea `pass_hash`/`pass_salt`.** `CacheService` sólo tiene que
      ser fiable para lo que se pueda perder (§2) y una credencial no lo
      es. Tampoco hace falta: `verifySession_` no los mira y `publicUser_`
      es una whitelist. Todo lo demás (`id`, `email`, `name`, `role`,
      `active`, `token_version`, `last_login_at`, `created_at`) sí va, así
      que `/auth/me` sigue devolviendo lo mismo.
    - **La caché acelera, nunca decide.** Sólo se fía de `typeof raw ===
'string'` + un `JSON.parse` que dé objeto no nulo. Todo lo demás —
      proxy inerte, JSON roto, `'null'`, caché caída — cae a la hoja y se
      reescribe. **Caché negativa: no.** Una cuenta borrada se rechaza sin
      caché para que una baja se note sin esperar al TTL.
    - **`token_version` y `active` con ventana de 60 s**: mientras dure la
      caché la fila nueva no rige; vencido el TTL manda la hoja. Ése es
      exactamente el «firme, efectiva en ≤ 60 s» de §4.6 — la caché ES el
      semáforo, no una invalidación que haya que disparar a mano.
    - **Test corregido** — `auth-session.spec.js` afirmaba
      `cache.size === 0` tras leer revocación (guardia de R2.16). Ahora
      filtra por prefijo `revoked:` y además comprueba que el snapshot SÍ
      quedó: el paso 3 sigue sin escribir nada.
  - **Pruebas** — 7 nuevas en `auth-session.spec.js` (0 hojas en el 2.º
    request, snapshot sin credenciales, JSON roto y `'null'`, valor no
    string, `token_version` y `active` con ventana, sin caché negativa).
    **Mutaciones 6/6.**
  - **Gotcha** — el test «valor no string» falla si se stubbea
    `CacheService` a ciegas: `sidRevoked_` trata cualquier no-nulo como
    revocado. El doble tiene que distinguir por prefijo (`usnap:` vs
    `revoked:`).
  - **Gates** — front 196 · api **356** · `api:check` VERDE · build ✔ ·
    prettier 17.

- [x] **R2.16** — `/auth/logout` con revocación
  - `sid` a la lista de revocados en cache (TTL 6 h) — **best-effort**,
    documentado como tal (D10-7).
  - **Hecho:**
    - **`revokeSid_(sid)`** en `core/11-auth.js`, junto a `sidRevoked_`
      (que ya leía desde R2.6). `handleAuthLogout` lo llama **ANTES** de
      auditar: si la traza falla, la sesión ya quedó cortada.
    - **Clave `revoked:<sid>`, valor `'1'`, TTL 21600 s.** El valor no es
      un booleano por capricho: `sidRevoked_` sólo mira que haya _algo_
      distinto de vacío, así que cualquier string sirve.
    - **Letra chica escrita en el código, no en la wiki**: `CacheService`
      puede perder entradas **y** su tope son 6 h = la vida de un token
      emitido (`TOKEN_TTL_HOURS`). Un logout cubre UN token; una sesión ya
      renovada en deslizante puede llegar a `SESSION_MAX_DAYS`. Por eso
      «cerrar todas las sesiones» **no** es esto — eso es `token_version`
      (R2.15), que persiste en la hoja y por eso sí es firme (§4.3).
    - **No puede fallar**: si la caché está caída, `revokeSid_` devuelve
      `false` y el logout sigue contestando `loggedOut: true` (D10-7).
    - **Orden**: revocar → auditar. Al revés, una traza caída habría
      dejado la sesión viva.
  - **Pruebas** — 6 en `auth-session.spec.js` (escribe la clave, el MISMO
    token deja de servir, otras sesiones siguen, caché caída ⇒ logout
    igual, una entrada exacta por logout, logout sin sid). **Mutaciones
    4/4.**
  - **Gates** — front 196 · api **362** · `api:check` VERDE · build ✔ ·
    prettier 17.

- [x] **R2.17** — Pruebas mínimas (auth §8)
  - Cada caso de la lista de §8 tiene su test: sin token → `AUTH_REQUIRED`;
    token alterado → `AUTH_INVALID`; vencido → `AUTH_EXPIRED`; `aud` distinto
    → rechazado; `active=false` → ≤ 60 s; subir `token_version` → cae todo;
    `staff` en `role:admin` → `FORBIDDEN` sin cerrar sesión; logout → `sid`
    rechazado; 6.º fallo → `RATE_LIMITED`; `/public/*` sin campos internos;
    ninguna respuesta con `pass_hash`/`pass_salt`/`token_version`.
  - **Mapa de cobertura** (una línea por viñeta de §8):
    | §8                                                            | Prueba                                                                                                     |
    | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
    | sin token → `AUTH_REQUIRED`                                   | `auth-session.spec` §2 «código exacto por paso» + §3 «ruta admin SIN token»                                |
    | token alterado → `AUTH_INVALID`                               | `auth-session.spec` §2 · `token.spec`                                                                      |
    | vencido → `AUTH_EXPIRED`                                      | `auth-session.spec` §2 · `token.spec`                                                                      |
    | `aud` distinto → rechazado                                    | `auth-session.spec` (`aud: 'otra-app'`) · `token.spec`                                                     |
    | `active=false` → ≤ 60 s                                       | R2.15 «active=false rige en ≤ 60 s» + fail-closed de R2.6                                                  |
    | subir `token_version` → cae todo                              | R2.15 «subir token_version invalida lo emitido»                                                            |
    | `staff` en `role:admin` → `FORBIDDEN` sin cerrar sesión       | `auth-session.spec` «rol insuficiente → 403» (+ aserción nueva) · `access.spec`                            |
    | logout → ese `sid` rechazado                                  | R2.16 «después del logout el MISMO token ya no sirve»                                                      |
    | 6.º fallo → `RATE_LIMITED`, mensaje idéntico                  | R2.13 (2 tests) + «mensaje de corte idéntico»                                                              |
    | `/public/*` sin campos de la audiencia                        | ⛔ **Fase 4** — no existen rutas `/public/*` ni `audiences`                                                |
    | ninguna respuesta con `pass_hash`/`pass_salt`/`token_version` | `auth-endpoints.spec` «la respuesta NUNCA lleva…» + «proyección pública» + **nuevo** «_users inalcanzable» |
    | `contract-check`: login ⊆ input                               | ✅ R2.11 (check 10)                                                                                        |
    | `contract-check`: rutas ⊥ audiencia                           | ⛔ **Fase 4** — depende de `audiences`                                                                     |
  - **Huecos cerrados en esta tarea:**
    - **«y no se cierra la sesión»** — el test de `FORBIDDEN` sólo comprobaba
      el 403; ahora además verifica que un `/auth/me` posterior sigue
      devolviendo el usuario. Un 403 que limpiara el token mandaría a login
      a cualquiera que tocara una pantalla de admin sin permiso.
    - **`_users` es inalcanzable por el motor de recursos** — si `_users`
      no está en `REGISTRY.resources` ni como `sheet` de otro recurso,
      ninguna respuesta del CRUD puede leer `pass_hash`/`pass_salt`/
      `token_version`. Ése es el otro camino además del blanqueo de
      `publicUser_`.
  - **Diferido a Fase 4 (no es una deuda nueva):** las dos viñetas de
    audiencias — `refactormotor.md` ya las sitúa en «4 · Audiencias».
  - **Mutaciones 3/3** — `publicUser_` cuela `pass_hash` · `_users`
    registrada como recurso · el 403 vuelve a ser 401.
  - **Gates** — front 196 · api **363** · `api:check` VERDE · build ✔ ·
    prettier 17.

- [x] **R2.18** — Gates de la fase ✅ **cerrada 2026-10-08**
  - **Comandos:** 5 gates + `sheet-check`.
  - **Hecho cuando:** todo verde.
  - **Estado: 6/6 verdes** ✅ — front **196** · api **390** · `api:check`
    VERDE (7 recursos, 84 campos) · build ✔ · prettier **17** (baseline) ·
    **`api:drift` VERDE** — «sin faltantes ni sobrantes».
    - **Diagnóstico del bloqueo (D23): tres causas apiladas, ninguna era el
      token.**
      1. `GAS_URL` apuntaba al deployment **fijado a la versión 29**, no al
         `@HEAD` (el `@HEAD` devuelve HTML, no JSON).
      2. El despliegue anterior a Fase 2 devolvía `401` **sin `code`**; hoy
         SIEMPRE se emite `code` en 401 ⇒ **«401 con `code`» prueba que el
         despliegue ya trae Fase 2**.
      3. **La hoja `_users` no existía** en el spreadsheet real ⇒
         `POST /auth/login` → `500 "El sistema de usuarios no está
configurado"`.
    - **Por qué no se automatiza del todo:** `clasp run` no funciona («GCP
      project ID is not set») y `auth.md` §4.7 manda que el arranque inicial
      sea **editor-only, «nunca por endpoint»**.
    - **Cómo se resolvió:** `clasp push -f` + `version` + `redeploy` → **v32**
      (mismo URL) · D23 auto-login del humo · D24 `setupAll()` — **una sola
      corrida en el editor** · D25 reconciliación del admin
      (`contraseña ACTUALIZADA`) · `npm run smoke:login` con **caché activa**
      · `npm run api:drift` **VERDE**.
      **Sin rotar credenciales** y **sin `clasp push` en el chequeo**.
  - **Conteo de la fase** — R2.1→R2.18 **18/18 cerradas**:
    front **196** · api **390** · `api:check` VERDE (7 recursos, 84 campos)
    · build ✔ · prettier **17** (baseline) · `api:drift` VERDE. Mutaciones
    acumuladas de la fase: **R2.6 7/7 · R2.11 4/4 · R2.13 9/9 · R2.14 9/9 ·
    R2.15 6/6 · R2.16 4/4 · R2.17 3/3 = 42/42** · **D24 5/5 · D25 5/5**. api:
    363 en el cierre de R2.17, **390** con D23/D24/D25 (+27 tests).

---

## Fase 3 — Registros

> Corazón del plan. **Impacto muy alto.** Absorbe T1.1, T1.2, T1.3.

**Precondición:** Fases 0 y 1.

### 3.1 Registro único de render (F1)

- [x] **R3.1** — Definir `RenderDescriptor` ✅ **cerrada 2026-10-08**
  - **Archivo nuevo:** `src/app/core/registry/render-registry.ts`
  - **Contrato:**
    ```ts
    type RenderKind = 'field' | 'column-format' | 'widget' | 'action' | 'view' | 'layout';
    interface RenderDescriptor<C = unknown> {
      kind: RenderKind;
      type: string; // kebab-case, único dentro de su kind
      since: string;
      load: () => Promise<Type<any>>; // lazy
      surfaces?: ('form' | 'display' | 'list' | 'filter')[];
      defaults?: Partial<C>;
    }
    ```
    > **`configSchema?: MetaSchema` eliminada del contrato.** No existe en
    > ningún sitio (`grep -rn "configSchema" src/` → 0) y el plan ya la había
    > descartado en **D17** (§4): la cláusula entera, `MetaSchema` incluida.
  - **Hecho cuando:** el tipo compila y tiene test unitario.
  - **Estado:** `render-registry.spec.ts` — 6 tests. `resolve()` es
    **asíncrona** (`load()` importa bajo demanda) y devuelve el `fallback`
    síncrono cuando no hay descriptor; un fallo de `load()` **no se traga**.

- [x] **R3.2** — Funciones de registro y consulta ✅ **cerrada 2026-10-08**
  - **Según D9-1:** `provideRenderDescriptors(...)` con autodescubrimiento
    (`import.meta.glob`) **o** registro manual de una línea.
  - **API:** `register(kind, descriptor)` · `get(kind, type)` ·
    `isSupported(kind, type)` · `resolve(kind, type, fallback)`.
  - **Hecho cuando:** `isSupported` reemplaza a `isSupportedFieldType` sin
    romper a sus 4 consumidores.
  - **Estado:** ✅ — los 4 consumidores (`form-view`, `form-schema`,
    `contract.spec`, `field-host`) migran a `isSupported('field', type)` y
    `isSupportedFieldType` + el `Set` **desaparecen**.
    - **Se elige la rama «registro manual» de D9-1** (`import.meta.glob` no
      sobrevive a `ng build`) — ver **D26**.
    - **El registro se llena a scope de módulo, no desde DI:** `buildFormSchema()`
      es una función pura que consulta sin inyectar nada. `provideRenderDescriptors()`
      existe igualmente como punto de entrada de `app.config.ts`.
    - **§5 enmendada:** la fila «Consulta: `isSupported<Categoria>(id)`» queda
      expresada como `isSupported('field', id)`, que es el sentido literal de
      «`isSupported` reemplaza a `isSupportedFieldType`».

- [x] **R3.3** — Descriptores de los 20 tipos de campo ✅ **cerrada 2026-10-08**
  - **Archivo nuevo por tipo:** `src/app/fields/<type>/<type>.descriptor.ts`
  - **Pasos:** uno por cada uno de los 20; cada uno declara `kind: 'field'`,
    `load`, `surfaces`.
  - **Verificación:** `npm test` — los 20 resuelven.
  - **Hecho cuando:** no queda ningún `Set` de tipos.
  - **Estado:** 20 ficheros + manifiesto `src/app/fields/descriptors.ts`
    (una línea por tipo). `render-registry.spec.ts` afirma los 20
    registrados **y** que cada uno resuelve su componente real.
    `SUPPORTED_FIELD_TYPES` (el `Set`) **eliminado**; la lista
    `SUPPORTED_FIELD_TYPE_LIST` queda sólo como aserción de compilación
    (D17/R1.7) y está re-comentada como «no fuente de verdad en runtime».
    - **Coste de D26:** añadir un tipo exige además **una línea** en el
      manifiesto — no es un host, así que R3.8 sigue cumpliéndose.

- [x] **R3.4** — `<app-render-host>` genérico ✅ **cerrada 2026-10-08**
  - **Archivo nuevo:** `src/app/core/registry/render-host.ts`
  - **Pasos:**
    1. Basado en `NgComponentOutlet`, con `[kind] [type] [config] [ctx]`.
    2. El contexto (`pathPrefix`, errores, `FIELD_ARIA`) sigue entrando **por
       DI** mediante un `RenderContext` tipado.
    3. Conservar el envoltorio: `<label>`, marca required/opcional,
       `data-field`, `colSpanClass`.
    4. Conservar el fallback `Skeleton`.
  - **Hecho cuando:** renderiza los 20 tipos.
  - **Estado:** ✅ — **225/225** (202 de R3.1–R3.3 + 23 nuevos en
    `render-host.spec.ts`, uno por tipo más registro, degradación y
    envoltorio). El envoltorio completo es el de `FieldHost` (`<label
[for]>`, marcas, `data-field`, `colSpanClass`, error, ayuda,
    `FIELD_ARIA`); `resolve()` + `UnknownRender` cubren al tipo que no esté
    en el catálogo y en dev avisa antes de degradar.
    - **D27:** `multiselect` e `image` **no** caben en `NgComponentOutlet` —
      se declaran en la plantilla con su binding `[formField]` (ver §4).
    - **Tabla `controlInputs`:** cubre los 18 tipos que sí salen del
      registro; `group`/`list` siguen recibiendo sus templates por
      `viewChild`.

- [x] **R3.5** — Migrar `FieldHost` al registro ✅ **cerrada 2026-10-08**
  - **Archivo:** `src/app/fields/field-host/field-host.ts` (431 líneas)
  - **Pasos:** eliminar `SUPPORTED_FIELD_TYPES` y los 21 imports a mano; el
    `@switch` pasa a resolverse desde el registro.
  - **Restricción:** conservar el **auto-import recursivo** (`group`/`list` vía
    `ngTemplateOutlet`) y `ListChildContext`.
  - **Verificación:** `npm test` · `npm run build` · sin pantalla rota en los
    7 schemas.
  - **Estado:** ✅ — `field-host.ts` quedó en **93 líneas**: un adaptador fino
    que traduce su API histórica (`field` + `tree` + `pathPrefix` …) al
    `RenderContext` y delega en `<app-render-host>`. El `@switch` de 20 ramas,
    los 21 imports a mano, el envoltorio y `FIELD_ARIA` viven en `RenderHost`;
    la recursión de `group`/`list` (los `ng-template`) y `ListChildContext`
    también, y es `RenderHost` quien se auto-importa. `SUPPORTED_FIELD_TYPES`
    sigue **eliminado**; `SUPPORTED_FIELD_TYPE_LIST` permanece sólo como
    tripwire de compilación (D17/R1.7), re-comentada como «no fuente de
    verdad en runtime».
    - **D28:** al pasar a carga perezosa, `whenStable()` no esperaba al
      `import()` del descriptor y **13 tests** se rompieron con el control
      llegando tarde — ver §4.
    - `goToError` pasó a `async`: espera la estabilidad antes de enfocar.
  - **Gates 6/6:** front **225/225** · api **390/390** · `api:check` ✔ ·
    `build` ✔ · prettier deuda **17** · `api:drift` ✔.

- [x] **R3.6** — Migrar `WidgetHost` al registro
  - **Archivo:** `src/app/widgets/widget-host/widget-host.ts`
  - **Pasos:** eliminar `SUPPORTED_WIDGET_TYPES` y los 6 imports; añadir los
    6 descriptores `kind: 'widget'`.
  - **Verificación:** los 4 widgets del dashboard renderizan.
  - **Estado:** ✅ **hecho.** `WidgetHost` quedó en **180 → 58 líneas** y pasó
    a adaptador fino, el mismo molde que `FieldHost` en R3.5: conserva sólo
    su contrato histórico (`widget`/`data`) y su `host` con la clase de ancho
    en la grilla, y delega el despacho en `<app-render-host kind="widget">`.
    - Desaparecieron `SUPPORTED_WIDGET_TYPES`, `isSupportedWidgetType()`, el
      `@switch` de 6 ramas, los 6 imports de componente, los 6 `computed`
      de estrechado (`metricCard()`, `barChart()`, …) y los 3 normalizadores
      de payload (`series()`, `recordListData()`, `statusProgressData()`).
    - **6 descriptores** `kind: 'widget'` + manifiesto
      `widgets/descriptors.ts` (6 líneas), registrado junto a los de campo
      en `render-registry.ts`.
    - `RenderHost` gana la rama de widget: sin envoltorio de campo (no hay
      etiqueta, marca required, error ni ayuda), con `data` como input y con
      `ctx` **no requerido** — un widget no pertenece a un formulario. El
      envoltorio de campo pasa a estar tras `esCampo()`.
    - **D29:** el cableado por tipo se movió de `controlInputs` (un `switch`
      que habría crecido con 6 casos de widget) a `RenderDescriptor.inputs`
      — ver §4.
    - **D30:** el `@defer (on viewport)` de `chart-line` vivía en el host y
      ya no tenía casa — ver §4.
    - `dashboard.spec.ts` y `widget-host.spec.ts` esperan la estabilidad
      antes de assertar (mismo criterio que D28): los componentes salen de
      un `import()` y llegan tarde al ciclo síncrono.
  - **Gates 6/6:** front **225/225** · api **390/390** · `api:check` ✔ ·
    `build` ✔ · prettier deuda **17** · `api:drift` ✔.

- [x] **R3.7** — Test de exhaustividad _(absorbe T1.3)_
  - **Archivo:** `src/app/core/registry/contract.spec.ts`
  - **Pasos:** recorrer los schemas y afirmar que **cada** `field.type`,
    `column.format`, `widget.type` y `action.type` usado tiene descriptor.
  - **Hecho cuando:** añadir `type: 'foo'` a cualquier schema **falla el
    test**.
  - **Estado:** ✅ **hecho.** 7 tests en la ruta que el plan nombra. El
    recorrido de `field.type` se **mudó** desde `schemas/contract.spec.ts`
    (R1.7/D17) para no duplicarlo; allí quedan el catálogo y las acciones.
    - **Recorrido de schemas** — `field.type` (anidados incluidos) y
      `widget.type` contra `isSupported`, con guardianes de no-vacuidad para
      que un catálogo vacío no dé verde.
    - **Unión ↔ registro** (lo que el recorrido no ve) — `SUPPORTED_FIELD_TYPE_LIST`
      (exportado de `field-host.ts`) y el nuevo `TIPOS_WIDGET`, ambos
      `satisfies` sobre su unión, uno a uno contra `isSupported`. Sin esta
      segunda capa, **dar de baja un descriptor que ningún schema declara
      pasaba en verde**: `dashboard.schema.ts` usa 4 de los 6 widgets y hoy
      no declara ni `bar-chart` ni `chart-line`.
    - **Tripwire de `kind`** — `renderKinds()` (nuevo en el registro) contra
      `RECORRIDOS`: el día que existan descriptores de `column-format`
      (R4.3) o de `action` (R3.9) el test se pone rojo y obliga a ampliar el
      recorrido. Un `kind` registrado y sin recorrer es el agujero exacto
      que R3.7 vino a cerrar.
    - **`column.format` y `action.type` no tienen descriptor** — ver D31.
  - **Verificación en rojo (ejecutada, no deducida):** sin
    `chartLineDescriptor` ⇒ **1 rojo** («todo tipo de la unión de widgets»);
    sin `textDescriptor` ⇒ **2 rojos** (schema + lista de campos).
  - **Gates 6/6:** front **230/230** · api **390/390** · `api:check` ✔ ·
    `build` ✔ · prettier deuda **17** · `api:drift` ✔.

- [x] **R3.8** — Verificación: «añadir un tipo no toca el motor»
  - **Pasos:** crear un tipo de prueba (`field-tmp`) y comprobar que **sólo**
    hay que crear carpeta + descriptor, sin editar hosts.
  - **Hecho cuando:** el tipo de prueba se elimina y el criterio §0 pasa.
  - **Estado:** ✅ **hecho.** Se creó `field-tmp` de verdad — carpeta con
    componente y descriptor, alta en el manifiesto, miembro de la unión — y
    se **montó y pintó**: `<app-field-field-tmp>` dentro del envoltorio
    completo de R3.4 (`label[for="…campo"]`, `data-field="…campo"`, rótulo).
    Con el tipo dado de alta, front **232/232** y build verdes **sin editar
    ninguna vista**; después se borró (0 rastros) y los 6 gates vuelven a
    pasar.
  - **Inventario real de lo que obligó a tocar:**

    | Archivo                                                                          | ¿§0 lo prohíbe?               | Veredicto                                     |
    | -------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------- |
    | `fields/field-tmp/` — componente + descriptor                                    | no                            | ✅ es lo que §0 pide                          |
    | `fields/descriptors.ts` — 1 import + 1 línea                                     | no                            | ✅ el registro (D9-1)                         |
    | `core/models/schema.model.ts` — interfaz + miembro de la unión                   | no: es el modelo, no el motor | obligatorio — sin eso el tipo no existe       |
    | `fields/field-host/field-host.ts` — `'field-tmp'` en `SUPPORTED_FIELD_TYPE_LIST` | **sí: nombra `FieldHost`**    | ⚠️ **§0 no pasaba → arreglado en esta tarea** |
    | `shared/utils/seed.ts` — `case 'field-tmp'`                                      | no está en la lista de §0     | decisión del valor inicial → **D32**          |

    **`render-host.ts`, `widget-host.ts` y cualquier vista: cero toques** en
    todo el experimento — que es lo que R3.8 vino a comprobar.

  - **El arreglo de esta tarea.** El tripwire D17 de `field-host/field-host.ts`
    (`SUPPORTED_FIELD_TYPE_LIST` + `Exclude<FieldType, …>`) **no tenía uso en
    runtime**: sólo alimentaba esa aserción de compilación. Se
    mudó a `fields/descriptors.ts`, con lo que:
    1. `FieldHost` deja de estar en el camino de «añadir un tipo» (**§0
       pasa**, literalmente);
    2. el registro y su aserción quedan en el **mismo archivo**, así que un
       tipo nuevo toca una carpeta y una línea de este manifiesto;
    3. no cambia ningún comportamiento — verificado con build y 232 tests
       verdes con `field-tmp` dado de alta y `field-host.ts` intacto.
  - **Gates 6/6 (tras borrar el tipo):** front **253/253** · api
    **390/390** · `api:check` ✔ · `build` ✔ · prettier deuda **17** ·
    `api:drift` ✔.
  - **Segundo pase, con D32 resuelta.** El experimento se repitió después de
    mover la siembra al descriptor: `seed.ts` con **cero menciones** del tipo
    nuevo, build verde y **254 tests** (el oro por descriptor cubre solo al
    tipo recién nacido). §0 pasa sin una sola línea en un fichero compartido.
    El detalle está en **D32**.

### 3.2 Registro de acciones (F2 — absorbe T1.1)

- [x] **R3.9** — `ActionDescriptor` y `ActionService`
  - **Archivos nuevos:** `src/app/actions/action-registry.ts`,
    `src/app/actions/action-service.ts` + `action-registry.spec.ts` y
    `action-service.spec.ts` (**12 tests**).
  - **Contrato (implementado):**
    ```ts
    interface ActionDescriptor {
      type: string;
      surfaces: ('row' | 'detail' | 'header' | 'bulk' | 'post-create')[];
      run: (ctx: ActionContext, action: ResourceAction) => Promise<ActionResult>;
      confirm?: boolean; // usa confirm-dialog
    }
    /** Lo que aporta el llamador. `record` es null en header/bulk. */
    interface ActionRequest {
      record: Record<string, unknown> | null;
      resource: string;
      api: ApiService;
      router: Router;
      toast: NotificationService;
      user: SessionUser | null;
    }
    /** Lo que recibe el descriptor: la petición + las plantillas resueltas. */
    interface ActionContext extends ActionRequest {
      vars: Record<string, unknown>; // {...config, ...record, public_base_url}
    }
    interface ActionResult {
      ok: boolean; // false: no llegó a ejecutarse; el error ya se notificó
      reload?: boolean; // tocó datos: la vista debe recargar (R3.11)
    }
    ```
    `ActionService.run(action, request: ActionRequest)`.
  - **Estado:** ✅ **hecho.** Registro gemelo de `render-registry`
    (`registerAction` / `getAction` / `actionsFor(surface)`) más
    `actionType()`, que resuelve el `type` **opcional** de `NavigateAction`
    → `'navigate'`. El servicio hace siempre el mismo camino: resolver el
    descriptor → **falla ruidosa** si no existe (el fallback «disponible
    próximamente» de hoy es un fail-silent que oculta esquemas mal
    declarados) → confirmación opcional → montar el ctx → ejecutar y, si el
    descriptor lanza, `toast.error` + `{ ok: false }`.
  - **Dos desviaciones menores del contrato, ambas necesarias:**
    - **`vars` (séptimo campo).** Sin él `copy-share` perdería
      `public_base_url` y `share_message_template`, que aporta
      `ConfigService.buildInterpolationContext`. Se pone en `ActionContext`
      (lo que recibe el descriptor) y **no** en `ActionRequest` (lo que
      aporta el llamador): así el servicio lo construye y ninguna vista
      repite `buildInterpolationContext`.
    - **`ActionResult` estaba sin definir en el plan** → `{ ok, reload? }`.
  - **Confirmación sin puertos nuevos:** `confirm: true` del descriptor con
    `action.confirmMessage` (fallback `action.label`); pasa por
    `NotificationService.confirm`, que ya tiene 6 llamantes y alimenta
    `app-confirm-dialog` en `app.html:4`.
  - **`render-registry` no se tocó** → `renderKinds()` sigue sin
    `kind: 'action'`, así que el tripwire de D31 no se pone rojo (la acción
    tiene registro propio, como mandan los nombres de fichero del plan). El
    cruce `ResourceAction` ↔ `getAction` queda para **R3.10**, cuando
    existan los 3 descriptores.
  - **Verificación en rojo (ejecutada, no deducida):** `actionType` sin
    `?? 'navigate'` ⇒ **2 rojos**; sin el `throw` del fail-loud ⇒ **1 rojo**
    (3 rojos en una pasada, restaurado después).
  - **Gates 6/6:** front **265/265** (40 ficheros) · api **390/390** ·
    `api:check` ✔ · `build` ✔ · prettier deuda **17** · `api:drift` ✔.
  - **Gotcha:** el registro es estado de módulo compartido **entre los tests
    de un mismo fichero**; y `vi.fn()` sin `mockResolvedValue` devuelve
    `undefined`, no una promesa.
  - **Gotcha corregido en R3.11:** el aislamiento **no** alcanza a todos los
    ficheros — vitest comparte el mismo `Map` entre specs que caen en el mismo
    worker, y `action-service.spec` sobrescribe `copy-share` / `navigate` /
    `trigger-endpoint` con dobles. Costó 4 tests rojos en `descriptors.spec`
    en una corrida y 0 en la siguiente **sin tocar código**. Quien ensucia
    limpia: ese fichero restaura el catálogo real en su `afterEach`.

- [x] **R3.10** — Descriptores de las 3 acciones existentes
  - `copy-share` · `navigate` · `trigger`.
  - `copy-share` se implementa **una sola vez** (hoy: 3).
  - **Archivos nuevos:** `src/app/actions/descriptors.ts`,
    `src/app/actions/contract.spec.ts`, `src/app/actions/descriptors.spec.ts`
    (**12 tests**). `action-registry.ts` suma el catálogo a scope de módulo
    (mismo criterio que `render-registry.ts:209`) y `actionTypes()`.
  - **Estado:** ✅ **hecho.** Los tres descriptores quedan declarados con sus
    superficies: `copy-share` (`row`, `detail`, `post-create`), `navigate`
    (`row`, `detail`) y `trigger-endpoint` (`row`, `detail`, `confirm: true`).
    Como nadie consulta todavía `actionsFor(surface)`, las superficies son
    contrato de R3.11, no comportamiento.
  - **`copy-share` implementado una sola vez:** `resolveShare(action, vars)`
    en `descriptors.ts` resuelve enlace y mensaje **en un solo sitio**; hoy
    esa lógica vive triplicada en `list-view.runAction`,
    `detail-view.resolveUrl/resolveShareText` y
    `post-create-modal.resolvedShareUrl/resolvedShareText`. Los tres la
    consumirán en **R3.11**, junto con la migración de las vistas.
  - **Comportamiento que cambia (decisión registrada):** la fila del listado
    **pasa a honrar `share_message_template`**, que antes sólo usaban
    `detail-view` y `post-create-modal` — era una divergencia entre las tres
    copias, no una regla de negocio. Si no debe ser así, hay que revertirlo en
    `resolveShare`, no volver a separar las rutas.
  - **`trigger-endpoint`:** interpola `endpoint` con el mismo contexto que el
    resto y lo llama con `ApiService.request(método, ruta)`. **R3.12** lo
    cambia por rutas lógicas (`POST /admin/<recurso>/:id/actions/<name>`, O2);
    acá se respeta la ruta literal que declara el schema hoy.
  - **Exhaustividad:** `actions/contract.spec.ts` replica el molde de
    `core/registry/contract.spec.ts` (R3.7) en los dos sentidos — unión ↔
    registro (`TIPOS_ACCION` con `satisfies` sobre
    `NonNullable<ResourceAction['type']>`) y recorrido de los **tres sitios**
    donde el modelo admite acciones (`schema.actions`, `detail.actions`,
    `postCreate.actions`), con guardianes de no-vaciedad. Cubre el caso que el
    recorrido no ve: `navigate` y `trigger-endpoint` **no los declara ningún
    schema** y su descriptor seguiría obligatorio.
  - Se corrigió la nota obsoleta de `core/registry/contract.spec.ts`, que
    seguía diciendo que `action.type` no tenía registro.
  - **Verificación en rojo (ejecutada, no deducida):** quitar `navigate` del
    catálogo ⇒ **3 rojos**; quitar el fallback a `share_message_template` ⇒
    **1 rojo** (4 en una pasada, restaurado después).
  - **Gates 6/6:** front **277/277** (42 ficheros) · api **390/390** ·
    `api:check` ✔ · `build` ✔ · prettier deuda **17** · `api:drift` ✔.

- [x] **R3.11** — Migrar las vistas al `ActionService`
  - **Archivos:** `list-view.ts:714`, `detail-view.ts:408`,
    `post-create-modal.ts`
  - **Pasos:** reemplazar los `if (action.type === …)` por
    `actionService.run(action, ctx)`.
  - **Verificación:** `grep -rn "action.type ===" src/app --include='*.ts'` → 0
    fuera de los descriptores.
  - **Estado:** ✅ **hecho.** Las tres vistas pasan por el registro:
    - `list-view` — única superficie que **ejecuta**: delega en
      `ActionService.run(action, { record, resource, api, router, toast,
user })`, con `user` de `AuthService`. El icono de fila sale del
      descriptor (`iconOf()` = `getAction(actionType(action))?.icon`), de modo
      que un descriptor nuevo aparece en la tabla sin tocar la plantilla.
    - `detail-view` — sólo **presenta**: `shareOf()` =
      `resolveShare(action, actionService.vars(effectiveRecord()))`. Mueren
      `resolveUrl` y `resolveShareText`, y con ellos `ConfigService` en esta
      vista (`vars` pasó a ser el séptimo campo público del servicio).
    - `post-create-modal` — ídem, `shareOf()` sobre su propio `context()`
      (sigue aplicando `configValues` por encima). Mueren `resolvedShareUrl`
      y `resolvedShareText`.
  - **Verificación en rojo (ejecutada):** `git grep "action.type ===" HEAD`
    → **2** (`list-view.ts:333` en plantilla y `:714` en código); hoy el grep
    devuelve **1**, y es el de `actions/descriptors.ts`.
  - **Tercer cambio de comportamiento registrado:** `post-create-modal`
    **pasa a honrar `share_message_template`** (antes sólo miraba
    `shareTextTemplate`), porque ya no tiene ruta propia. Mismas condiciones
    que el de R3.10: si no debe ser así se revierte en `resolveShare`, no
    volviendo a separar las tres rutas.
  - **Dependencia de DI nueva:** `list-view` inyecta `AuthService` para
    aportar `user` (contrato de R3.9) ⇒ los specs que montan la vista con
    `ApiService` stubbeado (`list-view.remove`, `list-view.quick-edit`,
    `resource-page`) necesitan `{ provide: API_URL, useValue: '/api' }`, la
    misma convención que ya usaba `render-host.spec`.
  - **Gates 6/6:** front **277/277** (42 ficheros) · api **390/390** ·
    `api:check` ✔ (7 recursos, 84 campos) · `build` ✔ · prettier deuda **17** ·
    `api:drift` ✔.

- [x] **R3.12** — `trigger` → acción de backend declarada (B3)
  - **Pasos:** `action.type: 'trigger'` invoca
    `POST /admin/<recurso>/:id/actions/<name>` — **rutas lógicas** (O2).
  - **Estado:** ✅ **hecho, cara front.** El back lo publica **R5.4**, que sigue
    pendiente; el front ya manda exactamente esa ruta, así que R5.4 sólo tiene
    que escucharla.
    - `TriggerAction` pasó de `trigger-endpoint` + `endpoint` + `method` a
      **`trigger`** + `name?`. El destino **ya no lo declara el schema**: se
      deriva de `resource` + clave del registro + `name` (o `id`), que es la
      misma ruta que R5.4 publicará. Ningún schema declaraba
      `trigger-endpoint`, así que el cambio no toca producción.
    - **O2 respetado:** la ruta lógica viaja en el `path` del envelope
      (`/admin/orders/p1/actions/markDelivered`); el HTTP sigue siendo el
      `POST API_URL` de siempre. La clave se interpola igual que hace
      `ApiService.withKey` con el CRUD.
    - **Desviación nº 3 del contrato de R3.9:** `ActionRequest.keyField`
      (tras `vars` y `ActionResult`). Sin él el descriptor no sabe qué campo del
      `record` es la clave: es información que sólo tiene la vista, que es
      quien tiene el schema. Lo aporta `list-view`.
    - **Sin clave ⇒ fail-loud:** un `record` sin la clave del schema lanza
      («… necesita la clave ref del registro») en vez de mandar
      `/admin/x/undefined/actions/…`.
  - **Verificación en rojo (ejecutada, 3 mutaciones):** quitar `name ?? id`
    ⇒ **1 rojo**; sacar la clave de la ruta ⇒ **2 rojos**; quitar la guardia
    de clave ⇒ **1 rojo**.
  - **Limpieza derivada:** `ACCIONES_EJECUTADAS = ['copy-share']` (R1.7)
    desapareció — la lista de acciones ejecutables sale de `actionTypes()`, o
    sea del registro. Las notas de R1.7 y D16 sobre «`trigger-endpoint`
    declarado sin implementar» quedan como **históricas**: describen el estado
    anterior a R3.10/R3.12.
  - **Gates 6/6:** front **279/279** (42 ficheros) · api **390/390** ·
    `api:check` ✔ (7 recursos, 84 campos) · `build` ✔ · prettier deuda **17** ·
    `api:drift` ✔.

### 3.3 Capacidades del back (B1)

- [x] **R3.13** — Unificar `REGISTRY.capabilities` ✅ **cerrada 2026-10-08**
  - **Pasos:** `api/capabilities/` con `fieldTypes/`, `validators/`, `checks/`,
    `computed/`, `hooks/`, `operators/`, `handlers/`, `adapters/`;
    **contrato uniforme** `{ id, since, argsSchema, run }`;
    **puerta de entrada única** `registerCapability(category, descriptor)`.
  - **Estado:** ✅ **hecho.** `api/capabilities/00-register.js` es la única puerta
    y declara el `var FIELD_TYPES = {}` + `REGISTRY.types.fieldTypes = FIELD_TYPES`
    (proyección legacy).
    - `REGISTRY.capabilities` (las 8 categorías) se declaró en `api/00-registry.js`.
    - `run` **obligatorio**: función en categorías ejecutables
      (`checks/computed/hooks/operators/handlers`) y `null` en las de datos
      (`fieldTypes/validators/adapters`) — **D33**.
    - Proyección a los mapas que lee `engine/` (`ops`, `transforms`, `checks`,
      `handlers`, `hooks`): **cero cambios en `engine/`** (§B1). `validators` y
      `adapters` quedan declaradas y **vacías** (ficheros stub que documentan
      cuándo y con qué se llenan).
    - **Puerta verificable:** regla nueva **B1** en `scripts/api-check.sh` — una
      asignación directa a esos mapas fuera de `capabilities/` (y de los tests)
      sale en rojo. Mutación ⇒ **1 rojo**.
  - **Verificación en rojo (ejecutada):** M1 sin validar `since` ⇒ **2 rojos**;
    M2 `run` no obligatorio ⇒ **2**; M7 asignación directa (`api:check`) ⇒ **1**.
  - **Gates 6/6:** front **279/279** (42 ficheros) · api **419/419** (28) ·
    `api:check` ✔ (4 reglas) · `build` ✔ · prettier deuda **17** · `api:drift` ✔.

- [x] **R3.14** — Migrar las capacidades existentes ✅ **cerrada 2026-10-08**
  - **Pasos:** `FIELD_TYPES` (20) · `checks` · `hooks` · `computed` (`token`,
    `pin`, `now`) · `handlers` · `operators`; verificar con `npm run test:api`.
  - **Estado:** ✅ **hecho, con los 6 gates corridos al cierre (D36 — R3.13 y
    R3.14 no se pueden cerrar por separado: el tripwire sólo pasa con la
    migración hecha).**
    - **Migrado (`git mv`, historial preservado):** 20 `fieldTypes` · 5 `checks`
      · 4 `computed` (`slugify`, `token`, `pin` + `now` declarado) · 14
      `operators` · 1 `hooks` (`pinHash`, extraído de `pin-verify.js`) · 11
      `handlers` (incluye `schema` y `upload-signature`, que antes sólo se
      resolvían por el fallback a `globalThis` del router — **D36**).
    - **Se fueron de sitio:** `api/primitives/` **desaparece** y
      `api/schema/types/01-types.js` → `api/capabilities/fieldTypes.js`
      (decisión de limpieza: mover el conjunto completo, handlers incluidos).
    - **Verificación en rojo (7 mutaciones, ejecutada):** M1 ⇒ **2** · M2 ⇒ **2**
      · M3 `computed` sin proyección a `REGISTRY.transforms` ⇒ **49 en 5**
      ficheros · M4 un tipo sin registrar ⇒ **4 en 27** · M5 checks sin
      validar `args` ⇒ **3** · M6 `field.computed` sin validar ⇒ **2** ·
      M7 (`api:check` B1) ⇒ **1 rojo** (restaurado y verde).
    - **Specs:** `api/__tests__/capabilities.spec.js` (22: puerta + tripwire del
      contrato uniforme) y `api/__tests__/validate-registry.spec.js` (+7).
    - **Docs al día:** `README.md` (sólo los nodos tocados), `MAPA.md` (incluye
      el orden de carga y el nombre de la sección), `guia.md`,
      `motor-renderizado-actual.md`, `baseapi.md`, `refactormotor.md`,
      `plan-limpieza.md`.
    - **Gotcha local (no commiteado):** `api/.clasp.json` (gitignore) tenía
      `filePushOrder` con las 4 rutas ya borradas y sin `capabilities/` →
      reescrito a **32 entradas** verificadas. **D35:** si se clona el repo,
      ese fichero se recrea a mano — sin él `capabilities/` se empuja por orden
      alfabético (funciona), pero el orden documentado en el plan no está.
    - **Fuera de alcance (D37):** el árbol de `api/README.md` ya estaba
      desactualizado en cosas que este cambio no toca (`04-registry`,
      `03-resources-*`, «21 tipos») — sólo se actualizó lo que movía.
  - **Gates 6/6:** front **279/279** (42 ficheros) · api **419/419** (28) ·
    `api:check` ✔ (4 reglas) · `build` ✔ · prettier deuda **17** · `api:drift` ✔.

- [x] **R3.15** — Validación de referencias al cargar ✅ **cerrada 2026-10-08**
  - **Pasos:** cada `computed: 'token'`, `check: 'not-in-sheet'`… debe existir,
    y sus `args` cumplir `argsSchema`.
  - **Estado:** ✅ **hecho** en `api/schema/validate-registry.js`, todo leyendo
    de `REGISTRY.capabilities` (fuente única), no de los mapas legacy:
    1. `field.type` ∈ `capabilities.fieldTypes`.
    2. **Nuevo 3f:** `field.computed` es `string` y existe en
       `capabilities.computed` (hoy sólo `now`).
    3. `operations.<op>.computed[i].transform` existe y `params` cumple su
       `argsSchema`.
    4. `resource.checks[i].check` existe y la declaración **menos la clave
       `check`** cumple su `argsSchema`.
    5. `resource.hooks.<op>[i]` existe en `capabilities.hooks`.
    - **Vocabulario de `argsSchema` (D33):** `{ <arg>: { type, required? } }`
      con `type ∈ text|number|boolean|array|object`; `null` = sin argumentos
      declarados (no se juzga); `{}` = no admite ninguno. El juez propio es
      `capabilityArgsIssues_(where, schema, args)` (ya en la puerta de R3.13).
  - **Hecho cuando:** una referencia rota o argumento mal declarado rompe el
    arranque — `loadBackend()` carga `validate-registry` al final ⇒ rojo en CI.
  - **Verificación en rojo:** M5 ⇒ **3 rojos**; M6 ⇒ **2 rojos**.

- [x] **R3.16** — Gates de la fase ✅ **cerrada 2026-10-08**
  - **Gates 6/6:** front **279/279** (42 ficheros) · api **419/419** (28
    ficheros) · `api:check` ✔ (4 bloques: Regla 1, **B1 nueva**, Regla 5, contract
    7 recursos/84 campos) · `build` ✔ · prettier deuda **17** · `api:drift` ✔.
  - **Prettier:** `--write` sobre los 16 ficheros propios tocados; la deuda
    vuelve a **17** (los 17 preexistentes no se tocaron).

---

## Fase 4 — Unificación de ramas

> F3 + column-format + F7/B11. **Absorbe T1.5.**

**Precondición:** Fase 3.

- [x] **R4.1** — Modo `display` en el registro (F3) ✅ **cerrada 2026-10-09**
  - **Pasos:** cada descriptor de campo declara si sabe pintarse en `display`;
    si no, `display` por defecto según tipo.
  - **Hecho cuando:** hay descriptor para los 20.
  - **Estado:** ✅ **hecho.**
    - **Declaración:** los 20 `fields/*/*.descriptor.ts` pasan de
      `surfaces: ['form']` a `['form', 'display']` — es la declaración que pide
      F3. **No** se añade `descriptor.display`: nadie lo leería hoy y sería
      código muerto — **D38**.
    - **Componente por tipo:** carpeta nueva `src/app/fields/display/` con
      `display-defaults.ts` (tabla `DISPLAY_POR_DEFECTO: Record<FieldType,
DisplayLoader>` + `displayLoader(type)`) y 6 componentes perezosos:
      `display-text` (los 13 textuales) · `display-date` · `display-number`
      (`number`+`currency`) · `display-badge` (`boolean`+`select`, exporta
      `resolveBadgeKind`) · `display-image` · `display-list`.
    - **Host:** `render-host.ts` gana los inputs `mode`
      (`'form' | 'display'`, por defecto `'form'`), `value` y `chip`. La rama
      de display va **antes** que la de form y no toca árbol, etiqueta ni
      error; vacío (`null`/`undefined`/`''`) pinta `—` sin montar componente
      y un type fuera de la tabla degrada a `unknown-render` — **D38**.
    - **Tripwires:** `Record<FieldType, DisplayLoader>` no compila si falta un
      tipo; `displayLoader()` no lanza con un `type` inventado (el schema es
      JSON); y `contract.spec.ts` gana «todo descriptor de campo declara la
      superficie display».
    - **Specs:** `src/app/fields/display/display.spec.ts` — **25 tests** por
      host (tabla de los 20, degradación, vacío/no-vacío, paridad por tipo,
      chip de cabecera).
    - **Verificación en rojo (3 mutaciones, ejecutada):** M1 `text` sin
      `display` en `surfaces` ⇒ **6 rojos en 3 ficheros** (tripwire +
      3 de texto + cabecera de detalle) · M2 `date: TEXTO` en la tabla ⇒
      **2** · M3 `chip: false` en el host ⇒ **4 en 2** — restaurado y verde.
  - **Gates 6/6 (compartidos con R4.2):** front **305/305** (43 ficheros) ·
    api **419/419** (28) · `api:check` ✔ · `build` ✔ · prettier deuda **17** ·
    `api:drift` ✔.

- [x] **R4.2** — Migrar `detail-view` al host genérico ✅ **cerrada 2026-10-09**
  - **Archivo:** `src/app/pages/detail-view/detail-view.ts`
  - **Pasos:**
    1. Dejar de derivar `kind` a mano (`image|badge|text`).
    2. Usar `<app-render-host mode="display">`.
    3. Conservar `sections()` y `resolveFieldValue()` (agrupación).
  - **Verificación:** los 7 detalles renderizan igual (capturas antes/después).
  - **Hecho cuando:** `detail-view` no tiene plantilla propia de campo.
  - **Estado:** ✅ **hecho.**
    - **Se fue del fichero:** `formatValue`, `resolveBadgeKind`,
      `formatDateTime`, `formatActionLabel`, `resolveActionBadgeKind`, las
      constantes de formato y las ramas `image | badge | text | list` de la
      plantilla.
    - **Se quedó (agrupación):** `sections()`, `resolveFieldValue()` — que
      ahora devuelve `{ key, label, field, raw }` **sin formatear** —,
      `regularFields()`/`listFields()` (split por `esHistorial = type ===
'list' && !vacio(raw)`), `hasLargeContent()`, `<dt>/<dd>`, el `<h3>` del
      historial, `copy-share` y las acciones.
    - **Cableado:** cabecera, celdas y bloque de historial montan
      `<app-render-host mode="display" [value]="raw">`; la cabecera pasa
      `[chip]="true"` y sigue filtrando el vacío antes de pintar.
    - **Paridad de los chips de cabecera:** neutral por defecto (texto, fecha,
      número), clase de estado para `boolean`/`select`, la URL para `image` y
      «N elementos» para `list` — exactamente lo que decía el formateo previo.
    - **Desviación de verificación — D39:** no se corrieron las capturas
      antes/después; la paridad quedó en specs por tipo (los 25 de
      `display.spec.ts`) + los 5 de `detail-view.spec.ts`, con el helper
      `montar()` que espera el `load()` perezoso (`whenStable()` no cubre el
      `import()`). Sin el helper, 3 tests fallaban por el skeleton — no por
      render distinto.
  - **Gates 6/6 (compartidos con R4.1):** front **305/305** (43 ficheros) ·
    api **419/419** (28) · `api:check` ✔ · `build` ✔ · prettier deuda **17** ·
    `api:drift` ✔.

- [x] **R4.3** — `column.format` como registro (`kind: 'column-format'`) ✅
      **cerrada 2026-10-09**
  - **Archivos:** carpeta nueva `src/app/columns/` (9) + `list-view.ts` +
    `render-registry.ts` / `render-host.ts` / `contract.spec.ts`.
  - **Pasos:**
    1. Descriptores de los 7 formatos con `kind: 'column-format'`,
       `surfaces: ['list']` y `load()` con `import()` **con literal**.
    2. `RenderConfig = FieldSchema | WidgetSchema | ListColumn` y
       `config: input.required` en el host.
    3. `list-view`: fuera el `@switch`, dentro
       `<app-render-host kind="column-format" [config]="column" [data]="cellOf(row, column)" />`.
  - **Hecho cuando:** añadir un formato no toca `list-view`.
  - **Estado:** ✅ **hecho.**
    - **`src/app/columns/`:** `column-cell.ts` (contexto de celda: `row`,
      `column`, `fields`, `title`, `canUpdate`, `saving`, `currency`,
      `toggle`), `descriptors.ts` (manifiesto + `COLUMN_FORMAT_TYPES`) y
      `format-{text,number,currency,date,badge,boolean,thumbnail}.ts` —
      una pieza por `@case` del `@switch` viejo, con su doc de paridad.
    - **Se fue de `list-view` (872 → 744):** `cellValue`, `cellText`,
      `formatNumber`, `formatCurrency`, `formatDate`, `booleanValue`,
      `isSwitchColumn`, `badgeInfo`, `thumbnailSrc`, `thumbnailAlt`,
      `checkboxValue` y `NUMBER_FORMAT`. Quedan `formatOf()` (`column.format
?? 'text'`), `cellOf()` y las decisiones de la vista (`keyOf`,
      `titleOf`, `toggleActive`, `savingKey`, `canUpdate`, `currencyCode`).
    - **Criterio de éxito:** hoy se añade `format-<n>.ts` + una línea en
      `descriptors.ts` y **no se toca `list-view`**.
    - **Tripwires en `contract.spec.ts` (+3):** los formatos entran en
      `RECORRIDOS`; «todo `format` declarado en un schema tiene descriptor»,
      «hay columnas con `format` declarado» (la queja de que los tests pasan
      con la tabla vacía) y «los 7 de la unión tienen descriptor» (`satisfies`
      - `Exclude`, en el molde de `TIPOS_WIDGET`).
    - **Verificación en rojo (R4.3):** M1 (`currency` fuera del manifiesto)
      = **5 rojos en 3 ficheros**; M2 (`formatOf` devolviendo siempre
      `'text'`) = **2 en 1**; M3 (celda sin `fields` = cableado de contexto
      roto) = **6 en 2** — restaurado y verde.
    - **Gotchas:** `Intl` separa el símbolo monetario con espacio duro
      (U+00A0) ⇒ los asertos normalizan; `Number(null)` es `0`, así que
      `stock: null` sigue saliendo «0» (quirk heredado, se conserva — D40);
      `nativeElement` es `any` ⇒ `querySelector<HTMLElement>` sólo sobre un
      elemento tipado; `TestBed` **no es genérico** en esta versión.
    - **Specs nuevos:** `columns/column-format.spec.ts` (20 — los 7 formatos
      montados por el host, con sus `@case`) y
      `list-view.formats.spec.ts` (3 — paridad fila a fila + 7 hosts con
      `kind="column-format"` cayendo del registro).
  - **Gates 6/6:** front **331/331** (45 ficheros) · api **419/419** (28) ·
    `api:check` ✔ · `build` ✔ · prettier deuda **17** · `api:drift` ✔.

- [x] **R4.4** — Tabla de formato por defecto según `field.type` ✅ **cerrada
      2026-10-09**
  - **Archivos:** `src/app/columns/column-defaults.ts` (nuevo) +
    `list-view.formatOf` + el doc de `ListColumn.format` + `badgeInfo`.
  - **Pasos:** declarada, no implícita; `column.format` sólo para
    sobreescribirla.
  - **Hecho cuando:** un campo sin `format` renderiza predeciblemente.
  - **Estado:** ✅ **hecho.**
    - **La tabla:** `FORMATO_POR_DEFECTO: Record<FieldType, ListColumnFormat>`
      en `column-defaults.ts`, hermana de `DISPLAY_POR_DEFECTO` (R4.1) —
      `Record` = tripwire de exhaustividad **en compilación**, y
      `formatoDeColumna(column, fields)` es la única puerta que `list-view`
      usa (`column.format` → tabla por `type` → `text` si la `key` ni siquiera
      está en `fields`).
    - **Paridad con el display, dos concesiones:** `select` → `badge`,
      `date` → `date`, `image` → `thumbnail`, `number`/`currency` iguales y
      el resto `text` (idéntico al `@default` viejo); `boolean` baja al
      **interruptor** de R4.3 en vez del chip y `list` sigue siendo `text`
      porque el registro de formatos no tiene timeline (D41).
    - **Cambio visible (el que había que decidir):** las columnas sin
      `format` de `orders` (`status`, `auth_state`, `pickup_date`) y
      `products` (`availability`) pasan de valor crudo a chip con la
      **etiqueta** de la opción y fecha ya formateada; el resto de columnas
      (`ref`, `customer_name`, `name`, `category_slug`…) no se mueven.
    - **`badgeInfo` alineado con el detalle (D41):** `select` muestra
      `option.label` y los estados se clasifican con `resolveBadgeKind`
      (warning/success/danger/neutral, el criterio de la cabecera de la
      ficha); los booleanos conservan `trueLabel`/`falseLabel` con
      `success`/`danger` y el vacío sigue en «Sin dato»/`danger` — el
      vocabulario de la lista para lo que permite escribir.
    - **Verificación en rojo (R4.4):** M1 (`select: 'text'`) = **4 rojos en
      2 ficheros**; M2 (`date: 'text'`) = **4 en 2**; M3 (`formatoDeColumna`
      volviendo al `?? 'text'` implícito) = **3 en 2**; M4 (todo chip en
      `success`) = **1 en 1** — restaurado y verde.
    - **Gotchas:** los atributos **estáticos** del host sí quedan en el DOM
      (`kind="column-format"`) pero un `[type]` ligado no ⇒ los specs afirman
      por estructura (chip/fecha/interruptor/img), no por `getAttribute`; la
      fila tiene una celda de acciones al final ⇒ `slice(0, n)`; `SlugField`
      exige `from`.
    - **Specs nuevos:** `columns/column-defaults.spec.ts` (5 — catálogo
      completo, paridad tipo a tipo, precedencia de la declaración y
      degradación) y 2 en `list-view.formats.spec.ts` (columnas **sin**
      `format` pintando por tipo).
  - **Gates 6/6:** front **339/339** (46 ficheros) · api **419/419** (28) ·
    `api:check` ✔ · `build` ✔ · prettier deuda **17** · `api:drift` ✔.

- [x] **R4.5** — Auditoría de componentes compartidos (absorbe T1.5) ✅
      **cerrada 2026-10-09**
  - **Pasos:** los 10 de `shared/components/` — grep de
    `orders|pickpass|dashboard` dentro de cada uno.
  - **Verificación:** 0 referencias (los `*.spec.ts` de integración sí
    valen).
  - **Hecho cuando:** los 10 pasan o las excepciones están en §6.
  - **Estado:** ✅ **los 10 pasan — sin excepciones para §6.**
    - `badge · button · confirm-dialog · copy-share · drawer · empty-state ·
modal · post-create-modal · skeleton · toast` → **0** referencias a
      dominio fuera de specs.
    - Comprobación extra (no la pedía el plan): ninguno importa de `pages/`
      ni de `schemas/` y ninguno tiene endpoints endurecidos; el único
      acoplamiento transversal es `post-create-modal` →
      `actions/action-registry`, que es genérico (resuelve
      `share`/`copy-share` del schema) y no de dominio.
    - `post-create-modal.spec.ts` sí nombra dominios — permitido: es el
      spec de integración.
    - **Auditoría, no cambio:** no se tocó código; los gates corrían sobre
      el estado de R4.4.
  - **Gates 6/6:** front **339/339** (46 ficheros) · api **419/419** (28) ·
    `api:check` ✔ · `build` ✔ · prettier deuda **17** · `api:drift` ✔.

- [x] **R4.6** — Validadores extensibles y compartidos (F7 + B11)
  - **Front:** `src/app/core/registry/field-validators.ts` (nuevo). Un
    validador = **una entrada** (`name` + `declares` + `register`) nombrada
    con `ValidatorName` (15 nombres, mismo vocabulario que el back).
    `form-schema.ts` queda **sólo** con lo que no es validador: ciclo de vida
    (visible/readonly/dependencias) y estructura (`group`, `list`,
    `string-list`), más el bucle que recorre el registro — **538 → 255
    líneas** y añadir una regla ya no lo toca.
  - **Back:** `23-validate.js` gana la tabla `VALIDATORS_` (28 entradas) con
    `validatorIssue_()` (mensaje byte a byte + código `VALIDATION_*`) y
    `validationCode_()`; `24-crud.js` (2 call sites) y `capabilities/checks.js`
    (7) pasan a hablar por código. Nuevos: `date-min` / `date-max` (rango de
    fechas que el back no validaba).
  - **Vocabulario compartido (B11):** `scripts/contract-check.mjs` — check 11
    compara `ValidatorName` (front) con `VALIDATORS_` (back), front ⊆ back;
    un nombre de un lado sin su entrada en el otro es ROJO. Corre dentro de
    `npm run api:check`.
  - ⚠️ **Conservar la forma exacta de `serverErrors[prefix+key]`** — resuelto:
    `ErrorMapperService.map()` traduce `error.errors[]` a
    `fields[path] = mensaje` con las claves exactas que `render-host` ya
    leía; `applyServerErrors` no cambió. Sin ruta pintable, el mensaje del
    sobre sigue en `general`.
  - **Bug encontrado y arreglado:** `unique` sólo se declaraba en tipos sin
    `case` propio, así que `products.sku` y `orders.ref` (tipo `text`)
    declaraban la regla y **no se aplicaba**; el gate pasó a `TEXT_TYPES`.
  - **Hecho cuando:** añadir un validador = 1 entrada en cada lado ✅
    (entrada `ValidatorName` + entrada `VALIDATORS_`; el contract check los
    obliga a ir juntos).
  - **Rojos: 77** — back **62** (5 mutaciones: 41 / 16 / 3 / 1 / 1) ·
    front **13** (4 mutaciones: F1 4, F2 5, F3 1, F4 3) ·
    contract check **2** (M6 nombre del front sin back, M7 back sin validador).
  - **Gates 6/6:** front **361/361** (48 ficheros) · api **462/462** (29) ·
    `api:check` ✔ · `build` ✔ · prettier deuda **17** · `api:drift` ✔.

- [x] **R4.7** — Gates de la fase
  - Corrida fresca, sin cambios entre R4.6 y acá:
    front **361/361** (48 ficheros) · api **462/462** (29) · `api:check` 4
    VERDE, 0 ROJO · `build` ✔ · prettier deuda **17** (los mismos 17 ajenos) ·
    `api:drift` ✔.
  - Fase 4 cierra con **77 rojos contados** (62 back · 13 front · 2 contract)
    y con D42 resuelta dentro de R4.6.

---

## Fase 5 — Backend declarativo

> B2 + B3 + B9 + B10. **Con overrides O2, O4, O5.**

**Precondición:** Fase 3 (B1 necesario).

- [ ] **R5.1** — Endpoints con `input`/`output` (B2)
  - **Pasos:**
    1. Añadir `input`, `output`, `cache`, `since` a `REGISTRY.endpoints`.
    2. `input`/`output` usan **el mismo vocabulario `FIELD_TYPES`**.
    3. El router valida la entrada **antes** de llamar al handler (dev: también
       la salida).
    4. ⚠️ **O2:** rutas **lógicas** — sin verbos HTTP ni `:id` en el path; la
       ruta lógica viaja en el cuerpo (`route`, `op`), como hoy.
    5. `fail-closed` como default.
  - **Hecho cuando:** un endpoint sin `input` declarado no rompe, pero uno con
    `input` inválido rechaza.

- [ ] **R5.2** — Generación de documentación desde endpoints
  - **Salida:** OpenAPI-lite + contrato para el front.
  - **Hecho cuando:** `npm run api:check` regenera/valida la doc.

- [ ] **R5.3** — CRUD configurable por recurso (B3)
  - **Estructura:** `operations: { list, read, create, update, delete,
reorder, bulk }` con cada una encendible/apagable.
  - **No declarada ⇒ 405** (fail-closed).
  - ⚠️ **O2:** rutas lógicas.

- [ ] **R5.4** — Acciones de dominio en el back (B3)
  - **Declaración:** `actions: { markDelivered: { from, set, hooks } }`
  - **Se publican solas** como `POST /admin/<recurso>/:id/actions/<name>`.
  - **Son** lo que invoca `action.type: 'trigger'` del front (R3.12).

- [ ] **R5.5** — Máquinas de estado simples
  - **Declaración:** `transitions: { pending: ['ready','cancelled'], … }`
    validadas por el motor.
  - **Reemplaza** los `checks` ad hoc tipo `history-append-only`.

- [ ] **R5.6** — Hooks con contrato (B9) ⚠️ **O4**
  - **Estructura:** `beforeCreate` (puede modificar/vetar) · `afterCreate` ·
    `afterUpdate` · `onStatusChange`.
  - **Requisitos:** orden determinista, **idempotentes**, política de fallo
    `onError: 'ignore' | 'log' | 'compensate'`.
    ⚠️ **Sin `rollback`** — Sheets no lo soporta (O4).
  - **Evento interno único** `emitEvent_(name, payload)` → suscripciones
    futuras sin tocar el CRUD.

- [ ] **R5.7** — `computed` extensible (B10)
  - **Registro con `argsSchema`:** `slug(from)`, `sequence(prefix)`, `uuid`,
    `hash(field)`, `copy(field)`, `now`, `currentUser`,
    `lookup(resource, field)`.
  - **Se declara por operación** (`create`/`update`).

- [ ] **R5.8** — Gates de la fase

---

## Fase 6 — Datos declarativos

> B6 + F8. widgets sin handler.

**Precondición:** Fases 3 y 5.

- [ ] **R6.1** — Vistas más potentes (B6)
  - **Ampliar aditivamente** `27-views`: `where` con lenguaje estructurado,
    `sort` por array, `select` (proyección **por vista**), `page`, `expand`.
  - **Operadores** desde el registro `operators` (compartido con el front).

- [ ] **R6.2** — Agregaciones (B6)
  - **Declaración:**
    `aggregates: { ventas_por_dia: { fn: 'sum', field: 'total', groupBy: 'day(created_at)', view: 'entregados' } }`
  - ⚠️ **D9-5:** definir el alcance realista en Sheets antes de implementar.

- [ ] **R6.3** — Widgets alimentados por agregados
  - **Pasos:** `metric-card`, `chart-line`, `bar-chart` leen del agregado;
    el handler `dashboard` **deja de ser código a mano**.

- [ ] **R6.4** — Paginación estandarizada
  - **Respuesta:** `{ items, nextCursor, total? }`.

- [ ] **R6.5** — Fuentes de datos declaradas (F8)
  - **Para widgets, relations y selects:**
    `source: { resource, view, params, labelField, valueField }`
  - **Registro de fetchers** + caché por `resource+view+params`.

- [ ] **R6.6** — Gates de la fase

---

## Fase 7 — Contrato, audiencias y políticas

> **Cuidado: O1 gobierna esta fase.** No hay codegen `DATA→ui`.

**Precondición:** Fases 1 y 2.

- [ ] **R7.1** — `contract-check` por consumidor (O1)
  - **Pasos:**
    1. El schema del **back** y el del **front** siguen **independientes**.
    2. `contract-check` vigila **por consumidor**: lo que el back proyecta
       para una audiencia ↔ lo que ese front declara consumir.
    3. **No** generar `schemas/*.data.ts` desde `/admin/schema`.
  - **Hecho cuando:** `enum`/`required`/`validators`/`default` no pueden
    divergir **sin que falle la verificación** (no por codegen).

- [ ] **R7.2** — Audiencias en recursos (auth §4.8)
  - **Declaración aditiva** — `exposeToFront` actual equivale a
    `audiences.admin`:
    ```js
    audiences: {
      admin:  { listProjection: [...], operations: [...] },
      public: { listProjection: [...], views: ['activos'], operations: ['list','read'] },
    }
    ```
  - **Lo público es lista blanca estricta**: sólo lectura, sin campos
    internos (`cost`, `stock`, ids de gestión).
  - **Ningún recurso `_users`/`_audit`/interno tiene audiencia `public`.**

- [ ] **R7.3** — `contract-check` por audiencia
  - **Verifica:** rutas de recursos del front ⊆ audiencia correspondiente del
    back · claves de login del front ⊆ `input` de `/auth/login`.
  - **Prueba:** un token de admin **no** cambia el resultado de `/public/*`.

- [ ] **R7.4** — Políticas más finas (B8)
  - **Por operación:** `policies: { list: 'staff', delete: 'admin' }`.
  - **Por campo:** `field.access: { read, write }` — el campo **ni viaja** si
    no corresponde.
  - **Por fila** (`scope`): condición declarativa que filtra qué filas ve cada
    rol.
  - **Siempre fail-closed.**

- [ ] **R7.5** — Consumo de políticas en UI (F10)
  - **`policies` gobiernan botones, campos y acciones** (ocultar /
    solo-lectura) sin código por vista.
  - ⚠️ **Sólo UX** — el back vuelve a verificar siempre.

- [ ] **R7.6** — Tipo `secret` + recurso `users` (auth §7.5)
  - **Tipo nuevo** en `FIELD_TYPES`:
    `{ storage: 'column', sheetFormat: 'text', readable: false, writeOnly: true }`.
  - **Excluido** de `listProjection`, de `/admin/schema` y de cualquier
    respuesta, siempre.
  - **Recurso `users`** declarado como cualquier otro (auth §4.2), con
    `policies: { … : 'role:admin' }`.

- [ ] **R7.7** — Prueba de fuga
  - **Verificación:** ninguna respuesta contiene `pass_hash`, `pass_salt` ni
    `token_version` — test automatizado.

- [ ] **R7.8** — Gates de la fase

---

## Fase 8 — Reforma de los tres recursos

> Absorbe T3.x, T4.x y T5.x del plan anterior.

**Precondición:** Fases 3, 4, 5 y 7.

### 8.1 Front

- [ ] **R8.1** — `orders.schema.ts`
  - Verificar `listColumns` ⊆ `listProjection` (hoy `pin` **no** está).
  - Verificar `postCreate.summaryFields` — **D11**: ¿entra `pin`? (R9)
  - Justificar cada `label`/`help`/`section`/`width`/`hiddenOn`/`readonlyOn`
    con un comentario de **una línea**.

- [ ] **R8.2** — `pickpass.schema.ts`
  - Verificar `pin_ttl_hours` y `pin_enabled` (hoy sin runtime que los lea).
  - **D12:** implementar TTL/`pin_enabled` **o retirar los campos** (configurar
    algo que no hace nada = error de UX).

- [ ] **R8.3** — `dashboard.schema.ts`
  - Verificar `record-list.action.routeTemplate = '/orders/{ref}'` y
    `quick-actions.navigateTo = '/orders/new'` contra `shell.routes.ts`.
  - Verificar `source: 'payload'` de `status-progress` contra la respuesta
    real del endpoint.
  - **D13:** `bar-chart`/`chart-line` existen y ningún schema los declara →
    ¿se usan o se retiran?

### 8.2 Back

- [ ] **R8.4** — `orders.js`
  - `listProjection` contra `listColumns` (regla R1.6 ya activa).
  - Las 4 `views` — ¿se consumen las 4?
  - `checks` (`not-in-sheet`, `no-auth-after-delivered`,
    `history-append-only`) ¿cubiertos por tests?
  - `policies.cache.ttl: 60` frente a `audit: true` y `lock: true`.

- [ ] **R8.5** — `pickpass.js`
  - `kvColumns` contra la hoja real (singleton KV).
  - `policies.cache.ttl: 300` — ¿se invalida al cambiar `public_base_url`?
  - Resolución de D12.

- [ ] **R8.6** — `dashboard.js`
  - `sheet: null` — confirmar el guard (ya en `02-setup-sheets.js:119`).
  - `exposeToFront: true` con `fields: []` — ¿necesita exponerse? (R7.1)
  - `policies.access` coherente con el endpoint `admin`.

### 8.3 Integración pública (D1 resuelta)

- [ ] **R8.7** — Documentar el contrato público
  - **Contexto:** la app pública vive en **otro repo**; `/p/{ref}` es
    correcto tal cual (rutas dinámicas). **No se construye nada aquí.**
  - **Pasos:** anotar las rutas que ese repo llama y compararlas con
    `publicOrder` (`GET /p/orders/:ref`) y `pinVerify`
    (`POST /p/orders/:ref/pin`), incluida la forma del body y los códigos.
  - **Hecho cuando:** no hay diferencia entre lo que el back expone y lo que
    esa app llama.

- [ ] **R8.8** — Cerrar R10 (pedidos sin PIN recuperable) — **D14**
  - **Opción A:** recrear los pedidos previos.
  - **Opción B:** implementar regeneración (transform + fila + sustitución de
    la fila en `_pin` en **la misma transacción** — hacerlo en dos pasos deja
    el hash desincronizado).

- [ ] **R8.9** — TTL y estado del pedido (R3)
  - Si D12 implementa: `pin-verify` compara
    `created_at + pin_ttl_hours` contra `now` y rechaza
    `ENTREGADO`/`CANCELADO`.
  - **Tests:** vigente · expirado · entregado · cancelado.

- [ ] **R8.10** — Gates de la fase

---

## Fase 9 — Expansión (opcional, según necesidad)

**Precondición:** fases anteriores. **Bajo riesgo — ya hay base.**

- [ ] **R9.1** — Vistas como tipos registrables (F4)
  - `kind: 'view'`: `list · detail · form · dashboard` (existentes) +
    `kanban · calendar · tree · timeline · map · wizard` (futuras).
  - `shell.routes.ts` genera rutas desde `schema.views` por `type`.
- [ ] **R9.2** — Layout declarativo (F5)
  - `kind: 'layout'`: `grid`, `tabs`, `sections`, `steps`, `columns`.
  - `colSpan` y `section` quedan como casos particulares.
- [ ] **R9.3** — Adaptadores de storage (B5)
  - Interfaz `adapter` sobre `21-repo`: `readAll`, `append`, `update`,
    `remove`, `query`, `ensureSchema`.
  - Hoy `sheets`; mañana `sql`, `firestore`, `memory` (tests).
  - `adapter` es clave del recurso (default global).
- [ ] **R9.4** — Relaciones e integridad (B7)
  - `relation` con `expand`/`include` · `onDelete`
    `restrict|cascade|nullify` formalizado · `hasMany` inversas.
- [ ] **R9.5** — Otras capacidades (B14) ⚠️ **O5**
  - Importar/Exportar · búsqueda · tipo `file` · **jobs** · **webhooks** ·
    **notificaciones** · auditoría configurable · idempotencia.
  - ⚠️ Sólo dentro de los triggers y cuotas de Apps Script.
- [ ] **R9.6** — Extras de auth (§7.6)
  - Segundo proveedor · «cerrar todas las sesiones» · rotación de `AUTH_SECRET`
    · audiencia `customer` (si D10-6 aplica).
- [ ] **R9.7** — i18n, estados y filtros declarativos (F10)
  - `label`/`help` con clave de traducción · `emptyState`/`errorState` ·
    `filters` usando el registro con `surface: 'filter'`.

---

## Fase 10 — Cierre

- [ ] **R10.1** — Destino de `confirm-dialog` — **D15** _(absorbe T1.4/T7.1)_
  - 0 usos hoy. **Usarlo** (p. ej. en las acciones con `confirm: true`) o
    **retirarlo**. No se decide solo.
- [ ] **R10.2** — Destino de `POST /admin/events` — **D16** _(absorbe T2.2/T7.3)_
  - 0 usos front. Retirar o justificar.
- [ ] **R10.3** — Criterio de éxito §0 recorrido _(absorbe T7.4)_
  - **Pasos:** recorrer la tabla de §0 y ejecutar cada «añadir X» en un ramal
    de prueba.
  - **Hecho cuando:** ninguno obliga a editar `engine/`, `FieldHost`,
    `WidgetHost` ni una vista.
- [ ] **R10.4** — Anti-patrones auditados (refactormotor §7)
  - `grep` de `if (type ===` fuera de descriptores · lógica de negocio en
    vistas/engine · lambdas en schemas · `isFoo`/`hasBar` sueltos · handlers
    a medida para lo que es view/aggregate/action.
  - **Hecho cuando:** 0 hallazgos.
- [ ] **R10.5** — Tests dorados por descriptor
  - Cada tipo/acción/operador con al menos un caso mínimo (documentación +
    regresión).
- [ ] **R10.6** — CI bloqueante
  - `contract-check` + `sheet-check` + test de registros + meta-schema.
  - **Si falla, no se despliega.**
- [ ] **R10.7** — Reejecutar gates y comparar contra el baseline (R0.2)
- [ ] **R10.8** — Actualizar `doc/motor-renderizado-actual.md` con el estado
      final
- [ ] **R10.9** — Archivar este documento al cerrarse _(el plan anterior ya
      se borró con D8 en el Plan 1)_

---

## §3. Mapa de absorción del plan anterior

| Plan anterior | Tarea                      | Dónde vive ahora                               |
| ------------- | -------------------------- | ---------------------------------------------- |
| Fase 0        | T0.1 baseline              | R0.2                                           |
|               | T0.2 (D1)                  | **Resuelta** — app pública en otro repo → R8.7 |
|               | T0.3 definición de motor   | §0 de este documento                           |
| Fase 1        | T1.1 acciones              | **R3.9–R3.12**                                 |
|               | T1.2 unificar patrón       | **R3.1–R3.8**                                  |
|               | T1.3 exhaustividad         | **R3.7**                                       |
|               | T1.4 confirm-dialog        | **R10.1**                                      |
|               | T1.5 componentes genéricos | **R4.5**                                       |
| Fase 2        | T2.1 inventario endpoints  | **R0.8**                                       |
|               | T2.2 `events`              | **R10.2**                                      |
|               | T2.3 `exposeToFront`       | **R7.1/R7.2**                                  |
|               | T2.4 contract-check        | **R1.6**                                       |
|               | T2.5 sheet-check           | **R1.2**                                       |
| Fase 3        | T3.1–T3.3                  | **R8.1–R8.3**                                  |
| Fase 4        | T4.1–T4.3                  | **R8.4–R8.6**                                  |
| Fase 5        | T5.1 contrato público      | **R8.7**                                       |
|               | T5.2 ruta pública          | ❌ **cancelada** (D1 resuelta)                 |
|               | T5.3 R10 PIN               | **R8.8**                                       |
|               | T5.4 TTL/estado            | **R8.9**                                       |
| Fase 6        | T6.1 test e2e mensaje      | **R1.8**                                       |
|               | T6.2 test back pin         | **R1.9**                                       |
|               | T6.3 README gates          | **R0.7**                                       |
| Fase 7        | T7.1–T7.5 limpieza         | **R10.1, R10.2, R10.7, R10.9**                 |

---

## §4. Decisiones pendientes

| ID      | Decisión                                                                                                                                                                                                                                          | Bloquea                 | Estado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D9**  | `refactormotor` §9 — 6 decisiones                                                                                                                                                                                                                 | R0.3                    | ✅ **resueltas** → §6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **D10** | `auth` §9 — 7 decisiones                                                                                                                                                                                                                          | R0.4                    | ✅ **resueltas** → §6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **D8**  | Absorber `plan-motor-de-renderizado.md`                                                                                                                                                                                                           | R0.5                    | ✅ **absorbido y borrado**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **D11** | ¿`pin` en `postCreate.summaryFields`? (R9)                                                                                                                                                                                                        | R8.1                    | abierta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **D12** | ¿Implementar TTL/`pin_enabled` o retirar campos?                                                                                                                                                                                                  | R8.2                    | abierta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **D13** | ¿Usar `bar-chart`/`chart-line` o retirarlos?                                                                                                                                                                                                      | R8.3                    | abierta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **D14** | R10: recrear pedidos o regenerar PIN                                                                                                                                                                                                              | R8.8                    | abierta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **D15** | `confirm-dialog`: usar o retirar                                                                                                                                                                                                                  | R10.1                   | abierta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **D16** | `POST /admin/events`: retirar o justificar                                                                                                                                                                                                        | R10.2                   | abierta                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **D17** | R1.7: `configSchema` no existe; `tsc` ya cubre `type`/`format`/`action`                                                                                                                                                                           | R1.7                    | ✅ **resuelta** → R1.7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **D18** | `public_base_url` nunca llega al modal de alta: ¿cómo se lo pasa?                                                                                                                                                                                 | R1.8                    | ✅ **resuelta** → R1.8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **D19** | KDF de contraseña: costo, formato y tarea que lo implementa                                                                                                                                                                                       | R2.2, R2.5              | ✅ **resuelta** → R2.1b                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **D20** | Ruta de verificación de PIN: `/p/pin/:ref` o `/p/orders/:ref/pin`                                                                                                                                                                                 | R2.5 (contrato público) | ✅ **resuelta** → A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **D21** | El token admin antiguo no tiene fila en `_users`: ¿qué identidad es?                                                                                                                                                                              | R2.6                    | ✅ **resuelta** → C                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **D22** | El admin token estuvo **en claro** en `environment.ts` (commits `d715be6`, `946669b`)                                                                                                                                                             | R2.12 · Fase 10         | ⚠️ **abierta** — R2.12 lo borró del árbol; queda en el **historial git** → rotar exige autorización                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **D23** | `GAS_TOKEN` caducaba cada 6 h y nada lo renovaba: los scripts de humo pierden la sesión                                                                                                                                                           | R1.11 · R2.18           | ✅ **resuelta** → auto-login en `scripts/smoke-auth.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **D24** | El setup pedía clave **y** valor a mano; `bootstrapAdmin_` sólo aceptaba argumentos                                                                                                                                                               | R1.11 · R2.18           | ✅ **resuelta** → `setupAll()` único + props creadas por el setup                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **D25** | `ADMIN_PASSWORD` no alcanza la fila de `_users`: el admin se creó con la contraseña **generada** del primer run                                                                                                                                   | R1.11 · R2.18           | ✅ **resuelta** → `bootstrapAdmin_` **reconcilia** la fila si hay contraseña explícita (auth.md §4.7 enmendado)                                                                                                                                                                                                                                                                                                                                                                                                           |
| **D26** | `import.meta.glob` no sobrevive a `ng build` (esbuild no implementa el transform)                                                                                                                                                                 | R3.2                    | ✅ **resuelta** → registro manual (§4.3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **D27** | `NgComponentOutlet` no emite `ɵɵcontrol`: sin `[formField]` en la plantilla los `FormValueControl` no arrancan                                                                                                                                    | R3.4                    | ✅ **resuelta** → `multiselect` e `image` declarados a mano en `render-host.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **D28** | `whenStable()` no espera al `import()` perezoso del descriptor: el control llegaba tarde al siguiente ciclo                                                                                                                                       | R3.5                    | ✅ **resuelta** → `PendingTasks.run()` en `render-host.ts` + `goToError` espera la estabilidad                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **D29** | El motor cableaba los inputs de cada tipo con un `switch` (`group`/`list`/`slug`); con 6 widgets serían 9 casos                                                                                                                                   | R3.6                    | ✅ **resuelta** → `RenderDescriptor.inputs`: el cableado vive en cada descriptor                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **D30** | El `@defer (on viewport)` de `chart-line` vivía en `WidgetHost`, que deja de conocer tipos                                                                                                                                                        | R3.6                    | ✅ **resuelta** → el defer pasa al propio `ChartLine`; el chunk lo abre `descriptor.load()`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **D31** | R3.7 pide asegurar que `column.format` y `action.type` tienen descriptor, y ninguno de los dos tiene registro aún                                                                                                                                 | R3.7                    | ✅ **resuelta** → constancia en el test + `renderKinds()`. Con R3.9/R3.10 las acciones tienen registro y recorrido propios (`actions/contract.spec.ts`) y no son un `kind` de render, así que el tripwire queda sólo para `column.format` (R4.3)                                                                                                                                                                                                                                                                          |
| **D32** | Un tipo de campo nuevo obliga a añadir `case` en `shared/utils/seed.ts` — fichero compartido, fuera de la lista de §0                                                                                                                             | R3.8                    | ✅ **resuelta (B)** → `RenderDescriptor.seed` como **dato**; `seed.ts` deja de despachar por tipo y un tipo nuevo no lo toca                                                                                                                                                                                                                                                                                                                                                                                              |
| **D33** | `argsSchema` no tenía vocabulario declarado, ni estaba dicho si las categorías de datos llevan `run`                                                                                                                                              | R3.13, R3.15            | ✅ **resuelta** → R3.13/R3.15 + **§D33**: `ARGS_TYPES_`, `run: null` en datos, `capabilityArgsIssues_` único                                                                                                                                                                                                                                                                                                                                                                                                              |
| **D34** | `since` no tiene release de proyecto: ¿qué versión se declara en cada capacidad heredada?                                                                                                                                                         | R3.13                   | ✅ **resuelta** → `'1.0'` para todo lo heredado (el campo existe para el día que haya releases)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **D35** | `api/.clasp.json` (local, gitignored) tenía `filePushOrder` con las 4 rutas borradas y sin `capabilities/`                                                                                                                                        | R3.14                   | ✅ **resuelta** → reescrito a 32 entradas verificadas; **no viaja en el commit** (fichero no versionado) — se recrea a mano al clonar                                                                                                                                                                                                                                                                                                                                                                                     |
| **D36** | R3.13 y R3.14 no se pueden cerrar por separado: el tripwire del contrato uniforme sólo pasa con la migración hecha                                                                                                                                | R3.13, R3.14            | ✅ **resuelta** → ejecutadas como **un solo lote**; gates corridos una sola vez, al cierre de R3.14                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **D37** | `api/README.md` y `api/MAPA.md` ya estaban desactualizados en cosas que este cambio no toca (`04-registry`, `03-resources-*`, «21 tipos»)                                                                                                         | —                       | ⚠️ **abierta** — fuera del alcance de la Fase 3; sólo se actualizaron los nodos que movían                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **D38** | F3 dice «cada descriptor declara si sabe pintarse en `display`; si no, `display` por defecto según tipo»: ¿dónde vive la declaración y dónde el componente?                                                                                       | R4.1, R4.2              | ✅ **resuelta** → la declaración es `surfaces: ['form', 'display']` en los 20 descriptores (superficie que el modelo ya tenía) y el componente sale de `DISPLAY_POR_DEFECTO: Record<FieldType, DisplayLoader>` en `fields/display/`. Sin `descriptor.display` (nadie lo leería: código muerto). Los 6 display comparten la forma `{ field, value, chip }` porque `ngComponentOutletInputs` no admite claves no declaradas                                                                                                 |
| **D39** | R4.2 pide verificar «los 7 detalles renderizan igual» con capturas antes/después, y no hay infraestructura de capturas                                                                                                                            | R4.2                    | ✅ **resuelta (desviación registrada)** → en su lugar: tabla de paridad tipo a tipo contra el `formatValue` viejo + 25 specs de display por host + los 5 de `detail-view.spec.ts`; la mutación M3 (`chip` sin pasar) deja el chip de cabecera en rojo                                                                                                                                                                                                                                                                     |
| **D40** | R4.3 mueve el formateo al registro: ¿se aprovecha para «arreglar» los quirks que el `@switch` viejo heredaba (`null` → «0» en número, objeto → `[object Object]`) y para cambiar la verificación?                                                 | R4.3                    | ✅ **resuelta** → **paridad estricta**: los 7 formatos copian el comportamiento previo y sólo se movieron de sitio; normalizar el vacío sería otra decisión con su propia migración (los tests dejan constancia del quirk en el propio nombre). La verificación son specs de paridad (20 unit + 3 de integración) con el mismo helper de `load()` perezoso, no capturas                                                                                                                                                   |
| **D41** | R4.4 obliga a decidir el destino de las columnas `select` sin `format` y a tocar `badgeInfo` (que hoy pinta **todo** `success`): ¿paridad estricta con la lista (`text`) o alinearse con el detalle?                                              | R4.4, D31               | ✅ **resuelta** → **alineación**: `select` → `badge` con `option.label` + `resolveBadgeKind`, porque el chip verde sin mirar el valor es peor que el texto crudo y `display-badge` ya anticipaba esta reutilización. `boolean` conserva `trueLabel`/`falseLabel` con `success`/`danger` y `list` queda en `text` (no hay timeline en el registro de formatos)                                                                                                                                                             |
| **D42** | B11 dice que «el front mapea por código para i18n» y R4.6 avisa de conservar `serverErrors[prefix+key]`, pero **el front nunca leía `error.errors[]`** (422 que llegaba como `general` y ningún campo pintado — deuda L2.4 de `plan-limpieza.md`) | R4.6                    | ✅ **cerrada en R4.6** — `ApiErrorBody.errors?: ApiIssue[]` + `ApiError.issues` (5º arg opcional, retrocompatible) + `ErrorMapperService.map()` convierte cada issue en `fields[path] = mensaje` (claves intactas para `serverErrors[prefix+key]`), `fieldPath` del sobre como fallback y `general` sólo cuando no hay ruta pintable. **Sin** `codes` en `MappedError` (YAGNI: el código queda en `ApiError.issues[].code`). Specs nuevos: `error-mapper.service.spec.ts` (4) y un test del interceptor sobre `errors[]`. |

### D17 · R1.7 «Test de contrato del front» — tres premisas

Registrada al llegar a R1.7, porque la tarea obliga a decidir algo que el plan
no previó:

1. **La ruta del plan no existe.** `src/app/core/registry/contract.spec.ts` —
   `src/app/core/registry/` no existe. El registro real es
   **`src/app/schemas/registry.ts`**. _Esto no es una decisión: es un typo,
   se corrige._
2. **`configSchema` no existe en ningún sitio.** `grep -rn "configSchema" src/`
   → 0 resultados. El paso «cada `config` valida contra su `configSchema`» es
   **inimplementable tal cual** — habría que crear el sistema desde cero.
3. **Lo que R1.7 pide ya lo garantiza `npm run build`.** Los tres registros
   son uniones de TypeScript: `FieldSchema` (`schema.model.ts:367`),
   `ListColumnFormat` (`:395`) y el `type` de acción (`:434`). Un `type`
   inventado **ya rompe `tsc`**, que es gate 4.

**El hueco real que SÍ cubre un test** y que `tsc` no cubre: que un tipo esté
en la unión de TS y **a la vez** fuera del registro de runtime —
`isSupportedFieldType()` (`field-host.ts:78`). Ahí `tsc` pasa y la UI no pinta
nada, porque el `@switch` de `field-host` no tiene `@default`.

> **Corregido al implementar:** el `@switch` de **`list-view.ts:259` sí tiene
> `@default`** (línea 301, `{{ cellText(...) }}`). Un `format` sin `@case`
> degrada a texto, no se pierde — **no hay hueco en `format`**. Y
> `runAction` degrada a «estará disponible próximamente» para lo que no
> implementa.

**✅ Resuelta (decisión del usuario): «test de drift runtime».**
Ruta corregida a `src/app/schemas/contract.spec.ts`; cláusula `configSchema`
descartada; tripwire de tipos en `field-host.ts` (cierra el hueco real en
ambas direcciones, verificado con TS2322) + tests de recorrido de tipos y de
acciones. Las divergencias `format`/`action` se documentan acá en vez de
parchearse: `format` ya degrada por `@default`, y `trigger-endpoint` queda
registrado como declaración sin implementar (véase también D16).

### D18 · R1.8 «Mensaje compartido» — `public_base_url` no llega al modal de alta

Registrada al implementar R1.8, porque el test fiel a la firma real del call
site destapó un bug que R1.8 no pedía arreglar.

**Evidencia (reproducida, no inferida):**

```
AssertionError: el enlace quedó sin dominio
Expected: "https://pickpass.app/p/ORD-999"
Received: "/p/ORD-999"
```

**Causa:** `PostCreateModal.configValues` es `input<Record<string, unknown>>({})`
(`post-create-modal.ts:85`) y **no tiene ningún `[configValues]` en todo
`src/`** — `form-view.ts:420-425` sólo bindea `schema`, `config`, `record` y
`closed`. Con el default `{}`, `interpolateTemplate` devuelve `''` para
claves inexistentes (`template-interpolator.ts:15-19`), así que
`{public_base_url}` se resuelve vacío y **el mensaje de alta se copia con la
URL rota**: `Hola Ana Pérez, puede retirar su pedido ORD-999 aquí: /p/ORD-999. …`

**Por qué ningún test lo había visto:** `post-create-modal.spec.ts` setea
`configValues` a mano en los tests 1 y 3. Los tests que no lo setean no lo
usan. **Ninguno replica el binding real de producción.**

**Alcance:** sólo el contexto de **alta**. El de lista/detalle sí funciona,
porque `list-view.ts:711` usa
`configService.buildInterpolationContext(row)`, que inyecta
`public_base_url` él mismo (`config.service.ts:64-73`). El PIN **no** está
afectado: llega por `record()`.

**La bifurcación a decidir:**

| Opción | Cómo                                                                                                      | A favor                                                                   | En contra                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **A**  | `form-view.ts` inyecta `ConfigService` y bindea `[configValues]="config.globalConfig()"`                  | Deja el componente puro y testeable                                       | El input sigue siendo un pie que cada call site nuevo puede no pisar — exactamente el bug |
| **B**  | `PostCreateModal` inyecta `ConfigService` y usa `buildInterpolationContext(record)` como hace `list-view` | Un solo sitio sabe cómo armar el contexto; **desaparece la clase de bug** | El componente deja de ser puro: hay que proveer `ConfigService` en los specs              |
| **C**  | Borrás el input `configValues` y lo resuelven todos por `B`                                               | Imposible volver a caer                                                   | Mismo costo que B + rompe los specs existentes que lo setean                              |

**Recomendación: B** — es la que ya usa el otro call site, así que además
iguala los dos caminos de interpolación.

**✅ Resuelta (decisión del usuario): inyectar `ConfigService` en el modal.**

`PostCreateModal` hace `inject(ConfigService)` — **sin `{ optional: true }`**,
a diferencia de `list-view.ts:414`, para que un provider ausente sea un
error ruidoso y no un fallback silencioso de la misma clase. Los cuatro
sitios de interpolación (título, descripción, URL y mensaje) pasan por un
único `context = computed(() => ({ ...buildInterpolationContext(record()),
...configValues() }))`: la config global es la fuente y el input `configValues`
queda como **override**.

- Fix: `post-create-modal.ts` (imports + `configService` + `context`).
- Test 5 de `post-create-modal.spec.ts` replica el binding de producción
  (sin `configValues`) y además fija el contrato del override.
- **Verificado:** 152/152 en el front. Antes del fix, el mismo test daba
  `expected '/p/ORD-999' to be 'https://…/p/ORD-999'`.

### D19 · R2.2/R2.5 «KDF de contraseña» — el plan no tiene tarea para esto

Registrada al llegar a R2.2, porque la tarea obliga a decidir algo que el plan
no previó: `bootstrapAdmin_()` tiene que **escribir** `pass_hash` y
`/auth/login` (R2.5) tiene que **verificarlo**, pero ninguna tarea R2.x
implementa el KDF.

**Evidencia:**

```
$ grep -n -i "kdf\|iteraciones\|sha-256 iterado" doc/plan-refactor-motor.md
1322: | 1 | Proveedor B — contraseña (…). KDF SHA-256 iterado con salt … |
```

Una sola línea, y está en la **tabla resumen de fases**, no en una tarea.
Dentro de Fase 2 (R2.1–R2.18) la única mención es la lista de columnas de
R2.1: aparece `pass_hash`, `pass_salt`, pero **nadie los calcula**.

Sí está mandado por `auth.md`:

- **§9.1** — «**KDF real obligatorio**: GAS no tiene bcrypt → SHA-256
  iterado con salt, **nunca SHA-256 plano**.»
- **§4.6** — «hash con sal por usuario, **comparación en tiempo constante**,
  **iteraciones ajustadas a lo que tolere el tiempo de ejecución**.»
- **§8** — «Ninguna respuesta contiene `pass_hash`, `pass_salt` ni
  `token_version`.»

**Lo que hay que decidir (3 sub-decisiones):**

1. **Coste (iteraciones).** `auth.md` sólo dice «ajustadas a lo que tolere
   el tiempo de ejecución» — es una decisión **empírica**, y no se puede
   medir acá: el hash usa `Utilities.computeDigest`, que en los specs está
   stubbeado. En producción cada iteración es una llamada a la interop
   Java de GAS. Demasiadas ⇒ el login se come cuota y tiempo; demasiadas
   pocas ⇒ un hash débil, justo lo que §9.1 prohíbe.
2. **Dónde vive el recuento de iteraciones.** Para **verificar** un hash
   iterado hace falta el mismo número. Opciones: dentro de `pass_hash`
   (autocontenido ⇒ se puede subir el coste sin romper hashes viejos),
   en una columna nueva (exige migrar `_users`), o dentro de `pass_salt`.
3. **Tarea o sub-paso.** Si es sub-paso de R2.2 y R2.5, nada lo trackea y
   puede quedarse a medias; si es tarea propia, entra al plan.

**Recomendación:** tarea propia + recuento dentro de `pass_hash`
(`s256$<iteraciones>$<hex>`), con el coste medido en el despliegue real antes
de fijarlo.

**✅ Resuelta (decisión del usuario): tarea nueva + coste medido.**

- Nueva tarea **R2.1b** (insertada ANTES de R2.2, porque `bootstrapAdmin_` ya
  necesita escribir un hash). Sin renumerar R2.2–R2.18: nada queda huérfano.
- Recuento **autocontenido en `pass_hash`** como `s256$<iteraciones>$<hex>`.
  Por eso un cambio de coste **no rompe** los hashes ya emitidos: la
  verificación reutiliza el recuento guardado en el propio hash.
- **El coste NO se fija en el código**: `setupAuth_()` lo **mide** en el
  despliegue real y lo guarda como la propiedad `KDF_ITERATIONS`. El KDF
  rechaza con `Props.require` si falta ⇒ es imposible arrancar sin haber
  medido. La sal sigue en su columna `pass_salt` (autocontenido = el hash;
  separada = la sal, para poder rotar sal sin tocar el hash).

---

### D20 · Ruta de verificación de PIN — un cambio en el árbol de trabajo que nadie decidió aquí

Registrada al correr los gates de R2.1b: `pin-verify.spec.js` empezó a fallar
(`expected '/p/pin/:ref' to be '/p/orders/:ref/pin'`) y el culpable **no** fue
nada de Fase 2.

**Línea de tiempo (mtime, no inferencia):**

| fichero                              | mtime                                  |
| ------------------------------------ | -------------------------------------- |
| `__tests__/pin-verify.spec.js`       | 10-05 20:30                            |
| `doc/plan-refactor-motor.md`         | 10-07 02:17 (ediciones de esta sesión) |
| **`schema/endpoints/pin-verify.js`** | **10-07 13:27** ← entre sesiones       |

El diff de las 13:27 cambió la ruta **y** añadió este comentario:

> `// NOTA: La ruta es /p/pin/:ref (no /p/orders/:ref/pin) porque el router de
// GAS solo soporta un nivel de parámetro al final de la ruta.`

**La afirmación es CIERTA** — verificada contra el código, no asumida:

```js
// 10-router.js:55  routeTable_()
var paramMatch = /^(.+)\/:([A-Za-z0-9_]+)$/.exec(route); // el :param debe ser el ÚLTIMO segmento
// 10-router.js:281 resolveRoute_()
var cut = path.lastIndexOf('/'); // SÓLO un segmento clave tras la base
var owner = table.keyed[path.slice(0, cut)];
```

- `/p/orders/:ref` → cae en `keyed['/p/orders']` ⇒ **funciona** (así vive
  `public-order`).
- `/p/orders/:ref/pin` → no cumple el regex (no termina en `/:name`) ⇒ se
  registra en `exact` **con el `:ref` literal**. Una petición real
  `/p/orders/ORD-1/pin` resuelve `keyed['/p/orders/ORD-1']` → `undefined` →
  **`null` → 404**.

**Conclusión: la ruta antigua nunca funcionó por HTTP.** El cambio de las
13:27 no rompe a nadie que hoy tenga algo funcionando — incluido el front,
que no construye esa ruta en ningún sitio (`grep "'/p/" src/` sólo encuentra
un comentario).

**Lo que sí hay que decidir:**

| Opción | Ruta                 | A favor                                                                           | En contra                                                                                                                                                    |
| ------ | -------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A**  | `/p/pin/:ref`        | Funciona con el router actual; es una ruta «lógica» al estilo B2; ya está escrita | Contrato menos REST que `/p/orders/:ref/pin`; hay que tocar el test                                                                                          |
| **B**  | `/p/orders/:ref/pin` | REST convencional; coherente con `public-order`                                   | Exige **ampliar el router** para `:param` intermedio (`routeTable_`, `resolveRoute_` y el scope de política) — es una pieza compartida, y ahora devuelve 404 |

**Recomendación: A.** Corrige el test, no el router. Si algún día se quiere
B, se hace en la **Fase 4 (Unificación de ramas)**, donde ya se tocan las
rutas, y no de paso en Fase 2.

**✅ Resuelta (confirmación del usuario): A — `/p/pin/:ref`.** El usuario
confirmó que el cambio fue deliberado: la ruta larga «no funciona por algo de
AppScript», que es exactamente lo que muestra el código (`routeTable_` exige
`:param` como último segmento y `resolveRoute_` sólo recorta un segmento).

- `api/__tests__/pin-verify.spec.js` — aserción y título del `describe`
  pasan a `/p/pin/:ref`.
- `api/primitives/handlers/pin-verify.js` — comentario de cabecera al día.
- `api/schema/endpoints/pin-verify.js` — **no se toca**: ya documenta el
  motivo con la NOTA de las 13:27.
- Ampliar el router para `:param` intermedio queda como posibilidad en
  **Fase 4**.

---

### D21 · El token admin antiguo no tiene fila en `_users` — abierta al llegar a R2.6

Registrada al cerrar **R2.5**, porque R2.6 (la cadena de §3.4) no puede
empezar sin resolverla.

**El hecho.** Hoy conviven DOS credenciales y ninguna es la otra:

|                       | Token admin antiguo                                    | Token de sesión (R2.3)                     |
| --------------------- | ------------------------------------------------------ | ------------------------------------------ |
| Cómo se emite         | `rotarToken` → `ADMIN_TOKEN_HASH` en Script Properties | `issueToken_` desde `authLogin`            |
| Cómo se verifica      | `requireAdmin_`: hash plano, constante                 | `verifyToken_`: firma HMAC + `exp` + `aud` |
| ¿Tiene `sub`?         | **No** — es un string suelto                           | Sí → fila de `_users`                      |
| ¿Tiene `sid`?         | **No** ⇒ no se le puede revocar (R2.16)                | Sí                                         |
| ¿Aparece en `_users`? | **No** — puede no haber ninguna fila                   | Sí                                         |

**Por qué importa ahora.** `verifyToken_` devolvería `malformed` para el
token admin antiguo, y `requireAccess_` con `access: 'session'` tampoco
tiene identidad que resolver para él. Es decir: **la cadena de R2.6 se
topa con una credencial válida que sus siete etapas no pueden describir.**
Y el contrato actual (cabecera de `core/11-auth.js`) dice que esa forma
«se verifica igual que siempre **y se asume rol admin**» — es decir, ya
hay una decisión tomada a medias, que acá no estaba escrita.

**Efecto en:** R2.6 (el ramificado), y después R2.16 (revocación —
un token sin `sid` no se puede revocar) y la Fase 10.

**Tres salidas:**

|       | Opción                                                                                                       | Qué implica                                                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | **Identidad de sistema**: el token admin antiguo → `{ role: 'admin', active: true }` sin fila ni `sub`/`sid` | Cero rotura: es exactamente lo que hace hoy. `/auth/me` responde un admin sintético. No se le aplica `token_version` ni revocación (no tiene de qué)                                     |
| **B** | El token admin antiguo sólo vale para `role:*`; `session` le devuelve 401                                    | Rompe el contrato documentado en la cabecera de `11-auth.js`                                                                                                                             |
| **C** | **Retirarlo**: desde R2.6 todo pasa por sesión                                                               | Limpio y sin dos sistemas, pero es un **cambio destructivo**: todo lo que hoy usa `ADMIN_TOKEN_HASH` deja de funcionar. Requiere que exista `authLogin` (✅ R2.5) y un plan de migración |

**✅ Resuelta → C (retirarlo).** Decisión del usuario al llegar a R2.6: un
solo sistema de credenciales, nada sin `sid` que no se pueda revocar.

**Pero C es destructivo y la orden importa.** Verificado contra el código:

- `src/app/app.config.ts:41` → `{ provide: ADMIN_TOKEN, useValue: environment.adminToken }`
- `src/app/core/services/api.service.ts:28` → lo inyecta y lo manda en **cada** petición

Es decir: **el front de hoy autentica con el token admin antiguo** y la UI
de login es **R2.10–R2.12**, todavía `[ ]`. Retirar la credencial en R2.6
dejaría toda `/admin/*` respondiendo 401 en el navegador desde R2.6 hasta
R2.12 — varias tareas con la app inutilizable.

`requireAdmin_` sólo lo consume `requireAccess_` (rama `string`), así que
el retiro se reduce a: quitar esa rama, borrar `requireAdmin_`, quitar
`ADMIN_TOKEN` del front y borrar `ADMIN_TOKEN_HASH` de `PROP_MANIFEST` y
de `setup/00-check-properties.js`. **Es un cambio corto — su problema no
es el tamaño, es cuándo.** Ver **D21.1**.

**✅ Ejecutada en R2.6** (orden 2, ver D21.1). Se borró **en el mismo
cambio que la cadena**, así que nunca convivieron los dos sistemas:

- `requireAdmin_` y la rama `string` de `requireAccess_` → `core/11-auth.js`
- `ADMIN_TOKEN_HASH` del `PROP_MANIFEST` → `00-config.js`
- rama `entry.generator === 'token'` y `rotarToken()` → `setup/00-check-properties.js`
- `Props.hashToken` → `core/13-props.js`
- `findUserByEmail_` se **mudó** a `core/11-auth.js`, no se borró

El front **sigue declarando** `ADMIN_TOKEN` (`app.config.ts:41`,
`api.service.spec.ts`): lo retira **R2.12**. Mientras tanto **no hay sesión
en el navegador** — ventana asumida en D21.1. El admin recupera acceso con
`/auth/login` + contraseña desde el commit de R2.6.

> La tabla de arriba, leída hoy, es **histórica**: la columna izquierda ya
> no existe en el código.

### D21.1 · Orden del retiro (derivada de D21-C)

Tres formas de encajarlo; ninguna cambia el «qué», sólo el «cuándo»:

|       | Orden                                                                                                                                                  | Consecuencia                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| **1** | Cadena en **R2.6** (`session` rechaza el token antiguo desde ya); `role:admin` sigue aceptándolo hasta **R2.12**; retiro completo en el paso siguiente | Cero ventana rota. Deja dos sistemas vivos unas cuantas tareas                          |
| **2** | Retiro completo **en R2.6**                                                                                                                            | Limpio desde el principio; la app queda **sin auth en el navegador** hasta R2.12        |
| **3** | Reordenar: **R2.10–R2.12** (login del front) antes de R2.6                                                                                             | El retiro llega con el reemplazo funcionando; mezcla front y back en medio de la Fase 2 |

**✅ Orden elegido: 2 — retiro completo en R2.6.** Decisión del usuario al
abrir D21.1. Consecuencia asumida: `/admin/*` responde 401 en el navegador
**desde R2.6 hasta R2.12**. Es una ventana corta y **visible** (no un fallo
silencioso) y evita mantener dos sistemas de credenciales vivos «unas
cuantas tareas». El contrato que R2.9 debe interpretar ya no puede
encontrar nunca más un token admin antiguo.

---

### D23 · El token de los scripts de humo caduca cada 6 h — R1.11 · R2.18

**Problema.** `api/.gas-smoke.env` guardaba un `GAS_TOKEN` fijo, con
`TOKEN_TTL_HOURS: 6` (auth.md §9). Cualquier cosa que lo usara
(`api-regression.sh`, `sheet-drift-check.mjs`) caía a `401` cuando vencía y
nadie podía decir por qué.

**Diagnóstico — tres causas apiladas, y ninguna era el token:**

1. `GAS_URL` apuntaba al deployment **fijado a la versión 29**, no al `@HEAD`
   (el `@HEAD` devuelve HTML, no JSON). → `clasp push -f` + `clasp version` +
   `clasp redeploy -V 30` ⇒ **mismo URL, deployment @30**.
2. El despliegue anterior a Fase 2 devolvía `{"status":401,"message":"No
autorizado"}` **sin `code`**; el código actual SIEMPRE emite `code` en 401.
   → **«401 con `code`» es el detector de «este despliegue ya trae Fase 2»**.
3. La hoja `_users` no existía en el spreadsheet real ⇒
   `500 "El sistema de usuarios no está configurado"`.

**✅ Decisión: auto-login, no rotación.** `scripts/smoke-auth.mjs` obtiene el
JWT con `GAS_EMAIL`/`GAS_PASSWORD` (en `api/.gas-smoke.env`, gitignored, 0600),
lo cachea hasta 5 min antes de vencer y lo reutiliza; si faltan credenciales,
las pide por prompt **sin eco, una sola vez**, y las escribe en el env.
`sheet-drift-check.mjs` reintenta una vez con `force: true` si el endpoint
responde `401`.

**Consecuencias.** `GAS_TOKEN` deja de ser un valor que alguien tenga que
recordar refrescar, y **no hace falta rotar credenciales** — que era justo lo
que D22 dejó pendiente de autorización.

**Corrección sobre la marcha — el formato del token.** `decodeExp` asumía un
JWT de 3 partes con `exp` en segundos. El back emite
`base64url(JSON) + '.' + firma` (**2 partes**) con `exp` en
**milisegundos** (es lo que firma `issueToken_`). Resultado: `isFresh`
devolvía **siempre `false`**, o sea que la caché de D23 no existía en la
práctica y el humo se relogueaba en cada corrida — **sin ningún síntoma
visible**, porque el login funcionaba igual.

- **Fix:** `decodeExp` acepta ambos formatos y normaliza a segundos (2 partes
  ⇒ ms ÷ 1000; 3 partes ⇒ ya son segundos).
- **Red de regresión:** `api/__tests__/smoke-auth.spec.js` (+7 tests) — vive
  en `api/__tests__/` porque el runner sólo incluye `api/**/*.spec.js`
  (ver `vitest.config.ts`); no se cambió la composición de ningún gate.
- **Verificado con el token real:** `decodeExp → 1791500138`,
  `isFresh → true`, 356 min de margen, y **el token NO cambia entre dos
  corridas** (prueba de reutilización).

---

### D24 · El setup eran seis funciones sueltas en un orden que hay que recordar — R1.11 · R2.18

**Problema.** `doc/guia.md` listaba 00 → 01 → 02 → 04 → 03 → 05, a correr
**desde el editor** (auth.md §4.7: arranque inicial «nunca por endpoint»;
además `clasp run` no funciona acá — «GCP project ID is not set»). Quien
olvidara una se encontraba un error sin relación aparente con lo que faltaba
(`No existe la hoja _users` viniendo de `bootstrapAdmin_`, `Falta la
configuración de auth` viniendo de `setupAuth_`).

**✅ Decisiones — todas al servicio de «que lo único que cambie sea el valor»:**

1. **`checkProperties()` crea lo que falta.** Antes: «poné la clave y el valor
   a mano». Ahora: crea las claves manuales con `""` (una sola escritura) y
   devuelve `pendientes`; el viejo `missing` ya no aplica.
2. **`""` no vale como configurado.** `Props.require` trata `""`/blanco como
   ausente (`Falta configurar la propiedad: X`, 500). Si no, el placeholder
   que crea el propio setup degradaría el error de runtime a un vacío
   silencioso.
3. **`ADMIN_EMAIL` y `ADMIN_PASSWORD` son props** (`manual`, en
   `PROP_MANIFEST`) ⇒ el setup las garantiza presentes.
4. **`bootstrapAdmin_()` con tres fuentes, en orden:** argumentos →
   `ADMIN_EMAIL`/`ADMIN_PASSWORD` → **dueño del proyecto + contraseña
   generada** (una sola vez, impresa en el log del editor).
5. **`setupAll({seed, email, password})` es el único punto de entrada.**
   Encadena en orden y devuelve `pasos[]`; si un paso **lanza** se detiene ahí
   (nada corre a ciegas tras el fallo); un `ok:false` de `checkProperties`
   **no** detiene nada; el `409` de `bootstrapAdmin_` cuenta como «ya
   existía».
6. **Editor-only.** `setupAll` entra en `EDITOR_ONLY_FNS`; ninguna ruta lo
   declara.

**Consecuencias.** El arranque inicial pasa de «seis funciones y un orden» a
`setupAll()` una vez. Un detalle de reporte malformado **no** puede tumbar el
paso (`detalleSeguro_`): informar ≠ ejecutar.

**Verificación:** api **363 → 380** (+17: 3 de capa props, 13 de
`setup-all.spec.js`, 1 de `EDITOR_ONLY_FNS`) · mutaciones **5/5** (crear
claves · aceptar `""` · detenerse ante un lanzamiento · capa props · detalle
que no tumble el paso) · 5 gates verdes.

---

### D25 · La contraseña explícita no alcanzaba la fila del admin — R1.11 · R2.18

**Problema.** El primer `bootstrapAdmin_()` creó la fila con la **contraseña
generada** (impresa UNA sola vez: _«cópiala ahora, NO se volverá a mostrar»_).
Después el operador seteó `ADMIN_PASSWORD` en Script Properties, pero
`setupAll()` contestaba **409 «Ya existe un usuario con ese email»** — auth.md
§4.7 sólo decía _«crea la fila **inicial**»_. Resultado: `401 AUTH_INVALID` y
ninguna forma de entrar.

**Por qué no se veía desde afuera:** `/auth/login` devuelve el **mismo**
`AUTH_INVALID` para «no existe ese usuario» y «contraseña mala», a propósito
(auth.md §4.5: no puede ser un comprobador de correos con cronómetro). Sólo el
log del editor lo revelaba.

**✅ Decisión (elegida por el usuario): que `setupAll()` reconcilie.**

1. `explicita` = hay contraseña por argumento **o** `ADMIN_PASSWORD` no vacía.
2. Fila existente **sin** contraseña explícita ⇒ **409**, la fila no se toca.
3. Fila existente **con** contraseña explícita ⇒ se re-hashea y se escribe en
   `pass_salt`/`pass_hash` de **esa** fila física (`row.at`), por índice
   derivado de la cabecera.
4. Si ya era esa contraseña ⇒ **no se re-hashea** (idempotente: re-correr
   `setupAll()` no cambia lo que ya está bien).
5. `active` **no se toca**: una cuenta desactivada no se reactiva desde setup.
   Reactivar es acción de admin, nunca de setup.

**Consecuencias.** `ADMIN_PASSWORD` pasa a ser de verdad la fuente de verdad:
cambiarla en Script Properties y correr `setupAll()` la aplica. Sigue siendo
editor-only — ninguna ruta HTTP llega a `bootstrapAdmin_`.

**`auth.md` §4.7 enmendado** (aditivo): documenta la reconciliación y agrega
`setupAll()` a la lista de funciones de solo-editor.

**Verificación:** api **380 → 383** (+3: 409 sin explícita · actualiza sin
duplicar · props reconcilian · idempotente) · mutaciones **5/5** (siempre
explícita · idempotencia rota · fila equivocada · salt/hash desparejados · no
detecta la fila) · 5 gates verdes.

---

### D26 · `import.meta.glob` no sobrevive a `ng build` — R3.2

**Situación.** D9-1 planteaba dos ramas: autodescubrimiento con
`import.meta.glob` **o** registro manual de una línea. Se asumió que un
Angular 22 con Vite soportaba el glob. **No es así.**

**Evidencia (comprobado, no deducido).**

1. `ng build` usa `@angular/build:application` → **esbuild**. Un barrido de
   `node_modules/@angular/build/` no encuentra **ninguna** implementación del
   transform (`rg -l "import\.meta\.glob" node_modules/@angular/build/` → 0).
   Vite sí lo implementa, pero sólo se invoca desde
   `@angular/build:dev-server` y `@angular/build:unit-test`.
2. **Sondeo empírico decisivo:** con el módulo alcanzable desde
   `app.config.ts`, el `dist/` conserva **sin transformar** tanto la llamada
   `import.meta.glob` como el literal del patrón. En runtime eso es
   `undefined(...)` ⇒ **TypeError en el arranque**.
   > Trampa: la primera medición mintió — un `export` no usado es podado por
   > esbuild, así que el grep de `dist/` devolvía «limpio». El sondeo sólo
   > es válido con el código **alcanzable** en el grafo.
3. `tsconfig.app.json` lleva `"types": []`, así que `vite/client` habría
   exigido un `/// <reference types="vite/client" />` explícito: el mero hecho
   de compilar no prueba nada sobre el transform.
4. Además, el glob habría funcionado en `npm test` y **no** en
   `npm run build` — exactamente el tipo de asimetría que el propio código
   de `field-host` venía advirtiendo («para que lo vean por igual `npm run
build` y `npm test`»).

**Decisión.** Se toma la **otra rama que D9-1 ya contempla: registro manual**.

| Pieza                                        | Papel                                                  |
| -------------------------------------------- | ------------------------------------------------------ |
| `src/app/fields/<type>/<type>.descriptor.ts` | un fichero por tipo (R3.3)                             |
| `src/app/fields/descriptors.ts`              | manifiesto: **una línea** por tipo                     |
| `src/app/core/registry/render-registry.ts`   | importa el manifiesto y registra **a scope de módulo** |

**Consecuencias.**

- Añadir un tipo ⇒ carpeta + descriptor + **una línea** en el manifiesto.
  **Ningún host se toca**, así que el criterio de R3.8 se mantiene; sí es un
  coste más que no contemplaba el «sólo carpeta + descriptor» literal.
- El registro se llena **al importar**, no desde DI, porque
  `buildFormSchema()` es una función pura que consulta sin inyectar nada.
  `provideRenderDescriptors()` se conserva como entrada explícita de
  `app.config.ts` y avisa en dev si el manifiesto vino vacío.
- Los descriptores sólo hacen `import type` de `RenderDescriptor`, así que
  no hay ciclo: `render-registry → descriptors → 20 descriptores` es acíclico
  en runtime.
- Los componentes siguen llegando **perezosos** por `load()`; el build
  emite _shims_ de reexportación de 176–262 B por tipo y **cero duplicación**
  (todo el código de los 20 vive en un único chunk).

**Verificación:** `npm test` **202/202** · `npm run build` ✔ · `dist/` sin
rastro de `import.meta.glob`.

### D27 · `NgComponentOutlet` no emite `ɵɵcontrol` — R3.4

**Situación.** R3.4 monta los controles del registro con `NgComponentOutlet`

- `ngComponentOutletInputs`. Dos de los veinte — `multiselect` e `image`,
  los únicos que implementan `FormValueControl` — fallaban con
  `NG0952: Model is required but no value is available yet`.

**Evidencia (comprobado, no deducido).**

1. Ambos declaran `value = model.required()`, que **no puede leerse** hasta
   que la directiva `FormField` del elemento lo inicializa desde el nodo
   `[formField]`.
2. Esa inicialización vive en las instrucciones `ɵɵcontrolCreate()` /
   `ɵɵcontrol()`, que el **compilador emite en la vista donde está escrito
   el binding** (`_debug_node-chunk.mjs`: usan `getCurrentTNode()` /
   `getSelectedTNode()`). No son host-bindings de la directiva, así que no
   existen «de regalo» cuando la directiva se adjunta.
3. `NgComponentOutlet` sólo hace `ComponentRef.setInput`: al no haber HTML
   con `[formField]`, `controlDef.update` **nunca corre** y el `model()`
   queda sin valor.
4. El mismo control montado por `FieldHost` (binding estático) sí funciona —
   `form-view.a11y.spec.ts` lo cubre y está en verde.

**Primer intento descartado.** `hostDirectives: [{ directive: FormField,
inputs: ['formField'] }]` convierte `formField` en input declarado del
componente y satisface a `setInput`, pero **no crea las instrucciones de
compilación**: el error pasa de `NG303` a `NG0952`. No es un problema de
orden, es que falta el código emitido.

**Decisión.** Los dos se **declaran a mano** en la plantilla de
`render-host.ts`, con exactamente los bindings que ya usaba `FieldHost`
(`[id]` `[field]` `[formField]` y `[resource]` en `image`). Los otros 18
siguen resolviéndose desde el registro con `NgComponentOutlet`.

**Consecuencias.**

- Un tipo **nuevo que cumpla `FormValueControl`** sí exige tocar
  `render-host.ts` (una rama `@else if` de cinco líneas); el resto de tipos
  siguen siendo carpeta + descriptor. La excepción queda anotada en R3.8.
- `controlInputs` deja de cubrir `multiselect`/`image`: la tabla se queda en
  18 tipos.
- Los `hostDirectives` del primer intento se retiraron de `multiselect.ts` e
  `image.ts`: ya no montan nada por `NgComponentOutlet` y sólo añadían una
  segunda vía de entrada para un binding que sigue vivo en `FieldHost`.

**Verificación:** `npm test` **225/225** · `npm run build` ✔.

### D28 · `whenStable()` no espera al `import()` del descriptor — R3.5

**Situación.** Al delegar `FieldHost` en `<app-render-host>` los 20 controles
pasan a resolverse por `load()` (chunk perezoso, D26). Cayeron **13 tests**
con el mismo síntoma: el `<label [for]>` estaba, el control no —
`label[for=…] sin elemento`, `input` a `null` y foco perdido en un `DIV`.

**Evidencia (comprobado, no deducido).**

1. `render-host.spec.ts` ya lo advertía: _«`whenStable()` no cubre acá: el
   `import()` del descriptor es una promesa…»_ — y lo parchaba con un
   polling propio.
2. Instrumentando el montaje: el componente **sí** acababa en el `document`
   con su id correcto, pero **después** de la aserción. No era un problema de
   ancla, era de orden.
3. Descartado el camino `ComponentRef.setInput` + `setAttribute('id')`: cada
   control ya fija su ancla **desde su propia plantilla**
   (`text.ts:23` → `[id]="state().name()"`), de modo que `setInput('id')`
   lanzaba `NG0303` (no es un input declarado) y montar a mano sólo añadía
   otro ciclo asíncrono. Se revirtió al 100 %: `NgComponentOutlet` monta
   **durante** la change detection.

**Decisión.** El `load()` se registra como **tarea pendiente de Angular**
(`PendingTasks.run()`), así `whenStable()` espera el chunk igual que espera
un `fetch`. Dos consecuencias derivan de ahí:

- **Harness** — `form-view.a11y.spec.ts` espera la estabilidad tras pulsar
  cada pestaña antes de auditar. Las aserciones no cambian: sólo se espera
  el render que antes llegaba síncrono con los imports estáticos.
- **Producto** — `goToError` pasa a `async` y hace
  `await appRef.whenStable()` antes de `focusField()`. El `setTimeout(0)`
  anterior enfocaba un envoltorio que todavía no tenía control dentro, así
  que en runtime el foco se perdía al saltar a una pestaña sin cargar.

**Consecuencias.**

- El esqueleto de R3.4 ya no es cosmético: es lo que se ve mientras baja el
  chunk, y ahora la estabilidad **espera** a que termine.
- `render-host.spec.ts` conserva su polling, que pasa a ser redundante
  (innocuo) — se deja para no tocar un test verde sin necesidad.

**Verificación:** `npm test` **225/225** · `npm run build` ✔ ·
`test:api` **390/390** · `api:check` ✔ · prettier deuda **17** ·
`api:drift` ✔.

---

### D29 · El motor no puede saber qué recibe cada tipo — R3.6

**Situación.** `RenderHost` cableaba los inputs con un `switch` sobre
`cfg.type` (los tres que se apartan de la forma estándar: `group`, `list` y
`slug`). Al migrar widgets ese `switch` habría crecido con **seis** casos
más — `metric-card` quiere `{label, value, hint}` y `bar-chart`
`{label, data, unit}` —, y el criterio de R3.8 («añadir un tipo no toca el
motor») se habría roto en el momento: crear un widget de paso habría exigido
editar `render-host.ts`.

**Decisión.** El cableado se muda al descriptor:
`RenderDescriptor.inputs?: (config, extras) => Record<string, unknown>`.

- `extras` es un único objeto con lo que el host conoce y el descriptor no:
  `ctx` (árbol, errores y prefijo — sólo campo), `data` (payload — sólo
  widget) y los dos templates con los que se compone `group` y `list`.
- El host hace exactamente dos cosas: `descriptor.inputs(cfg, extras)` si el
  descriptor lo declara, o si no la **forma estándar de su `kind`** —
  `{field, tree}` en campos, `{widget, data}` en widgets.
- Se declararon `inputs` en `group`, `list`, `slug` y en los 6 widgets: el
  `switch` desapareció de `render-host.ts`.

**Por qué un objeto `extras` y no seis parámetros:** el 80 % de los
descriptores no necesita nada más que el `config`, y con una firma de un
solo objeto añadir un argumento futuro no rompe a nadie.

**Consecuencias.**

- Los 17 campos con forma estándar **no escriben `inputs`**: siguen sin tocar
  nada, que era justo la ventaja de R3.3.
- `ngComponentOutletInputs` no tolera inputs inexistentes (`NG0303`), así que
  `quick-actions` declara `inputs: (config) => ({ widget: config })` y no
  recibe `data`: es el único widget sin dato y el descriptor lo dice.
- El filtrado de series (`{label: string, value: number}`) pasó a
  `widgets/series.ts` → `toSeries()`: es una regla de validación en el
  **borde**, compartida por `bar-chart` y `chart-line`, no un detalle de
  cada gráfico.

**Verificación:** `npm test` **225/225** · `npm run build` ✔.

---

### D30 · El `@defer` de `chart-line` ya no tiene host — R3.6

**Situación.** `chart-line` se difería desde la plantilla de `WidgetHost`:
`@defer (on viewport)` + placeholder con miniatura SVG, `@loading` con
esqueleto y `@error` con `data-testid="chart-error"`. `WidgetHost` deja de
conocer tipos, así que ese bloque se queda sin casa — y meterlo en el motor
habría hecho lo contrario a R3.8: el host tendría que saber cuándo diferir.

Dos lecturas posibles, y **las dos importan** porque no miden lo mismo:

1. **Separar el chunk de 61,4 K gz.** Ése ya no lo hace el `@defer`: lo hace
   el `import('./chart-line')` del descriptor, que es lo único que puede
   partir una dependencia importada **estáticamente** desde `chart-line.ts`.
   La comprobación está en `npm run build`: `chart-line` sale como lazy chunk
   y no entra en el bundle inicial.
2. **No crear el lienzo hasta que el gráfico se ve.** Ése sí es del
   `@defer`, y es UX, no de bundle.

**Decisión.** El bloque entero pasa a `ChartLine`: **el componente es dueño
de su propia estrategia de render**. El motor sigue sin conocer ningún tipo.

**Consecuencias.**

- `viewChild('canvas')` deja de ser `required`: el lienzo sólo existe una
  vez completado el bloque. El `effect` lo lee como señal — antes era
  inerte hasta `ngAfterViewInit`, ahora basta con esperar a que aparezca.
- `sparkPoints()` se muda con el placeholder; `WidgetHost` no dibuja nada.
- El `aria-live` también baja al componente: el wrapper seguía siendo
  específico de un solo widget.
- **Tests:** jsdom no implementa `IntersectionObserver`, así que
  `chart-line.spec.ts` pasa a `DeferBlockBehavior.Manual` (como ya hacía
  `widget-host.spec.ts`) y pinta el bloque a mano: un caso nuevo para
  placeholder, otro para `Complete`. Los dos tests de defer que estaban en
  `widget-host.spec.ts` se sustituyen por uno de despacho — allí ya sólo
  corresponde comprobar que el registro devuelve el componente.
- `ChartLineWidget` y la cabecera de `chart-line.ts` describían el chunk
  viejo («el compilador parte lo que se referencia dentro del bloque»); los
  dos quedan reescritos.

**Verificación:** `npm test` **225/225** · `npm run build` ✔ (lazy chunk
`chart-line`).

---

### D31 · R3.7 pide dos registros que todavía no existen — `column.format` y `action.type`

**Situación.** El paso de R3.7 dice: recorrer los schemas y afirmar que
**cada** `field.type`, `column.format`, `widget.type` y `action.type` usado
tiene descriptor. Dos de los cuatro no pueden afirmarse hoy:

- **`column.format`** — `RenderKind` ya reserva `'column-format'` (R3.1) y
  hay **cero** descriptores. Los 7 formatos se dibujan con un `@switch` con
  `@default` en `list-view.ts`, que degrada a texto (D17 lo verificó). El
  registro llega en **R4.3**.
- **`action.type`** — el registro de acciones (`ActionDescriptor`) es
  **R3.9**, la unidad siguiente.

Y no es una omisión de implementación: `RenderDescriptor.load` devuelve un
**componente** (`() => Promise<Type>`), y un formato de columna no es un
componente — es una decisión de pintado de celda. Darles descriptor exige
antes el contrato de R4.3, que es trabajo de diseño y no de una prueba.

**Decisión.** El test deja constancia explícita del hueco en su cabecera y
**no lo maquilla**: en vez de assertar algo falso, añade el tripwire que
obligará a escribir el recorrido el día que el registro exista.

**Cómo se cierra el hueco mientras tanto.**

1. `renderKinds()` (nuevo en `render-registry.ts`) contra la lista
   `RECORRIDOS` del test: **todo `kind` con descriptor debe ser recorrido**.
   R4.3 o R3.9 registran su `kind` ⇒ el test se pone rojo ⇒ hay que ampliar
   el recorrido. Es la misma filosofía que el viaje inverso de D17.
2. La exhaustividad de `ListColumnFormat` y de `ResourceAction` sigue siendo
   de `tsc`: las tres son uniones de TypeScript (D17, premisa 3).

**Verificación en rojo (ejecutada):** sin `chartLineDescriptor` ⇒ 1 test
rojo; sin `textDescriptor` ⇒ 2 rojos. El tripwire de `kind` no se puede
provocar sin registrar un `kind` nuevo — es el que quedará rojo en R4.3.

**Verificación:** `npm test` **230/230** · `npm run build` ✔.

---

### D32 · «Añadir un tipo» obligaba a tocar un fichero compartido — `seedValue`

**Hallazgo de R3.8.** Con el tripwire D17 fuera de `FieldHost`, el
experimento `field-tmp` dejó **exactamente un** punto de fricción:
`shared/utils/seed.ts`.

```ts
export function seedValue(field: FieldSchema): unknown {
  switch (field.type) {
    /* 20 ramas */
  } // sin `default`
}
```

`noImplicitReturns` (TS7030) cortaba el build si un tipo nuevo no tenía
`case`. **No era un descuido: era fail-loud** — obligaba a _decidir_ el
valor inicial de un campo recién nacido. Un `default: return ''` lo
arreglaba en una línea y era exactamente el fallo silencioso que prohíbe la
regla 4. Pero `shared/utils/seed.ts` no está en la lista de §0 (`engine/`,
`FieldHost`, `WidgetHost`, vistas), así que R3.8 pasaba **literalmente** y
§0 quedaba con un agujero en su intención.

**Decisión: B — la siembra sale del `switch` y pasa al descriptor.**

Dos formas posibles de B, y se descarta la evidente:

|                                   | Variante                                                         | Veredicto                                                                                                                                                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1 · `seed: (cfg) => unknown`** | Función en el descriptor, como `load` e `inputs`.                | ❌ `group` necesitaría importar `seedFields`, y eso cierra el ciclo **registro → manifiesto → descriptor → `seed` → registro**. Además rompería la propiedad que hoy tienen todos los descriptores: son **datos + un `import()`**, sin lógica de dominio. |
| **B2 · `seed: 'string' \| …`**    | **Nombre** resuelto por `seed.ts`, como `surfaces` es un nombre. | ✅ **elegida.** Cero ciclo, descriptors puros, y `seed.ts` queda como único dueño de recorrer el árbol.                                                                                                                                                   |

Es además la forma que la propia regla 1 del plan describe: _«el schema es
dato puro; la lógica se **referencia por nombre** y vive en un registro»_.

**Cómo quedó.**

```ts
// core/models · el tipo que declara el descriptor
export type SeedKind = 'string' | 'number' | 'boolean' | 'array' | 'recursive';

// en cada descriptor de campo
seed: 'string',        // 12 tipos   · nacen como cadena
seed: 'number',        //  2         · `null`, nunca `0`
seed: 'boolean',       //  1
seed: 'array',         //  4
seed: 'recursive',     //  1         · `group`: siembra un nodo por hijo
```

- **`seed.ts` ya no despacha por tipo.** `seedValue` pregunta al registro:
  sin descriptor ⇒ `undefined` (**misma degradación que el render**, R1.10);
  descriptor sin `seed` ⇒ **lanza** (fail-loud).
- **Dos guardas en vez de un `default` silencioso:** el estrechado a
  `GroupField` para `'recursive'` lanza si un tipo lo declara sin subcampos,
  y **el `switch` se queda sin `default`** — de modo que ampliar `SeedKind`
  sin cubrir su rama es un TS7030 en compilación, no un `undefined` en
  producción.
- **La exhaustividad que faltaba la pone CI**, no `tsc`: `contract.spec.ts`
  afirma que **todo descriptor de campo declara `seed`** (el registro guarda
  `RenderDescriptor` con `type: string`, así que una unión no puede
  imponerse en compilación).

**Verificación (los tres casos, ejecutados en rojo).**

| Qué se probó                                       | Resultado                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Dar de alta `field-tmp` **sin tocar `seed.ts`**    | ✅ build verde; el único archivo con rastro es el manifiesto, la unión y la carpeta nueva. **`seed.ts`: cero menciones.** |
| `seed.ts` cubre 20 + 1 tipos sin cambiar una línea | ✅ 254 tests con el tipo dado de alta (el oro por descriptor lo cubre solo)                                               |
| Quitar `seed` de un descriptor                     | 🔴 **2 rojos** — el de CI y el oro de ese tipo                                                                            |
| Tras borrar el experimento                         | ✅ **6/6 gates**, **253/253** front                                                                                       |

**Lo que queda fuera de D32 (y por qué).** `form-schema.ts`, `detail-view.ts`,
`form-model.ts`, `form-view.ts`, `list-view.ts`, `depends-on.ts` y `login.ts`
siguen con `if (field.type === …)` / `switch (field.type)` propios. **Ninguno
corta el build** al añadir un tipo — son dispatch no exhaustivo —, así que no
son un agujero de §0: son el **gagüe de R10.4** («anti-patrones», Fase 10),
que es quien decide cuáles se registran y cuáles se quedan.

---

### D33 · `argsSchema` no tenía vocabulario — R3.13 · R3.15

El plan dice «sus `args` cumplir `argsSchema`» (§3.3 y todo lo que le sigue),
pero **nunca define el vocabulario** ni si las categorías de datos llevan `run`.
Sin eso la puerta única no puede juzgar nada y R3.15 no puede validar `params`.

**Resolución — vocabulario fijo `ARGS_TYPES_ = ['text','number','boolean','array','object']`:**

```js
registerCapability('computed', {
  id: 'slugify',
  since: '1.0',
  argsSchema: { sep: { type: 'text' }, keep: { type: 'boolean', required: true } },
  run: (target, args) => /* ... */,
});
```

- `{ type, required? }` — `type` obligatorio y dentro del vocabulario;
  `required` opcional (falso por omisión).
- `null` = «no tiene argumentos declarados» → **no se juzga** (así lo usan los
  14 `operators`).
- `{}` = «no admite ninguno» → cualquier `args` es un error.
- `run` **obligatorio** en las categorías ejecutables (`checks`, `computed`,
  `hooks`, `operators`, `handlers`) y **`null`** en las de datos
  (`fieldTypes`, `validators`, `adapters`): son descripciones, no código.
- El juez es **`capabilityArgsIssues_(where, schema, args)`** en
  `api/capabilities/00-register.js`. La puerta (R3.13) y la validación al
  cargar (R3.15) llaman a **la misma función**, así que «lo que entra» y «lo
  que se comprueba» no pueden divergir.
- Vocabulario cerrado a propósito: un tipo nuevo de argumento es una
  **decisión** (esto, §4), no un typo que pase al validador.

---

## §5. Nomenclatura vigente

> **Dos fuentes.** `refactormotor.md` §2 (general) + **`auth.md` §6, que
> añade el dominio de autenticación** — ver O9: se suman, no se pisan.

### 5.1 General (`refactormotor.md` §2)

### Identificadores

| Elemento                        | Convención                                                 |
| ------------------------------- | ---------------------------------------------------------- |
| Valor de `type`/`format`/`kind` | `kebab-case`, singular: `string-list`, `copy-share`        |
| Claves de schema                | `camelCase`: `listProjection`, `visibleWhen`               |
| Id de recurso                   | **`kebab-case`**, plural: `pickup-slots` (**D9-2 fijada**) |
| Hojas / columnas                | `snake_case`: `customer_name`                              |
| Columnas de grupo               | `<grupo>_<campo>`: `address_street`                        |
| Hojas hijas                     | `<recurso>_<campo>`: `orders_items`                        |
| Namespaces custom               | prefijo `x-`                                               |

### Sufijos con significado fijo

| Patrón             | Significa                        |
| ------------------ | -------------------------------- |
| `*When`            | condición declarativa            |
| `*Template`        | cadena con `{placeholders}`      |
| `*Field`/`*Fields` | referencia a clave de campo      |
| `*Projection`      | lista blanca                     |
| `on<Evento>`       | enganche a evento                |
| `expose*`          | visibilidad hacia fuera          |
| `*Ref`             | referencia a entrada de registro |

### Archivos

| Capa         | Convención                                 |
| ------------ | ------------------------------------------ |
| Campo front  | `fields/field-<type>/field-<type>.ts`      |
| Widget       | `widgets/widget-<type>/widget-<type>.ts`   |
| Acción       | `actions/action-<type>.ts`                 |
| Descriptor   | `…/<type>.descriptor.ts`                   |
| Tipos back   | `api/schema/types/NN-<categoria>.js`       |
| Recurso back | `api/schema/resources/<id>.js`             |
| Capacidades  | `api/capabilities/<categoria>/<nombre>.js` |
| Motor back   | `api/engine/NN-<nombre>.js`                |

### Funciones

- Registro: `register<Categoria>(descriptor)` — `registerFieldType`,
  `registerAction`, `registerValidator`.
- Consulta: `get<Categoria>(id)` · `isSupported<Categoria>(id)`.
- Sufijo `_` en privadas del back — **mantener**.

### 5.2 Dominio de auth (`auth.md` §6)

| Elemento           | Convención                                                     |
| ------------------ | -------------------------------------------------------------- |
| Hojas internas     | prefijo `_` + `snake_case`: `_users`, `_audit`                 |
| Script Properties  | `MAYUS_SNAKE`: `AUTH_SECRET`, `GOOGLE_CLIENT_ID`               |
| Códigos de error   | `MAYUS_SNAKE` con prefijo de dominio: `AUTH_*`, `VALIDATION_*` |
| Niveles de acceso  | `public`, `session`, `role:<nombre>`                           |
| Audiencias         | minúsculas: `admin`, `public` (futuro `customer`)              |
| Funciones privadas | sufijo `_`: `verifyToken_`, `issueToken_`, `setupAuth_`        |
| Handlers de auth   | `authLogin`, `authLogout`, `authMe`                            |
| Claims del token   | `sub`, `sid`, `v`, `iat`, `exp`, `aud` (estándar JWT)          |

> ✅ **D9-2 fijada → `kebab-case`, plural.** `refactormotor` §2.1 decía
> «`snake_case` **o** `kebab-case`» sin elegir; `auth.md` §4.2 usaba `users`
> (plural, sin separador) — **compatible con las dos**, así que no empuja. El
> «plural» se aplica **a partir de ahora**: hoy ya existen singulares
> (`dashboard`, `site`, `pickpass`); renombrarlos rompería `contract-check` y
> no aporta (§7.1: nada cambia el significado de lo existente).

---

## §6. Resumen en una página

**Orden:** **0 → 1 → 2 → 3** antes de añadir funcionalidad nueva; cada fase
deja el sistema funcionando y es **reversible por separado**.

| Fase                        | Contenido                                                                   | Impacto         | Esfuerzo   | Riesgo |
| --------------------------- | --------------------------------------------------------------------------- | --------------- | ---------- | ------ |
| **0** Punto de partida      | baseline + 13 decisiones + nomenclatura                                     | —               | Bajo       | Bajo   |
| **1** Red de seguridad      | B4 fail-loud · B12 meta-schema · contract-check · sheet-check · tests R1/R4 | **Muy alto**    | Bajo-medio | Bajo   |
| **2** Autenticación         | tokens firmados, `AUTH_*`, guards, rate-limit, `token_version`              | Alto            | Medio      | Bajo   |
| **3** Registros             | F1 render · F2 acciones · B1 capacidades                                    | **Muy alto**    | Medio      | Medio  |
| **4** Unificación           | F3 detail `display` · column-format · F7/B11 validadores                    | Alto            | Medio      | Medio  |
| **5** Backend declarativo   | B2 endpoints · B3 CRUD+actions · B9 hooks · B10 computed                    | Alto            | Medio-alto | Medio  |
| **6** Datos declarativos    | B6 views+aggregates · F8 fuentes                                            | Alto            | Alto       | Medio  |
| **7** Contrato y audiencias | O1 por consumidor · `audiences` · B8 políticas                              | Alto            | Medio      | Medio  |
| **8** Los 3 recursos        | orders / pickpass / dashboard + contrato público                            | Medio           | Bajo-medio | Bajo   |
| **9** Expansión             | F4/F5 vistas y layouts · B5 · B7 · B14                                      | Según necesidad | Variable   | Bajo   |
| **10** Cierre               | criterio §0 · anti-patrones · CI bloqueante                                 | —               | Bajo       | Bajo   |

### Decisiones de arranque — ✅ **13/13 cerradas**

Evidencia completa en **`doc/plan-limpieza.md` §5.1 (D10)** y **§5.2 (D9)**.

**D10 — `auth.md` §9 (7)** · _manda sobre D9_

| #   | Decisión                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Proveedor **B — contraseña** (`pass_hash`/`pass_salt`, tipo `secret`). KDF **SHA-256 iterado con salt** — GAS no tiene bcrypt. |
| 2   | Sesión **6 h con renovación deslizante + tope absoluto de 7 días**                                                             |
| 3   | «Recordarme» → **`sessionStorage`**, nunca `localStorage`                                                                      |
| 4   | Roles → **sólo `admin` asignado**; `staff` queda como valor reservado del vocabulario (**D12**)                                |
| 5   | Formato de respuesta → **conservado** (**O7**): `{ error: { status, message, errors? } }`                                      |
| 6   | Cuentas de cliente → **no** (audiencia `customer` declarada pero sin usar)                                                     |
| 7   | Logout individual → **«best-effort» aceptado** (`token_version` invalida todas las sesiones del usuario)                       |

**D9 — `refactormotor.md` §9 (6)**

| #   | Decisión                                                                                          |
| --- | ------------------------------------------------------------------------------------------------- |
| 1   | **Autodescubrimiento + `api:check`** — sin manifiesto central (GAS carga todos los `.js`)         |
| 2   | Id de recurso → **`kebab-case`**, plural. `snake_case` sólo en hojas, columnas y Properties       |
| 3   | Codegen DATA→front → **ya resuelto por O1**: dos schemas independientes + contrato por consumidor |
| 4   | Lenguaje de condiciones → **spec compartida + test de equivalencia**                              |
| 5   | `aggregates` → **cap declarativo + fail-loud**; B5 (adaptador SQL) se pospone hasta **medir**     |
| 6   | Deprecación → **1 versión, retiro por uso** (`contract-check` sin consumidores)                   |

**Regla final:** si añadir X obliga a editar `engine/`, `FieldHost`,
`WidgetHost` o una vista existente, **el motor todavía no está terminado**.

---

## §7. Baseline

_Cargar en R0.2._

| Gate                                | Resultado                            | Fecha                                                                 |
| ----------------------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| `npm test`                          | ✅ **147/147** (29 ficheros)         | 2026-10-06                                                            |
| `npm run test:api`                  | ✅ **144/144** (15 ficheros)         | 2026-10-06                                                            |
| `npm run api:check`                 | ✅ **VERDE** — 7 recursos, 84 campos | 2026-10-06                                                            |
| `npm run build`                     | ✅ verde (2.1 s)                     | 2026-10-06                                                            |
| `npx prettier --check . 2>&1`       | ✅ **17**                            | 2026-10-06 — deuda preexistente (19 → **17** en `plan-limpieza` L4.5) |
| Tareas absorbidas del plan anterior | 24                                   | 2026-10-06                                                            |
| Decisiones de arranque (Fase 0)     | ✅ **13 / 13 cerradas** (6 + 7)      | 2026-10-06                                                            |
| Overrides de `auth.md`              | 6 (O1–O6)                            | 2026-10-06                                                            |
