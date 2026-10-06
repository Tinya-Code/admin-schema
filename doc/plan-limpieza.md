# Plan 1 — Limpieza de archivos y preparación para el refactor

> **Alcance:** este plan **no toca el motor**. Sólo deja el repositorio limpio,
> la documentación con referencias válidas y las decisiones de arranque
> resueltas, para que el Plan 2 (`doc/plan-refactor-motor.md`) empiece sobre
> suelo firme.
>
> **Regla de oro:** nada se borra sin aprobación explícita. Cada tarea de
> borrado/movimiento lleva su propio checkbox de aprobación.
>
> **Fuentes y jerarquía (confirmada por el mantenedor):**
>
> 1. **`doc/auth.md`** — el **más reciente** y de **mayor peso**. Sus reglas
>    son las mejoras/correcciones a las inconsistencias que se encontraron
>    en `refactormotor.md`.
> 2. **`doc/refactormotor.md`** — base válida **donde `auth.md` no dice
>    nada en contra**.
>
> **Regla operativa:** donde difieran, **gana `auth.md`**. Lo que `auth.md`
> no toca, se mantiene de `refactormotor.md`.
>
> Ambos están **sin commitear** — eso es Fase 4.

---

## Cómo ejecutar este plan

- **Una tarea a la vez.** Marcar el checkbox sólo después de su verificación.
- **Gates de este plan:**

  ```bash
  npm test
  npm run test:api
  npm run api:check
  npm run build
  npx prettier --check . 2>&1    # ⚠️ los warnings van a stderr
  ```

- **Reglas.**
  - Nada de contenido nuevo: este plan **clasifica, repara y archiva**.
  - Si una tarea obliga a decidir algo no previsto → se para y se registra en
    «Decisiones pendientes», no se improvisa.
  - **Gotcha zsh:** cita los flags (`grep --include='*.md'`); sin comillas la
    tanda entera aborta y **los greps previos no corren**.
  - Idioma: artefactos en español neutro, código/UI en inglés.

---

## 0. Inventario medido (estado actual)

**25 archivos Markdown** en el repo + `README.md`.

### 0.1 Clasificación

Estado medido con `grep -c '^\s*- \[ \]'` / `- [x]` y referencias cruzadas.

| #   | Archivo                            | Tareas      | Referenciado por                                | Clase                       |
| --- | ---------------------------------- | ----------- | ----------------------------------------------- | --------------------------- |
| 1   | `README.md`                        | —           | raíz                                            | 🟢 **vivo**                 |
| 2   | `doc/base.md`                      | —           | `src/…/schema.model.ts:3`                       | 🟢 **vivo**                 |
| 3   | `doc/baseapi.md`                   | —           | `README.md`, `api/PLAN.md:5` (**autoridad v2**) | 🟢 **vivo**                 |
| 4   | `doc/guia.md`                      | —           | `README.md:3`                                   | 🟢 **vivo**                 |
| 5   | `doc/structure.md`                 | —           | citado en plan                                  | 🟢 **vivo**                 |
| 6   | `doc/backlog-ui-ux.md`             | —           | `plan-mejoras-ui-ux.md:416`                     | 🟢 **vivo**                 |
| 7   | `doc/motor-renderizado-actual.md`  | —           | `plan-motor-de-renderizado.md`                  | 🟢 **vivo**                 |
| 8   | `doc/plan-motor-de-renderizado.md` | **31 / 0**  | activo                                          | 🟡 **a absorber**           |
| 9   | `doc/pedidos-rectificacion.md`     | —           | hallazgos R1–R10                                | 🟢 **vivo**                 |
| 10  | `doc/refactormotor.md`             | —           | **input del refactor**                          | 🟠 **sin commit**           |
| 11  | `doc/auth.md`                      | —           | **input del refactor**                          | 🟠 **sin commit**           |
| 12  | `doc/ui-ux.md`                     | **10 / 0**  | congelado                                       | 🔵 **congelado**            |
| 13  | `doc/plan.md`                      | **0 / 68**  | congelado                                       | 🔵 **congelado**            |
| 14  | `doc/plan-mejoras-ui-ux.md`        | **0 / 73**  | —                                               | ⚪ **histórico**            |
| 15  | `doc/plan-schemas-separados.md`    | **1 / 66**  | `contract-check.mjs:3`, `api-check.sh:9`        | ⚪ **histórico + citado**   |
| 16  | `doc/plan-flujos-declarativos.md`  | **2 / 72**  | —                                               | ⚪ **histórico**            |
| 17  | `doc/motor-plan.md`                | **15 / 95** | —                                               | ⚪ **histórico (15 pend.)** |
| 18  | `doc/pickpass-plan.md`             | **11 / 81** | —                                               | ⚪ **histórico (11 pend.)** |
| 19  | `doc/pickpass-viabilidad.md`       | —           | —                                               | ⚪ **histórico**            |
| 20  | `doc/api.md`                       | —           | `src/…/api.model.ts:2`                          | 🔴 **obsoleto**             |
| 21  | `api/README.md`                    | —           | —                                               | 🟢 **vivo**                 |
| 22  | `api/MAPA.md`                      | —           | —                                               | 🟢 **vivo**                 |
| 23  | `api/mejoras.md`                   | —           | `api-check.sh:3`                                | 🟢 **vivo + citado**        |
| 24  | `api/PLAN.md`                      | **19 / 46** | congelado                                       | 🔵 **congelado**            |
| 25  | `api/PLAN-MEJORAS.md`              | **0 / 92**  | congelado                                       | 🔵 **congelado**            |

### 0.2 Referencias rotas detectadas

| #   | Origen                     | Apunta a                                    | Existe    | Real                              |
| --- | -------------------------- | ------------------------------------------- | --------- | --------------------------------- |
| R1  | `refactormotor.md:3`       | `doc/motor-de-renderizado-estado-actual.md` | ❌        | `doc/motor-renderizado-actual.md` |
| R2  | `auth.md:10`               | `mejoras-motores.md`                        | ❌        | `doc/refactormotor.md`            |
| R3  | `auth.md:388` (título §10) | `mejoras-motores.md`                        | ❌        | `doc/refactormotor.md`            |
| R4  | `structure.md:100`         | `doc/plan-schemas-separados.md`             | ⚠️ existe | histórico → enlazar con aviso     |

### 0.3 Citaciones desde código (rastreadas — decisiones, no borrar a ciegas)

| Archivo:línea                           | Cita                            | Problema                               |
| --------------------------------------- | ------------------------------- | -------------------------------------- |
| `scripts/contract-check.mjs:3`          | `doc/plan-schemas-separados.md` | histórico                              |
| `scripts/api-check.sh:3`                | `api/mejoras.md` §11            | 🟢 OK                                  |
| `scripts/api-check.sh:9`                | `doc/plan-schemas-separados.md` | histórico                              |
| `src/app/core/models/schema.model.ts:3` | `doc/base.md`                   | 🟢 OK                                  |
| `src/app/core/models/api.model.ts:2`    | `doc/api.md` §…                 | 🔴 obsoleto (autoridad = `baseapi.md`) |

### 0.4 Verdaderos candidatos a borrado

**Ninguno se borra hasta la Fase 3 con aprobación.** Candidatos:

- `doc/api.md` — **autoridad sobrescrita**: `api/PLAN.md:5` dice
  _«Autoridad: `doc/baseapi.md` (v2) — corrige `doc/api.md`»_.
  ⚠️ Pero `api.model.ts:2` lo cita → hay que migrar la cita **antes**.

---

## Fase 1 — Inventario aprobado y decisiones de destino

**Objetivo:** que nadie archive ni borre nada basándose en este documento sin
haberlo confirmado.

- [ ] **L1.1** — Validar la clasificación de §0.1
  - **Pasos:** recorrer la tabla y marcar cada fila como
    **confirmada** / **cambiar a …**.
  - **Hecho cuando:** las 25 filas tienen veredicto del mantenedor.

- [x] **L1.2** — Decidir destino de los **históricos** (D1) ✅ **RESUELTA**
  - **Opción A:** mover a `doc/archivo/` (git mv, sin editar contenido).
  - **Opción B:** dejarlos donde están, sólo añadir cabecera «Histórico».
  - **Opción C:** `git rm` (borrado definitivo, recuperable del histórico git).
  - **✅ Decisión del mantenedor: OPCIÓN C — borrar.**
    - _Criterio:_ los planes actuales **replantean todo el motor**; no tiene
      sentido conservar documentos desactualizados cuya utilidad en su
      momento fue la creación de **este motor defectuoso**.
    - **Esto resuelve también D7:** las 26 tareas pendientes de
      `motor-plan.md` (15) y `pickpass-plan.md` (11) quedan **obsoletas** —
      el replanteo de los planes actuales las sustituye. No se migran.
  - **Hecho cuando:** D1 registrado con la opción elegida. ✅

- [x] **L1.3** — Decidir destino de `doc/api.md` (D2) ✅ **RESUELTA**
  - **Contexto verificado:** `doc/api.md` (26.5 KB, 24 §) **NO** es
    equivalentemente cubierto por `doc/baseapi.md` (32 KB, 17 §).
    - `api/PLAN.md:6` → _«**Contrato de datos:** `doc/api.md` §3 (13 hojas,
      columnas exactas)»_ → **§3 sigue VIGENTE**.
    - `api/PLAN.md:5` → _«**Autoridad:** `doc/baseapi.md` (v2) — corrige
      `doc/api.md`»_ → baseapi manda sobre el **enfoque**, no sobre §3.
    - Verificado: `baseapi.md` describe la **forma** del schema (§4–§5) pero
      **no** enumera las 13 hojas. El contrato de columnas sólo existe aquí.
    - **7 referencias:** `api/README.md:4` · `api/PLAN.md:5,6` ·
      `doc/structure.md:4` · `doc/plan.md:12` · `doc/guia.md:348` ·
      `src/app/core/models/api.model.ts:2` — dos marcadas como **vivas**.
  - **✅ Decisión del mantenedor: MANTENER CON CABECERA DE OBSELESCENCIA.**
    - El criterio de borrado de D1 **no aplica**: es el contrato de datos
      vivo, no un plan del motor defectuoso.
    - **Cambio a ejecutar:** añadir cabecera en la línea 1 que diga
      _«§3 = contrato de datos VIGENTE; el resto está superado por
      `doc/baseapi.md`»_.
  - **Hecho cuando:** D2 registrado con la decisión elegida. ✅

- [x] **L1.4** — Confirmar alcance de los **congelados** (D3) ✅ **RESUELTA**
  - **Archivos:** `doc/plan.md`, `doc/ui-ux.md`, `api/PLAN.md`,
    `api/PLAN-MEJORAS.md`.
  - **Contexto:** estaban congelados por los warnings de prettier. Este plan
    **no pretende reformatearlos**; sólo decidir si se pueden **mover** (que no
    cambia su contenido).
  - **✅ Resultado verificado — los 4 NO son un grupo homogéneo:**

    | Fichero | Pend | Veredicto | Evidencia |
    | --- | --- | --- | --- |
    | `doc/ui-ux.md` | **10/10** | 🔵 **se queda** | `backlog-ui-ux.md:19` lo llama **«normativa»** |
    | `api/PLAN.md` | **19/65** | 🔵 **se queda** | 19 tareas sin ejecutar |
    | `api/PLAN-MEJORAS.md` | 0/92 | 🔵 **se queda** | **Cadena de evidencia**: `api/PLAN.md:26,34` · `guia.md:5,230` · `pedidos-rectificacion.md:178,230` (evidencia de R7) · `schema.model.ts:548` |
    | `doc/plan.md` | 0/58 | 🗑️ **BORRADO** | Sin trabajo vivo ni referencias vivas → criterio D1 |

  - **⚠️ Lección:** _completado ≠ borrable_. `api/PLAN-MEJORAS.md` tenía 0
    pendientes pero es la trazabilidad de decisiones que citan docs vivos —
    misma trampa que D2.
  - **Hecho cuando:** D3 registrado para cada uno. ✅

---

## Fase 2 — Reparar referencias cruzadas

**Objetivo:** ningún enlace roto entre documentos ni desde código.

**Precondición:** Fase 1 aprobada (o, para L2.1–L2.3, puede correr en paralelo
— no dependen de borrar nada).

- [ ] **L2.1** — Reparar `refactormotor.md:3`
  - **Cambio:** `doc/motor-de-renderizado-estado-actual.md`
    → `doc/motor-renderizado-actual.md`.
  - **Verificación:** `grep -rn "motor-de-renderizado-estado-actual" doc/` → 0.

- [ ] **L2.2** — Reparar `auth.md:10`
  - **Cambio:** `mejoras-motores.md` → `doc/refactormotor.md`.
  - **Verificación:** `grep -rn "mejoras-motores" doc/` → 0.

- [ ] **L2.3** — Reparar `auth.md:388` (título del §10)
  - **Cambio:** `## 10. Lo que este documento cambia en mejoras-motores.md`
    → `## 10. Lo que este documento cambia en refactormotor.md`.
  - **Hecho cuando:** L2.2 + L2.3 dejan el grep de arriba en 0.

- [ ] **L2.4** — Migrar la cita de `api.model.ts:2`
  - **Archivo:** `src/app/core/models/api.model.ts`
  - **Pasos:** cambiar la referencia a `doc/api.md` por `doc/baseapi.md`
    (autoridad v2, según `api/PLAN.md:5`), **sólo después** de D2 (L1.3).
  - **Verificación:** `grep -rn "doc/api.md" src/` → 0 · `npm test` ·
    `npm run build`.
  - **Hecho cuando:** el comentario apunta a la autoridad vigente.

- [x] **L2.5** — Reparar `structure.md:100` ✅ **HECHO**
  - **Rama aplicada:** D1 = **C (borrar)**.
  - **Cambio hecho:** `doc/plan-schemas-separados.md, Fase 4.`
    → `doc/refactormotor.md §5 (histórico: plan-schemas-separados).`
  - **Verificación:** enlace no colgado + barrido `python3` de enlaces `.md`
    → **0 rotos** en `doc/`, `api/` y `README.md`.

- [ ] **L2.6** — Comprobador de enlaces
  - **Archivo nuevo:** `scripts/doc-links.mjs` (opcional pero recomendado).
  - **Pasos:** recorrer `doc/*.md` + `README.md` + `api/*.md`, extraer enlaces
    `](ruta.md)` y reportar los que no existan.
  - **Verificación:** sale limpio con L2.1–L2.5 aplicados; **falla** si se
    rompe un enlace nuevo.
  - **Hecho cuando:** existe y corre en verde.

- [ ] **L2.7** — Verificación de la fase
  - **Comandos:** los 5 gates.
  - **Hecho cuando:** todos verdes y `grep -rn "mejoras-motores\|motor-de-renderizado-estado-actual"`
    → 0 en todo el repo.

---

## Fase 3 — Archivar y limpiar

**Precondición:** D1, D2 y D3 decididos en L1.2–L1.4.

> ⚠️ **Cada tarea tiene dos checkboxes:** _cambio aplicado_ y
> _aprobación para borrar/mover_. No se ejecuta la segunda sin la primera
> revisada.

- [x] **L3.1** — **Borrar** los históricos según D1 (opción C) ✅ **EJECUTADO**
  - **Candidatos (ver §0.1):** `plan-mejoras-ui-ux`, `plan-schemas-separados`,
    `plan-flujos-declarativos`, `motor-plan`, `pickpass-plan`,
    `pickpass-viabilidad` → **6 ficheros**.
  - **Pasos:**
    1. **Antes de borrar** `plan-schemas-separados.md`: reapuntar las citas en
       `scripts/contract-check.mjs:3` y `scripts/api-check.sh:9` a un doc que
       **siga existiendo** (`doc/baseapi.md` para `api-check.sh`; decidir el
       destino de `contract-check.mjs` al ejecutar — hoy sólo comenta el
       origen del enfoque de dos schemas).
    2. Reparar el enlace `structure.md:100` (**supera a L2.5**: ya no se
       anota, se **reapunta o se quita**).
    3. `git rm` de los 6 ficheros. _(git conserva el histórico:_
       `git log --diff-filter=D -- doc/motor-plan.md`_)_
  - **Verificación:** `npm run api:check` verde · `grep -rn "plan-schemas-separados\|motor-plan\|pickpass-plan\|pickpass-viabilidad\|plan-mejoras-ui-ux\|plan-flujos-declarativos" .` → 0 salvo `.git` · `npm test` · `npm run build`.
  - **✅ Ejecutado 2026-10-06.** Radio de impacto real: **22 refs externas**
    (19 en código), no las 2 que preveía este plan. Reparadas antes de borrar
    → `git rm` de los 6 · gates verdes (147/147 · 144/144 · api:check VERDE ·
    build 🟢 · prettier 17).
  - [x] **aprobación del mantenedor** ✅ — _go dado: «Reparar 22 refs y borrar»_

- [x] **L3.2** — Tratar `doc/api.md` según D2 ✅ **HECHO**
  - **D2 = mantener con cabecera** (no borrar) → la verificación original
    (`grep "doc/api.md" → 0`) **no aplica**: el fichero se queda.
  - **Cambio hecho:** cabecera en `doc/api.md:3-7` — §3 es el **contrato de
    datos vigente**; §1 y §5–§8 están **superados por `doc/baseapi.md`**.
  - **⚠️ Pendiente en L2.4:** `src/app/core/models/api.model.ts:2` cita
    `doc/api.md §6 — Opción A, §7`, que **sí** está superado → reapuntar.
  - [x] **aprobación del mantenedor** ✅

- [x] **L3.3** — Congelados según D3 ✅ **HECHO**
  - **Aplicado:** `doc/plan.md` **borrado** (0/58 tareas, sin referencias
    vivas). Los otros 3 **se quedan donde están** — ver la tabla de L1.4.
  - **Verificación:** `npx prettier --check . 2>&1` → **17** warnings.
    Bajó de 18: se fue `doc/plan.md`, que era deuda preexistente.
    Reparto: **15 deuda** + `auth.md` + `refactormotor.md`.
  - [x] **aprobación del mantenedor** ✅

- [ ] **L3.4** — Actualizar los README que apunten a lo archivado
  - **Archivos:** `README.md`, `api/README.md`.
  - **Pasos:** sólo corregir enlaces que apunten a un archivo movido.
  - **Verificación:** L2.6 en verde.

- [ ] **L3.5** — Gates de la fase
  - **Comandos:** los 5 gates + `git status` limpio de cambios inesperados.
  - **Hecho cuando:** todo verde.

---

## Fase 4 — Higiene del repositorio

- [ ] **L4.1** — Commitear los inputs del refactor
  - **Archivos:** `doc/auth.md`, `doc/refactormotor.md` (**untracked** hoy).
  - **Pasos:** `git add doc/auth.md doc/refactormotor.md` + commit
    convencional, **sin atribución a IA**.
  - **Verificación:** `git status --short` no los muestra como `??`.

- [ ] **L4.2** — Revisar el estado de git
  - **Pasos:** `git status --short` → no debe quedar nada fuera de lo
    intencional; `git log --oneline -5` para confirmar el estilo de la serie.
  - **Hecho cuando:** el árbol está limpio antes de empezar el refactor.

- [ ] **L4.3** — Revisar artefactos ignorados que pese en el repo
  - **Pasos:** comprobar que `dist/`, `node_modules/`, `.atl/`, `.env`,
    `*.local.ts` siguen en `.gitignore` y **no** están tracked
    (`git ls-files | grep -E 'dist/|\.env$|local\.ts'`).
  - **Verificación:** el grep no devuelve nada.

- [ ] **L4.4** — Confirmar que no hay archivos sueltos fuera de lugar
  - **Pasos:** `git status --ignored --short | head -40` y revisar que no haya
    nada que deba ir al repo (o que sobra).
  - **Hecho cuando:** hallazgos registrados en Decisiones pendientes si los hay.

- [ ] **L4.5** — Formatear los dos inputs del refactor ⚠️ hallazgo nuevo
  - **Contexto:** `npx prettier --check .` reporta **18** warnings, no los 16
    de deuda preexistente. Los 2 nuevos son `doc/auth.md` y
    `doc/refactormotor.md`, que entraron **sin formatear**.
  - **Pasos:**
    1. `npx prettier --write doc/auth.md doc/refactormotor.md`
    2. ⚠️ **Sólo cambia espaciado y tablas** — verificar con `git diff` que no
       se alteró contenido (aún no están commiteados, así que comparar contra
       una copia previa o revisar el diff con calma).
  - **Verificación:** `npx prettier --check . 2>&1` → **16** warnings otra vez.
  - **Hecho cuando:** el conteo vuelve a 16 y el diff no muestra cambios de
    contenido.
  - [ ] **aprobación del mantenedor**

---

## Fase 5 — Preparación para el refactor

**Objetivo:** cerrar las decisiones de arranque para que el Plan 2 no se
detenga en la primera tarea.

- [ ] **L5.1** — Baseline de gates
  - **Pasos:** ejecutar los 5 gates y anotar las cifras exactas en §6.
  - **Hecho cuando:** §6 tiene la fila completa con fecha.

- [ ] **L5.2** — Resolver las **6 decisiones de `refactormotor.md` §9**
  - **Son:** (1) autodescubrimiento vs registro manual · (2) `snake_case` o
    `kebab-case` para ids de recurso · (3) codegen DATA→front obligatorio o
    advertencia · (4) alcance del lenguaje de condiciones compartido ·
    (5) límite de `aggregates` en Sheets · (6) política de deprecación.
  - **⚠️ Nota 1:** la **(3)** está **resuelta por `auth.md` §10** (y tiene
    más peso): _«El §5 deja de proponer unir `data` y `ui`… pasa a dos
    schemas independientes + contrato vigilado por consumidor»_. Registrarla
    en D9 como **decidida**, no como pendiente.
  - **⚠️ Nota 2:** al resolver cada decisión, **si `auth.md` toca el tema,
    manda `auth.md`** (jerarquía de esta cabecera).
  - **Hecho cuando:** las 6 están en §5 de este documento.

- [ ] **L5.3** — Resolver las **7 decisiones de `auth.md` §9**
  - **Son:** (1) proveedor A/B/ambos · (2) duración de sesión · (3)
    «recordarme» en `localStorage` · (4) cuántos roles · (5) formato de
    respuesta existente · (6) ¿cuentas de cliente? · (7) ¿se acepta logout
    «best-effort»?
  - **⚠️ Prioridad:** éstas **mandan sobre las de L5.2** — son del documento
    líder. La **(5)** además goberna el sobre de respuesta del back
    (ver O7 en el Plan 2: se conserva el formato actual de
    `api/core/12-http.js`, no se cambia a `{ ok:false }`).
  - **Hecho cuando:** las 7 están en §5.

- [ ] **L5.4** — Fijar la nomenclatura vigente (**las dos fuentes**)
  - **Pasos:** copiar a §5 las dos tablas —
    - **`refactormotor.md` §2** (general): `kebab-case` tipos · `camelCase`
      claves · sufijos `*When`/`*Template`/`*Field`/`*Projection`/`on*`/
      `expose*`/`*Ref` · prefijo `x-` · sufijo `_` en privadas.
    - **`auth.md` §6** (dominio auth): hojas internas `_`+`snake_case` ·
      Properties `MAYUS_SNAKE` · códigos `AUTH_*`/`VALIDATION_*` · niveles
      `public`/`session`/`role:<n>` · audiencias minúsculas · handlers
      `authLogin`/`authLogout`/`authMe` · claims JWT estándar.
  - **⚠️ Colisión pendiente D9-2:** id de recurso (`snake_case` vs
    `kebab-case` vs `users` de `auth.md` §4.2) — fijarlo en el meta-schema.
  - **Hecho cuando:** existe una referencia única para quien escriba código.

- [ ] **L5.5** — Confirmar el alcance del Plan 2
  - **Pasos:** confirmar que `doc/plan-refactor-motor.md` **absorbe**
    `doc/plan-motor-de-renderizado.md` (31 tareas) y que éste queda marcado
    como histórico tras la absorción. _(Decisión registrada en D8; la
    alternativa — mantener dos planes paralelos — está descrita ahí.)_
  - **Hecho cuando:** D8 decidida.

- [ ] **L5.6** — Verificar que los inputs del refactor están legibles
  - **Pasos:** abrir `doc/refactormotor.md` y `doc/auth.md` y confirmar que
    §8 (hoja de ruta) y §7 (fases) respectivamente se leen completos.
  - **Hecho cuando:** sin secciones truncadas.

---

## Fase 6 — Verificación y cierre

- [ ] **L6.1** — Reejecutar los 5 gates
  - **Hecho cuando:** todos verdes y sin regresión respecto al baseline L5.1.

- [ ] **L6.2** — Auditoría de enlaces
  - **Pasos:** `node scripts/doc-links.mjs` (si L2.6 se creó) o el grep manual
    equivalente.
  - **Hecho cuando:** 0 enlaces rotos en `doc/`, `api/` y `README.md`.

- [ ] **L6.3** — Auditoría de referencias a `doc/` desde código
  - **Pasos:** `grep -rn "doc/[a-z0-9-]*\.md" scripts/ src/` → todas las rutas
    resultantes **existen**.
  - **Hecho cuando:** ninguna cita a un fichero inexistente.

- [ ] **L6.4** — Actualizar este documento con el estado final
  - **Pasos:** marcar el conteo final de MDs vivos/históricos y archivar las
    decisiones cerradas.

- [ ] **L6.5** — Commit de cierre
  - **Pasos:** commit convencional con la limpieza, **sólo si el usuario lo
    pide explícitamente**.

---

## 1. Decisiones pendientes

| ID      | Decisión                                                           | Bloquea    | Estado                             |
| ------- | ------------------------------------------------------------------ | ---------- | ---------------------------------- |
| **D1**  | Destino de los históricos: mover / cabecera / borrar               | L3.1       | ✅ **C — borrar**                  |
| **D2**  | Destino de `doc/api.md` (obsoleto)                                 | L2.4, L3.2 | ✅ **mantener con cabecera**       |
| **D3**  | ¿Se pueden mover los congelados?                                   | L3.3       | ✅ **sólo `doc/plan.md`** — los otros 3 se quedan |
| **D4**  | ¿Crear `scripts/doc-links.mjs`?                                    | L2.6       | abierta                            |
| **D5**  | `doc/ui-ux.md` tiene 10 pendientes — ¿se archiva con trabajo vivo? | L3.3       | ✅ **no — es «normativa»**         |
| **D6**  | `api/PLAN.md` tiene 19 pendientes — mismo caso                     | L3.3       | ✅ **no — 19 pendientes vivos**    |
| **D7**  | `doc/motor-plan.md` 15 pend · `pickpass-plan.md` 11 pend           | L3.1       | ✅ **resuelta por D1** — obsoletas |
| **D8**  | ¿Se absorbe `plan-motor-de-renderizado.md` en el Plan 2?           | L5.5       | abierta                            |
| **D9**  | `refactormotor` §9 — 6 decisiones                                  | L5.2       | abierta                            |
| **D10** | `auth` §9 — 7 decisiones                                           | L5.3       | abierta                            |

---

## 2. Resumen en una página

**Qué hay hoy:** 25 MD — 10 vivos, 6 históricos completados, 4 congelados,
2 sin commit, 1 obsoleto, 2 a absorber/históricos con pendientes.

**Qué hace este plan:**

1. **Fase 1** — clasificar y decidir (nada se borra aún).
2. **Fase 2** — reparar 4 referencias rotas + migrar una cita desde código.
3. **Fase 3** — archivar/borrar **con aprobación explícita** por archivo.
4. **Fase 4** — higiene git (commitear los 2 inputs, revisar ignorados).
5. **Fase 5** — cerrar 10 decisiones de arranque y fijar nomenclatura.
6. **Fase 6** — gates + auditoría de enlaces + cierre.

**Qué NO hace:** tocar el motor, cambiar comportamiento, reformatear los
ficheros congelados.

---

## 6. Baseline

_Cargar en L5.1._

| Gate                          | Resultado                            | Fecha                                                                      |
| ----------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| `npm test`                    | ✅ **147/147** (29 ficheros)         | 2026-10-06                                                                 |
| `npm run test:api`            | ✅ **144/144** (15 ficheros)         | 2026-10-06                                                                 |
| `npm run api:check`           | ✅ **VERDE** — 7 recursos, 84 campos | 2026-10-06                                                                 |
| `npm run build`               | ✅ verde (2.1 s)                     | 2026-10-06                                                                 |
| `npx prettier --check . 2>&1` | ⚠️ **18**                            | 2026-10-06 (16 deuda preexistente + `auth.md` + `refactormotor.md` → L4.5) |
| MDs totales                   | 25                                   | 2026-10-06                                                                 |
| MDs untracked                 | 2 (`auth`, `refactormotor`)          | 2026-10-06                                                                 |
| Enlaces rotos                 | 4 (R1–R4)                            | 2026-10-06                                                                 |
