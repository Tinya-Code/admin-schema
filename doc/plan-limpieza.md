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

**19 archivos Markdown** en el repo (medido 2026-10-06 tras D1, D3 y D8).

### 0.1 Clasificación

Estado medido con `grep -c '^\s*- \[ \]'` / `- [x]` y referencias cruzadas.
Columna **Tareas = pendientes / completadas**.

> ⚠️ **Tabla reescrita 2026-10-06** — salieron 8 filas borradas:
> `doc/plan.md` (D3) y `plan-mejoras-ui-ux`, `plan-schemas-separados`,
> `plan-flujos-declarativos`, `motor-plan`, `pickpass-plan`,
> `pickpass-viabilidad` (D1) y `plan-motor-de-renderizado` (D8). Entraron
> `plan-limpieza` y `plan-refactor-motor`.

| #   | Archivo                           | Tareas      | Referenciado por                                | Clase                                 |
| --- | --------------------------------- | ----------- | ----------------------------------------------- | ------------------------------------- |
| 1   | `README.md`                       | —           | raíz                                            | 🟢 **vivo**                           |
| 2   | `doc/base.md`                     | —           | `src/…/schema.model.ts:3`                       | 🟢 **vivo**                           |
| 3   | `doc/baseapi.md`                  | —           | `README.md`, `api/PLAN.md:5` (**autoridad v2**) | 🟢 **vivo**                           |
| 4   | `doc/guia.md`                     | —           | `README.md:3`                                   | 🟢 **vivo**                           |
| 5   | `doc/structure.md`                | —           | `doc/api.md`, `doc/base.md`                     | 🟢 **vivo**                           |
| 6   | `doc/backlog-ui-ux.md`            | —           | —                                               | 🟢 **vivo**                           |
| 7   | `doc/motor-renderizado-actual.md` | —           | `refactormotor.md:3`                            | 🟢 **vivo**                           |
| 8   | `doc/pedidos-rectificacion.md`    | —           | hallazgos R1–R10                                | 🟢 **vivo**                           |
| 9   | `doc/refactormotor.md`            | —           | **input del refactor**                          | 🟠 **sin commit**                     |
| 10  | `doc/auth.md`                     | —           | **input del refactor**                          | 🟠 **sin commit**                     |
| 11  | `doc/ui-ux.md`                    | **10 / 0**  | `backlog-ui-ux.md:19` («normativa»)             | 🔵 **congelado → D5: se queda**       |
| 12  | `doc/api.md`                      | —           | `api/README.md:4`, `api/PLAN.md:5,6`, `guia.md` | 🟠 **§3 vivo / resto superado → D2**  |
| 13  | `doc/plan-limpieza.md`            | **32 / 1**  | este documento                                  | 🟠 **sin commit** (se cierra en L6.5) |
| 14  | `doc/plan-refactor-motor.md`      | **107 / 1** | Plan 2                                          | 🟠 **sin commit**                     |
| 15  | `api/README.md`                   | —           | —                                               | 🟢 **vivo**                           |
| 16  | `api/MAPA.md`                     | —           | —                                               | 🟢 **vivo**                           |
| 17  | `api/mejoras.md`                  | —           | `api-check.sh:3`                                | 🟢 **vivo + citado**                  |
| 18  | `api/PLAN.md`                     | **19 / 46** | congelado                                       | 🔵 **congelado → D6: se queda**       |
| 19  | `api/PLAN-MEJORAS.md`             | **0 / 92**  | cadena de evidencia (`guia.md`, `pedidos.md`)   | 🔵 **congelado → se queda**           |

### 0.2 Referencias rotas detectadas

| #   | Origen                            | Apunta a                                    | Existe  | Real                                                  |
| --- | --------------------------------- | ------------------------------------------- | ------- | ----------------------------------------------------- |
| R1  | `refactormotor.md:3`              | `doc/motor-de-renderizado-estado-actual.md` | ❌      | ✅ **reapuntado → `doc/motor-renderizado-actual.md`** |
| R2  | `auth.md:10`                      | `mejoras-motores.md`                        | ❌      | ✅ **reapuntado → `doc/refactormotor.md`**            |
| R3  | `auth.md:388` (título §10)        | `mejoras-motores.md`                        | ❌      | ✅ **reapuntado → `doc/refactormotor.md`**            |
| R4  | `structure.md:100`                | `doc/plan-schemas-separados.md`             | borrado | ✅ **reapuntado a `refactormotor.md §5`**             |
| R5  | `doc/api.md:8`                    | `api-modelo-datos.md`                       | ❌      | ✅ **cláusula eliminada** — nunca existió (L2.7)      |
| R6  | `plan-motor-de-renderizado.md:36` | `doc/plan.md`                               | borrado | ✅ **resuelta por D8** — el origen ya no existe       |

> **Estado: R1–R6 TODAS resueltas ✅** (barrido 2026-10-06 → 0 en todo el
> repo). R6 se resolvió sola con D8 (el origen se borró junto con su cita a
> `doc/plan.md`). R5 se resolvió en L2.7: la cláusula se eliminó porque el
> fichero citado nunca existió.
>
> **Barrido de enlaces `.md`** (`python3`, `](ruta.md)` sobre `doc/`, `api/`
> y `README.md`): **0 enlaces markdown rotos**. R1–R6 son citas en
> _backticks_, no enlaces, por eso no los detecta ese barrido.

### 0.3 Citaciones desde código (rastreadas — decisiones, no borrar a ciegas)

| Archivo:línea                           | Cita                            | Problema                               |
| --------------------------------------- | ------------------------------- | -------------------------------------- |
| `scripts/contract-check.mjs:3`          | `doc/plan-schemas-separados.md` | histórico                              |
| `scripts/api-check.sh:3`                | `api/mejoras.md` §11            | 🟢 OK                                  |
| `scripts/api-check.sh:9`                | `doc/plan-schemas-separados.md` | histórico                              |
| `src/app/core/models/schema.model.ts:3` | `doc/base.md`                   | 🟢 OK                                  |
| `src/app/core/models/api.model.ts:2`    | `doc/api.md` §…                 | 🔴 obsoleto (autoridad = `baseapi.md`) |

### 0.4 Verdaderos candidatos a borrado

**Ninguno se borra sin aprobación explícita.** Estado tras Fase 1:

- ~~`doc/api.md`~~ — **ya no es candidato**: D2 = mantener con cabecera de
  obsolescencia (§3 es el contrato de datos vivo). Sólo queda **L2.4**
  (migrar la cita de `api.model.ts:2`, que apunta a una sección superada).
- **Los 6 históricos + `doc/plan.md`**: ya borrados en Fase 3 (D1, D3).

---

## Fase 1 — Inventario aprobado y decisiones de destino

**Objetivo:** que nadie archive ni borre nada basándose en este documento sin
haberlo confirmado.

- [x] **L1.1** — Validar la clasificación de §0.1 ✅ **HECHA**
  - **Pasos:** recorrer la tabla y marcar cada fila como
    **confirmada** / **cambiar a …**.
  - **Veredicto (2026-10-06):** §0.1 **reescrita a 19 filas** — salieron los
    8 ficheros borrados (D1, D3, D8) y entraron `plan-limpieza` y
    `plan-refactor-motor`.
  - **18 de 19** filas quedan confirmadas automáticamente por decisiones ya
    ejecutadas (D1, D2, D3, D5, D6). La **única** fila abierta era la 8
    (antes) → **D8**.
  - **D8 resuelta: ABSORBER Y BORRAR** → cerrada en L5.5. ✅
  - **Hecho cuando:** todas las filas tienen veredicto del mantenedor. ✅

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

    | Fichero               | Pend      | Veredicto       | Evidencia                                                                                                                                     |
    | --------------------- | --------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
    | `doc/ui-ux.md`        | **10/10** | 🔵 **se queda** | `backlog-ui-ux.md:19` lo llama **«normativa»**                                                                                                |
    | `api/PLAN.md`         | **19/65** | 🔵 **se queda** | 19 tareas sin ejecutar                                                                                                                        |
    | `api/PLAN-MEJORAS.md` | 0/92      | 🔵 **se queda** | **Cadena de evidencia**: `api/PLAN.md:26,34` · `guia.md:5,230` · `pedidos-rectificacion.md:178,230` (evidencia de R7) · `schema.model.ts:548` |
    | `doc/plan.md`         | 0/58      | 🗑️ **BORRADO**  | Sin trabajo vivo ni referencias vivas → criterio D1                                                                                           |

  - **⚠️ Lección:** _completado ≠ borrable_. `api/PLAN-MEJORAS.md` tenía 0
    pendientes pero es la trazabilidad de decisiones que citan docs vivos —
    misma trampa que D2.
  - **Hecho cuando:** D3 registrado para cada uno. ✅

---

## Fase 2 — Reparar referencias cruzadas

**Objetivo:** ningún enlace roto entre documentos ni desde código.

**Precondición:** Fase 1 aprobada (o, para L2.1–L2.3, puede correr en paralelo
— no dependen de borrar nada).

- [x] **L2.1** — Reparar `refactormotor.md:3` ✅ **HECHO**
  - **Cambio:** `doc/motor-de-renderizado-estado-actual.md`
    → `doc/motor-renderizado-actual.md`.
  - **Verificación:** `grep -rn "motor-de-renderizado-estado-actual" doc/` → 0.

- [x] **L2.2** — Reparar `auth.md:10` ✅ **HECHO**
  - **Cambio:** `mejoras-motores.md` → `doc/refactormotor.md`.
  - **Verificación:** `grep -rn "mejoras-motores" doc/` → 0.

- [x] **L2.3** — Reparar `auth.md:388` (título del §10) ✅ **HECHO**
  - **Verificado 2026-10-06:** `grep -rn "mejoras-motores"` → **0** ·
    `grep -rn "motor-de-renderizado-estado-actual"` → **0** en todo el repo.
  - **Cambio:** `## 10. Lo que este documento cambia en mejoras-motores.md`
    → `## 10. Lo que este documento cambia en refactormotor.md`.
  - **Hecho cuando:** L2.2 + L2.3 dejan el grep de arriba en 0.

- [x] **L2.4** — Migrar la cita de `api.model.ts:2` ✅ **HECHO**
  - **Archivo:** `src/app/core/models/api.model.ts`
  - **Hallazgo (peor de lo que decía el plan):** la cita decía
    `doc/api.md §6 — Opción A, §7`. Pero en `doc/api.md`, **§6 = «Estructura
    del proyecto Apps Script»** y **§7 = «Limitaciones de Sheets/Apps
    Script»** — **ninguna de las dos** trataba del envelope HTTP. La cita no
    estaba _superada_, estaba **apuntando a secciones equivocadas**.
  - **Cambio hecho:** las líneas 2 y 9 → `doc/baseapi.md §8 «Errores»`,
    que sí documenta el envelope (línea 175: _«Siempre HTTP 200 con
    `{ error: { status, message, errors?: [{ path, message }] } }`_).
    La línea 14 (`base.md §10`) **se queda**: §10 existe y su fila
    «Errores del backend» habla de la ruta del campo. ✅
  - **⚠️ Hallazgo derivado — drift de contrato (para el Plan 2):**
    el backend (`api/core/12-http.js:18-20`) emite
    `{ status, message, errors?: [{ path, message }] }`, pero
    `ApiErrorBody` modela `path?: string` **en el nivel del error**, que el
    backend **nunca** manda, y **no** modela `errors[]`. `contract-check`
    no lo ve porque compara schemas, no el envelope de error.
    → No se toca aquí (Fase 2 sólo repara referencias). Llevarlo al Plan 2.
  - **Verificación:** `grep -rn "doc/api.md" src/` → 0 · prettier limpio ·
    `npm test` 147/147 · `npm run build` 🟢.
  - **Hecho cuando:** el comentario apunta a la autoridad vigente. ✅

- [x] **L2.5** — Reparar `structure.md:100` ✅ **HECHO**
  - **Rama aplicada:** D1 = **C (borrar)**.
  - **Cambio hecho:** `doc/plan-schemas-separados.md, Fase 4.`
    → `doc/refactormotor.md §5 (histórico: plan-schemas-separados).`
  - **Verificación:** enlace no colgado + barrido `python3` de enlaces `.md`
    → **0 rotos** en `doc/`, `api/` y `README.md`.

- [x] **L2.6** — Comprobador de enlaces ⏭️ **OMITIDA (D4)** — _no se ejecuta_
  - **✅ Decisión del mantenedor: NO crear `scripts/doc-links.mjs`.**
  - **Justificación registrada:** sin conexión a un gate no se ejecuta solo y
    se convertiría en código muerto. Los enlaces se auditan con el barrido
    manual de **L2.8** y **L6.2** (`python3` / `grep`), que hoy da **0
    enlaces rotos**.
  - **Nota:** si en el futuro se quiere, el plan lo contempla en L6.2.

- [x] **L2.7** — Reparar **R5** (`doc/api.md:8`) ✅ **HECHA** ⚠️ _añadida 2026-10-06_
  - **Origen:** la línea 8 de `doc/api.md` decía _«Diseño derivado de
    `api-modelo-datos.md`»_ y ese fichero **no existe** en `doc/` ni en
    `api/`. Apareció al reescribir la cabecera de D2.
  - **✅ Investigado:** `git log --all --diff-filter=A -- "*api-modelo-datos*"`
    → **vacío**: el fichero **jamás existió** en el historial. Y
    **nadie más** lo citaba en todo el repo. Procedencia ficticia.
  - **✅ Decisión del mantenedor: ELIMINAR LA CLÁUSULA.**
  - **Cambio hecho:** `> Diseño derivado de \`api-modelo-datos.md\`. Google
    Sheets = base de datos.`→`> Google Sheets = base de datos.` (el resto
    de la frase, que sí es correcta, se mantiene).
  - **Verificación:** `grep -rn "api-modelo-datos" doc/ api/ README.md` → 0
    (sólo queda en el registro de este plan) · prettier limpio. ✅

- [x] **L2.8** — Verificación de la fase ✅ **VERDE**
  - **Comandos:** los 5 gates + grep + barrido de enlaces.
  - **Resultado (2026-10-06):**
    - `npm test` **147/147** (29) · `test:api` **144/144** (15) ·
      `api:check` **VERDE** (7 recursos / 84 campos) · `build` 🟢 ·
      `prettier` **19** (= baseline L5.1, sin regresión).
    - `grep -rn "mejoras-motores\|motor-de-renderizado-estado-actual\|api-modelo-datos"`
      → **0** en todo el repo (fuera del registro de este plan).
    - Barrido de enlaces `.md` → **0 rotos**.
      ⚠️ **Gotcha del barrido:** hay que **quitar el código inline
      (`\`…\``) antes de buscar `](ruta.md)`**, o el propio ejemplo que
      documenta el barrido se reporta como enlace roto (falso positivo).
  - **Hecho cuando:** todo verde y los greps en 0. ✅

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

- [x] **L3.4** — Actualizar los README que apunten a lo archivado ✅ **SIN CAMBIOS**
  - **Archivos:** `README.md`, `api/README.md`.
  - **Pasos:** sólo corregir enlaces que apunten a un archivo movido.
  - **Verificado (2026-10-06):** **no hay nada que corregir.**
    - `README.md` → 2 enlaces (`doc/guia.md`, `doc/baseapi.md`) — **OK**.
    - `api/README.md` → 2 enlaces a `./PLAN.md` — **OK**. Las citas en
      backticks (`doc/baseapi.md`, `doc/api.md §3`) existen ambas, y §3 es
      el contrato vivo según D2.
    - **Cero referencias** a cualquiera de los 8 ficheros borrados
      (D1, D3, D8).
  - **Verificación:** barrido de enlaces `.md` → **0 rotos**
    _(sustituye a «L2.6 en verde», que se omitió por D4)_.
  - **Hecho cuando:** ningún README apunta a algo archivado. ✅

- [x] **L3.5** — Gates de la fase ✅ **VERDE**
  - **Comandos:** los 5 gates + `git status` limpio de cambios inesperados.
  - **Resultado (2026-10-06):** `npm test` **147/147** · `test:api`
    **144/144** · `api:check` **VERDE** (7/84) · `build` 🟢 · `prettier`
    **19** (= baseline).
  - **`git status`:** 8 entradas, **todas esperadas** — `doc/api.md`,
    `doc/auth.md`, `doc/motor-renderizado-actual.md`, `doc/plan-limpieza.md`,
    `doc/plan-refactor-motor.md`, `doc/refactormotor.md`,
    `src/app/core/models/api.model.ts` + el borrado
    `doc/plan-motor-de-renderizado.md`. **Ningún cambio inesperado.**
  - **Hecho cuando:** todo verde. ✅

---

## Fase 4 — Higiene del repositorio

- [x] **L4.1** — Commitear los inputs del refactor ⏭️ **REUBICADA → L6.5**
  - **✅ Indicación del mantenedor:** _«al finalizar este plan puedes hacer
    el commit»_ → **un único commit al cierre** (L6.5), no uno por fase.
  - **⚠️ Premisa desactualizada (verificado en Fase 3):** **ya no están
    untracked.** Los 4 (`auth`, `refactormotor`, `plan-limpieza`,
    `plan-refactor-motor`) entraron tracked en el commit **`946669b`
    «limpieza parcial»**. Hoy están **` M` (tracked + modificados)**, no
    `??`.
  - **Cambios pendientes a commitear (10):** `doc/api.md`, `doc/auth.md`,
    `doc/motor-renderizado-actual.md`, `doc/plan-limpieza.md`,
    `doc/plan-refactor-motor.md`, `doc/refactormotor.md`,
    `src/app/core/models/api.model.ts` + borrados
    `doc/plan-motor-de-renderizado.md` (D8),
    `.atl/skill-registry.md` y `.atl/.skill-registry.cache.json` (D11).
  - **Pasos (en L6.5):** `git add` de lo intencional + commit convencional,
    **sin atribución a IA**.
  - **Verificación:** `git status --short` no los muestra como `??`.

- [x] **L4.2** — Revisar el estado de git ✅ **SIN SORPRESAS**
  - **Pasos:** `git status --short` → no debe quedar nada fuera de lo
    intencional; `git log --oneline -5` para confirmar el estilo de la serie.
  - **Resultado:** 8 entradas, **todas las esperadas** (las 6 de Fase 1–3 +
    `src/app/core/models/api.model.ts` + el borrado de D8). Ninguna ajena.
  - **⚠️ Hallazgo — estilo de la serie:** `git log --oneline -5` da
    _«update v7», «update v5», «correccion de build v3»…_ — **no** son
    convencionales. El plan pide «commit convencional, sin atribución a
    IA», así que el commit de cierre (L6.5) **romperá el patrón existente**.
    Registrado para que no sea una sorpresa.
  - **Hecho cuando:** el árbol está limpio. ✅

- [x] **L4.3** — Revisar artefactos ignorados que pese en el repo ✅ **RESUELTA (D11)**
  - **Pasos:** comprobar que `dist/`, `node_modules/`, `.atl/`, `.env`,
    `*.local.ts` siguen en `.gitignore` y **no** están tracked
    (`git ls-files | grep -E 'dist/|\.env$|local\.ts'`).
  - **Resultado inicial: FALLÓ — 2 ficheros tracked bajo `.atl/`**
    (`.skill-registry.md` y `.skill-registry.cache.json`, desde `439661c`).
    `dist/`, `node_modules/`, `.env` y `environment.local.ts` **OK**.
  - **Causa verificada:** `.gitignore:58` tiene `.atl/`, pero **una regla
    `.gitignore` no afecta a ficheros ya tracked**. `git check-ignore -v`
    lo confirma: la regla existe pero no llegaba.
  - **Evidencia que motivó la decisión:** `skill-registry.md` es
    **autogenerado** (`gentle-ai skill-registry refresh`) y contiene
    **rutas absolutas con el usuario local** (`/<usuario>/…`);
    `.skill-registry.cache.json` sólo guarda un fingerprint. **Ninguno lo
    citaba nada del repo.**
  - **✅ D11 = des-trackear.** Ejecutado: `git rm --cached` de los 2.
    **Siguen en local**; `.gitignore:58` ya los ignora de verdad.
  - **Verificación:** `git ls-files | grep -E 'dist/|\.env$|local\.ts|\.atl/'`
    → **0**. ✅
  - **Hecho cuando:** el grep no devuelve nada. ✅

- [x] **L4.4** — Confirmar que no hay archivos sueltos fuera de lugar ✅ **HECHO**
  - **Pasos:** `git status --ignored --short | head -40` y revisar que no haya
    nada que deba ir al repo (o que sobra).
  - **Resultado: 8 entradas ignoradas, todas legítimas** — `.DS_Store`
    (en `.gitignore:43`), `.angular/`, `.env`, `api/.clasp.json`,
    `api/.gas-smoke.env`, `dist/`, `node_modules/`,
    `src/environments/environment.local.ts`.
  - **Nada que deba ir al repo** (todos son builds, secretos o caché) y
    **nada sobra** que no esté ya ignorado.
  - **Hallazgo único registrado en D11** (los 2 de `.atl/`, que aparecieron
    en L4.3, no aquí — `--ignored` no lista ficheros tracked).
  - **Hecho cuando:** hallazgos registrados. ✅

- [x] **L4.5** — Formatear los dos inputs del refactor ✅ **HECHO** ⚠️ hallazgo nuevo
  - **Contexto:** los números originales del plan (18 → 16) estaban
    desactualizados. **Real al llegar aquí: 19 → 17.**
  - **✅ Aprobación del mantenedor:** _«Sí, formatear»_.
  - **Medición previa (no a ciegas):** se copiaron los 2 ficheros a un
    temporal **dentro del proyecto** para que prettier leyera `.prettierrc`
    (`singleQuote: true`, `printWidth: 100`).
    ⚠️ **Gotcha:** la primera medición se hizo en `/var/folders/...`, fuera
    del repo → prettier **no encontró la config** y usó defaults (comillas
    dobles). Medición inválida, repetida y corregida.
  - **Alcance real:** `auth.md` **179 líneas** · `refactormotor.md` **186
    líneas** (~365 en total) — separadores de tabla, `*énfasis*` →
    `_énfasis_`, y **bloques de código refluídos a 100 columnas**.
  - **Verificación de integridad (automatizada, no visual):**
    - **Bloques de código:** HEAD vs ahora, colapsando espacios →
      `auth.md` **11/11**, `refactormotor.md` **13/13**. Las 4 diferencias
      son **semánticamente neutras**: 2 comas finales, 1 `;` y
      `[{ … }]` refluído. **Ni un bloque añadido ni quitado.**
    - **Prosa:** colapsando espacios y normalizando `*x*`↔`_x_` y
      separadores de tabla → **sólo** aparecen mis ediciones intencionales
      (L2.1, L2.2, L2.3 y el marcador `histórico:` de D8) + 1 línea `>`
      vacía. **Ningún texto perdido.**
    - **Headings:** `auth.md` **30/30** · `refactormotor.md` **43/43**. ✅
  - **Verificación final:** `npx prettier --check . 2>&1` → **17** warnings
    (sólo deuda preexistente).
  - **Hecho cuando:** el conteo baja y el diff no muestra cambios de
    contenido. ✅

---

## Fase 5 — Preparación para el refactor

**Objetivo:** cerrar las decisiones de arranque para que el Plan 2 no se
detenga en la primera tarea.

- [x] **L5.1** — Baseline de gates ✅ **HECHO**
  - **Pasos:** ejecutar los 5 gates y anotar las cifras exactas en §6.
  - **Resultado (§6):** `npm test` **147/147** · `test:api` **144/144** ·
    `api:check` **VERDE** (7 recursos / 84 campos) · `build` 🟢 ·
    `prettier` **19** (17 deuda + `auth.md` + `refactormotor.md`).
  - **Hecho cuando:** §6 tiene la fila completa con fecha. ✅

- [x] **L5.2** — Resolver las **6 decisiones de `refactormotor.md` §9** ✅ **HECHO**
  - **Son:** (1) autodescubrimiento vs registro manual · (2) `snake_case` o
    `kebab-case` para ids de recurso · (3) codegen DATA→front obligatorio o
    advertencia · (4) alcance del lenguaje de condiciones compartido ·
    (5) límite de `aggregates` en Sheets · (6) política de deprecación.
  - **⚠️ Nota 1:** la **(3)** está **resuelta por `auth.md` §10** (y tiene
    más peso): _«El §5 deja de proponer unir `data` y `ui`… pasa a dos
    schemas independientes + contrato vigilado por consumidor»_. Registrarla
    en D9 como **decidida**, no como pendiente. ✅ **verificada en el origen**
    (`auth.md §10`).
  - **⚠️ Nota 2:** al resolver cada decisión, **si `auth.md` toca el tema,
    manda `auth.md`** (jerarquía de esta cabecera).
  - **Resultado:** las 6 resueltas y escritas en **§5.2**. (3) resuelta en
    origen sin preguntar; las otras 5 preguntadas.
  - **Hecho cuando:** las 6 están en §5 de este documento. ✅

- [x] **L5.3** — Resolver las **7 decisiones de `auth.md` §9** ✅ **HECHO**
  - **Son:** (1) proveedor A/B/ambos · (2) duración de sesión · (3)
    «recordarme» en `localStorage` · (4) cuántos roles · (5) formato de
    respuesta existente · (6) ¿cuentas de cliente? · (7) ¿se acepta logout
    «best-effort»?
  - **⚠️ Prioridad:** éstas **mandan sobre las de L5.2** — son del documento
    líder. La **(5)** además goberna el sobre de respuesta del back
    (ver O7 en el Plan 2: se conserva el formato actual de
    `api/core/12-http.js`, no se cambia a `{ ok:false }`).
  - **Resultado:** las 7 resueltas y escritas en **§5.1**. (5) resuelta por
    O7 sin preguntar; las otras 6 preguntadas.
  - **Hallazgo nuevo → D12:** la decisión **(4) = sólo `admin`** colisiona
    con `auth.md` §4.1/§4.2, que diseñan `role: admin | staff`.
  - **Hecho cuando:** las 7 están en §5. ✅

- [x] **L5.4** — Fijar la nomenclatura vigente (**las dos fuentes**) ✅ **HECHO**
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
    ✅ **resuelta en L5.2 → `kebab-case`**; aplicada en §5.3.
  - **Resultado:** ambas tablas en **§5.3**, con jerarquía explícita
    (`auth.md` manda) y la colisión D9-2 anotada.
  - **Hecho cuando:** existe una referencia única para quien escriba código. ✅

- [x] **L5.5** — Confirmar el alcance del Plan 2 ✅ **RESUELTA (D8)**
  - **✅ Decisión del mantenedor: ABSORBER Y BORRAR.**
  - **Ejecutado:** mapa de absorción de `plan-refactor-motor.md §3` cubre
    **31/31** tareas (T0.1 → T7.5, cada fila con destino). Luego
    `git rm doc/plan-motor-de-renderizado.md` + citas reparadas en
    `motor-renderizado-actual.md:7` y `refactormotor.md:4`.
  - **Hecho cuando:** D8 decidida. ✅

- [x] **L5.6** — Verificar que los inputs del refactor están legibles ✅ **HECHO**
  - **Pasos:** abrir `doc/refactormotor.md` y `doc/auth.md` y confirmar que
    §8 (hoja de ruta) y §7 (fases) respectivamente se leen completos.
  - **Resultado:** `refactormotor §8` = **7 fases** en tabla + nota
    «_Orden recomendado: 1 → 2 → 3_», cierra con `---` antes de §9.
    `auth.md §7` = **6 fases** con su «criterio de hecho», cierra con `---`
    antes de §8. Chequeo programático de secciones sin cuerpo en ambos
    ficheros: **0 avisos**.
  - **Hecho cuando:** sin secciones truncadas. ✅

---

## Fase 6 — Verificación y cierre

- [x] **L6.1** — Reejecutar los 5 gates ✅ **HECHO**
  - **Resultado (2026-10-06):** `npm test` **147/147** (29 ficheros) ·
    `test:api` **144/144** (15) · `api:check` **VERDE** (7 recursos / 84
    campos) · `build` 🟢 (2.0 s) · `prettier` **17**.
  - **Sin regresión** respecto al baseline L5.1. ✅
  - **Hecho cuando:** todos verdes y sin regresión respecto al baseline L5.1. ✅

- [x] **L6.2** — Auditoría de enlaces ✅ **HECHO**
  - **Pasos:** `node scripts/doc-links.mjs` (si L2.6 se creó) o el grep manual
    equivalente.
  - **Resultado:** D4 = **no** se creó el script ⇒ barrido manual con
    `python3`: **19 MDs**, **7 enlaces locales**, **0 rotos**.
  - **Hecho cuando:** 0 enlaces rotos en `doc/`, `api/` y `README.md`. ✅

- [x] **L6.3** — Auditoría de referencias a `doc/` desde código ✅ **HECHO**
  - **Pasos:** `grep -rn "doc/[a-z0-9-]*\.md" scripts/ src/` → todas las rutas
    resultantes **existen**.
  - **Resultado:** 6 citas desde `scripts/` + `src/` → `doc/base.md`,
    `doc/baseapi.md`, `doc/refactormotor.md` — **las 3 existen**. Ampliado a
    `README.md` + `api/` → `doc/api.md`, `doc/baseapi.md`, `doc/guia.md` —
    **las 3 existen**.
  - **Hecho cuando:** ninguna cita a un fichero inexistente. ✅

- [x] **L6.4** — Actualizar este documento con el estado final ✅ **HECHO**
  - **Pasos:** marcar el conteo final de MDs vivos/históricos y archivar las
    decisiones cerradas.
  - **Resultado:**
    - **§0.1** — recuento de tareas actualizado (`plan-limpieza` 32/1).
    - **§1** — retitulada _«Decisiones — ✅ TODAS CERRADAS (12/12)»_.
    - **§2** — estado final: **19 MDs** (11 vivos / 3 congelados / 5 con
      contenido sin commit), **0 untracked**, 8 borrados, fases 1–5 cerradas.
    - **§6** — añadida la tabla _Re-verificación final (L6.1–L6.3)_.

- [x] **L6.5** — Commit de cierre ✅ **HECHO**
  - **Pasos:** commit convencional con la limpieza, **sólo si el usuario lo
    pide explícitamente**.
  - **Autorización:** el mantenedor autorizó de antemano
    _«al finalizar este plan puedes hacer el commit»_.
  - **Alcance:** 10 ficheros — 3 borrados (`.atl/` ×2 = D11,
    `plan-motor-de-renderizado` = D8) + 7 modificados. **Pre-commit:**
    5 gates verdes · prettier 17 · sin secretos · sin rutas absolutas
    locales.

---

## 1. Decisiones — ✅ **TODAS CERRADAS (12/12)**

| ID      | Decisión                                                                          | Bloquea    | Estado                                            |
| ------- | --------------------------------------------------------------------------------- | ---------- | ------------------------------------------------- |
| **D1**  | Destino de los históricos: mover / cabecera / borrar                              | L3.1       | ✅ **C — borrar**                                 |
| **D2**  | Destino de `doc/api.md` (obsoleto)                                                | L2.4, L3.2 | ✅ **mantener con cabecera**                      |
| **D3**  | ¿Se pueden mover los congelados?                                                  | L3.3       | ✅ **sólo `doc/plan.md`** — los otros 3 se quedan |
| **D4**  | ¿Crear `scripts/doc-links.mjs`?                                                   | L2.6       | ✅ **no — auditado con grep manual**              |
| **D5**  | `doc/ui-ux.md` tiene 10 pendientes — ¿se archiva con trabajo vivo?                | L3.3       | ✅ **no — es «normativa»**                        |
| **D6**  | `api/PLAN.md` tiene 19 pendientes — mismo caso                                    | L3.3       | ✅ **no — 19 pendientes vivos**                   |
| **D7**  | `doc/motor-plan.md` 15 pend · `pickpass-plan.md` 11 pend                          | L3.1       | ✅ **resuelta por D1** — obsoletas                |
| **D8**  | ¿Se absorbe `plan-motor-de-renderizado.md` en el Plan 2?                          | L5.5       | ✅ **absorbido y borrado** (31/31 mapeadas)       |
| **D9**  | `refactormotor` §9 — 6 decisiones                                                 | L5.2       | ✅ **resueltas** → §5.2                           |
| **D10** | `auth` §9 — 7 decisiones                                                          | L5.3       | ✅ **resueltas** → §5.1                           |
| **D11** | `.atl/` está en `.gitignore:58` pero 2 ficheros siguen **tracked**                | L4.3       | ✅ **des-trackeados** (`git rm --cached`)         |
| **D12** | D10-4 = **sólo `admin`**, pero `auth.md` §4.1/§4.2 diseñan `role: admin \| staff` | L5.3       | ✅ **resuelta** — ver abajo                       |

---

## 2. Resumen en una página

**Qué hay hoy (2026-10-06, al cierre):** **19 MD** — **11 vivos**, 3
congelados, 5 con contenido sin commit (`auth.md`, `refactormotor.md` y los 2
planes + `doc/api.md`, cuyo §3 es vivo). **0 MD untracked.** Se borraron **8**
en total: 6 históricos + `doc/plan.md` (D1/D3) + `plan-motor-de-renderizado`
(D8). **12/12 decisiones cerradas.**

**Qué hizo este plan:**

1. **Fase 1** — clasificar y decidir. ✅ **cerrada** (4/4)
2. **Fase 2** — reparar referencias rotas **R1–R6** + migrar una cita desde
   código. ✅ **cerrada** (8/8)
3. **Fase 3** — archivar/borrar **con aprobación explícita** por archivo. ✅
   **cerrada** (5/5)
4. **Fase 4** — higiene git (D11, revisar ignorados, formatear inputs). ✅
   **cerrada** (5/5)
5. **Fase 5** — cerrar las 13 decisiones de arranque y fijar nomenclatura. ✅
   **cerrada** (6/6)
6. **Fase 6** — gates + auditoría de enlaces + cierre + commit. 🔄 **en
   curso** (L6.1–L6.3 ✅ · L6.4 ✅ · L6.5 pendiente)

**Qué NO hizo:** tocar el motor, cambiar comportamiento, reformatear los
ficheros congelados.

**Resultado verificado (L6.1–L6.3):** 5 gates verdes sin regresión · 19 MDs ·
**0 enlaces rotos** · **0 citas rotas desde código** · prettier **17**.

---

## 5. Decisiones resueltas y nomenclatura

_**Única referencia** para quien escriba código. Resuelve L5.2 (D9), L5.3
(D10) y L5.4 (nomenclatura)._

### 5.1 D10 — `auth.md` §9 (7 decisiones) ✅ **RESUELTA**

**Jerarquía:** éstas **mandan sobre D9** (§5.2), porque `auth.md` es el
documento líder (cabecera de este plan).

| #   | Pregunta                             | **Decisión**                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Proveedor A / B / ambas              | **B — contraseña.** `_users` con `pass_hash`/`pass_salt` (tipo `secret`, ya diseñado en `auth.md §4.1`). Sin Google Cloud ni pantalla de consentimiento. **KDF real obligatorio:** GAS no tiene bcrypt → SHA-256 iterado con salt, nunca SHA-256 plano.                                                                                   |
| 2   | Duración de sesión                   | **6 h con renovación deslizante + tope absoluto de 7 días.** Hoy **no hay sesión**: el token viaja por request en el cuerpo (`api/core/10-router.js`).                                                                                                                                                                                    |
| 3   | «Recordarme» persistente             | **No — `sessionStorage`.** Muere al cerrar la pestaña ⇒ cero token legible por un XSS futuro.                                                                                                                                                                                                                                             |
| 4   | Cuántos roles                        | **Sólo `admin` asignado** → **D12 resuelta**: `auth.md` enmendado (§4.1 y §4.2 en `admin` sólo; §5.3 → `roles: ['admin']`). **`role:staff` se conserva como valor reservado del vocabulario §4.4** (nadie lo usa) para que la prueba `FORBIDDEN` de §8 siga siendo ejecutable — sin un segundo rol no hay con quién probar la denegación. |
| 5   | Formato de respuesta                 | **Se conserva el actual** (gobierna **O7**): `{ error: { status, message, errors? } }` de `api/core/12-http.js`. Sólo se añaden códigos `AUTH_*`. **No** se cambia a `{ ok: false }`.                                                                                                                                                     |
| 6   | Cuentas de cliente en la web pública | **No.** `public-order` y `pin-verify` siguen `access: 'public'` por PIN; la audiencia `customer` queda declarada pero sin usar.                                                                                                                                                                                                           |
| 7   | Logout individual «best-effort»      | **Aceptado.** `token_version` ya invalida **todas** las sesiones de un usuario (el caso importante). Revocar _una_ sesión exigiría tabla de sesiones activas + chequeo por request ⇒ latencia y cuota GAS (**O5**).                                                                                                                       |

**Hecho cuando:** las 7 están en §5. ✅

### 5.2 D9 — `refactormotor.md` §9 (6 decisiones) ✅ **RESUELTA**

**Jerarquía:** donde choquen con D10 (§5.1), **manda D10**.

| #   | Pregunta                               | **Decisión**                                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Autodescubrimiento o registro manual   | **Autodescubrimiento + `api:check`.** Soltar un fichero en `api/schema/endpoints/` lo registra (GAS carga todos los `.js`; `10-router.js` itera `Object.keys(REGISTRY.endpoints)`, **no hay manifiesto central**). La seguridad la pone el chequeo en despliegue (**O3**). Sin manifiesto ⇒ cero conflictos de merge.           |
| 2   | `snake_case` o `kebab-case` para ids   | **`kebab-case`.** Coherente con los ficheros existentes (`pin-verify`, `public-order`, `upload-signature`) y con `refactormotor §2` («kebab-case tipos»). `snake_case` queda **reservado a columnas y Properties** (`auth.md §6`: `pass_hash`, `MAYUS_SNAKE`). Ids de una sola palabra no cambian. **Fijar en el meta-schema.** |
| 3   | Codegen DATA→front obligatorio o aviso | **Ya decidida por `auth.md §10`** (documento líder): _«El §5 deja de proponer unir `data` y `ui` o generar un schema desde el otro: pasa a **dos schemas independientes + contrato vigilado por consumidor** y audiencias.»_ ⇒ **no** es obligatorio.                                                                           |
| 4   | Alcance del lenguaje de condiciones    | **Spec compartida + test de equivalencia.** Una lista única de operadores y su semántica en un fichero que consumen ambos (el repo ya tiene build en Node, **O3**); front y back implementan por su lado y **un test comprueba que dan el mismo resultado.**                                                                    |
| 5   | Límite de `aggregates` en Sheets       | **Cap declarativo + fail-loud.** `count`/`sum`/`avg` con **techo de filas escaneadas**; al superarlo **falla ruidoso** (§7.8: _«todo error silencioso es un bug»_). B5 (adaptador SQL) se pospone hasta **medir** la necesidad real. Hoy: 3 usos de `count` en `orders`.                                                        |
| 6   | Política de deprecación                | **1 versión, retiro por uso.** Confirma `refactormotor §7.1` (_«al menos una versión»_) y añade la condición de salida: sólo se retira cuando `contract-check` **no reporte ningún consumidor**. Sin número mágico: con evidencia.                                                                                              |

**Hecho cuando:** las 6 están en §5. ✅

### 5.3 Nomenclatura vigente (las dos fuentes) ✅ **HECHO**

**Referencia única para quien escriba código.** Fuentes primarias:
**`refactormotor.md §2`** (general) y **`auth.md §6`** (dominio auth). Donde
choquen, **manda `auth.md`** (cabecera de este plan).

#### A · General — `refactormotor.md §2`

**§2.1 Identificadores**

| Elemento                                                                | Convención                          | Ejemplos                                                |
| ----------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| **Valor de `type`/`format`/`kind`** (campos, widgets, acciones, vistas) | `kebab-case`, singular, descriptivo | `string-list`, `key-value`, `copy-share`, `metric-card` |
| **Claves de schema**                                                    | `camelCase`                         | `listProjection`, `visibleWhen`, `keyField`             |
| **Id de recurso** ← **D9-2**                                            | **`kebab-case`**, plural (decidido) | `orders`, `pickup-slots`                                |
| **Hojas / columnas**                                                    | `snake_case`                        | `customer_name`, `created_at`                           |
| **Columnas de grupo**                                                   | `<grupo>_<campo>`                   | `address_street`                                        |
| **Hojas hijas**                                                         | `<recurso>_<campo>`                 | `orders_items`                                          |
| **Namespaces custom**                                                   | prefijo `x-`                        | `x-analytics`, `x-legacy-id`                            |

> **⚠️ D9-2 aplicada aquí:** `refactormotor §2.1` decía _«`snake_case` o
> `kebab-case` (elegir **uno**)»_ — **resuelto a `kebab-case`**. `snake_case`
> queda **sólo** para hojas, columnas y Properties.

**§2.2 Sufijos y prefijos con significado fijo en las claves**

| Patrón               | Significa                               | Ejemplos                                                      |
| -------------------- | --------------------------------------- | ------------------------------------------------------------- |
| `*When`              | condición declarativa (booleano)        | `visibleWhen`, `readonlyWhen`, `requiredWhen`, `disabledWhen` |
| `*Template`          | cadena con `{placeholders}`             | `shareTextTemplate`, `routeTemplate`                          |
| `*Field` / `*Fields` | referencia a **clave de campo**         | `titleField`, `summaryFields`, `headerFields`                 |
| `*Projection`        | lista blanca de claves que viajan       | `listProjection`                                              |
| `on<Evento>`         | enganche a evento nombrado              | `onCreate`, `onDelete`, `onStatusChange`                      |
| `expose*`            | visibilidad hacia fuera                 | `exposeToFront`                                               |
| `*Ref`               | referencia a una entrada de un registro | `validatorRef`, `fetcherRef`                                  |

> **Regla:** si una clave nueva encaja en un patrón, **usa ese patrón**. Así
> quien lea un schema infiere el significado sin consultar documentación.

**§2.3 Archivos y carpetas**

| Capa                 | Convención                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Front, tipo de campo | `fields/field-<type>/field-<type>.ts`                                                                      |
| Front, widget        | `widgets/widget-<type>/widget-<type>.ts`                                                                   |
| Front, acción        | `actions/action-<type>.ts`                                                                                 |
| Front, descriptor    | `…/<type>.descriptor.ts` (junto al componente)                                                             |
| Back, tipos          | `api/capabilities/<categoria>.js`                                                                          |
| Back, recurso        | `api/schema/resources/<id>.js`                                                                             |
| Back, capacidades    | `api/capabilities/<categoria>/<nombre>.js` (`validators/`, `computed/`, `hooks/`, `checks/`, `operators/`) |
| Back, motor          | `api/engine/NN-<nombre>.js` (orden numérico = orden de carga)                                              |

**§2.4 Funciones**

- Registro: `register<Categoria>(descriptor)` → `registerFieldType`,
  `registerAction`, `registerValidator`.
- Consulta: `get<Categoria>(id)`; comprobación: `isSupported<Categoria>(id)`.
- Sufijo `_` en privadas del back (ya existe: `storageMap_`) — **mantenerlo**.

#### B · Dominio auth — `auth.md §6`

| Elemento                    | Convención                                                                        |
| --------------------------- | --------------------------------------------------------------------------------- |
| Hojas internas              | prefijo `_` + `snake_case`: `_users`, `_audit`                                    |
| Script Properties           | `MAYUS_SNAKE`: `AUTH_SECRET`, `GOOGLE_CLIENT_ID`                                  |
| Códigos de error            | `MAYUS_SNAKE` con prefijo de dominio: `AUTH_*`, `VALIDATION_*`                    |
| Niveles de acceso           | `public`, `session`, `role:<nombre>`                                              |
| Audiencias                  | minúsculas: `admin`, `public` (futuro `customer`)                                 |
| Funciones privadas del back | sufijo `_` (como hoy): `verifyToken_`, `issueToken_`, `setupAuth_`                |
| Handlers de auth            | `authLogin`, `authLogout`, `authMe`                                               |
| Claim del token             | `sub`, `sid`, `v`, `iat`, `exp`, `aud` (estándar JWT, aunque no sea JWT estricto) |

**Hecho cuando:** existe una referencia única para quien escriba código. ✅

### 5.4 Enmiendas aplicadas a los documentos líder ✅

**Aprobadas por el mantenedor el 2026-10-06** (fuera del alcance original del
plan — se pidieron explícitamente):

**D12 — `auth.md` enmendado** (en origen; `staff` fuera de la asignación):

| Origen | Antes                                            | Después                                                                  |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------------ |
| §4.1   | `role` = `admin` \| `staff`                      | `role` = **`admin`** (único asignado)                                    |
| §4.2   | `options: ['admin', 'staff']`                    | `options: ['admin']`                                                     |
| §4.4   | `role:staff` = «rol `staff` o superior»          | **`(reservado)`** — valor válido, nadie lo tiene; sólo para la prueba §8 |
| §5.3   | `roles: ['admin', 'staff']`                      | `roles: ['admin']`                                                       |
| §8     | «Rol `staff` en ruta `role:admin` → `FORBIDDEN`» | anotado con «valor reservado de §4.4, nadie lo tiene»                    |

**§9 de ambos documentos marcadas resueltas en origen:**

- `auth.md §9` → _«Decisiones — ✅ resueltas (2026-10-06)»_ + veredicto junto
  a cada una de las 7, con puntero a **§5.1**.
- `refactormotor.md §9` → _«Decisiones — ✅ resueltas (2026-10-06)»_ +
  veredicto junto a cada una de las 6, con puntero a **§5.2**.

**Verificación:** `grep -rn "Decisiones abiertas" doc/` → **0**. `staff` sólo
aparece en posiciones de vocabulario reservado. prettier global **17**.

---

## 6. Baseline

_Cargar en L5.1._

| Gate                          | Resultado                                              | Fecha                                                                        |
| ----------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `npm test`                    | ✅ **147/147** (29 ficheros)                           | 2026-10-06 (re-verificado tras Fase 2-3)                                     |
| `npm run test:api`            | ✅ **144/144** (15 ficheros)                           | 2026-10-06 (re-verificado tras Fase 2-3)                                     |
| `npm run api:check`           | ✅ **VERDE** — 7 recursos, 84 campos                   | 2026-10-06 (re-verificado tras Fase 2-3)                                     |
| `npm run build`               | ✅ verde (1.9 s)                                       | 2026-10-06 (re-verificado tras Fase 2-3)                                     |
| `npx prettier --check . 2>&1` | ✅ **17**                                              | 2026-10-06 — sólo **deuda preexistente**; L4.5 formateó los 2 inputs (19→17) |
| MDs totales                   | **19** (eran 25)                                       | 2026-10-06 — borrados 8 (D1, D3, D8)                                         |
| MDs untracked                 | **0** — los 4 inputs están **tracked** desde `946669b` | 2026-10-06 — corregido en Fase 3 (era «4»)                                   |
| Enlaces `.md` rotos           | **0**                                                  | 2026-10-06 (barrido `python3`)                                               |
| Citas en backticks rotas      | **0** (R1–R6 resueltas)                                | 2026-10-06 — cerradas en Fase 1 y 2                                          |

### Re-verificación final (L6.1–L6.3)

| Comprobación                           | Resultado                                    | Fecha      |
| -------------------------------------- | -------------------------------------------- | ---------- |
| `npm test`                             | ✅ **147/147** (29 ficheros) — sin regresión | 2026-10-06 |
| `npm run test:api`                     | ✅ **144/144** (15 ficheros)                 | 2026-10-06 |
| `npm run api:check`                    | ✅ **VERDE** — 7 recursos, 84 campos         | 2026-10-06 |
| `npm run build`                        | ✅ 🟢 (2.0 s)                                | 2026-10-06 |
| `npx prettier --check . 2>&1`          | ✅ **17**                                    | 2026-10-06 |
| MDs totales / untracked                | **19** / **0**                               | 2026-10-06 |
| Enlaces locales `.md`                  | **7 auditados → 0 rotos**                    | 2026-10-06 |
| Citas a `doc/` desde `scripts/`+`src/` | **6 → todas existen**                        | 2026-10-06 |
| Decisiones cerradas                    | **12 / 12**                                  | 2026-10-06 |

**Nota sobre prettier:** la línea subió de 18 a 19 por dos causas, **ninguna
de ellas regresión mía**:

1. **−1** `doc/plan.md` → borrado en Fase 3 (era deuda preexistente).
2. **+2** `src/environments/environment.ts` y `environment.local.example.ts`
   → estaban sucios **desde HEAD** (verificado con
   `git show HEAD:<f> | prettier --stdin-filepath`); la medición inicial del
   plan no los había contado.

Reparto verificado hoy: **17 deuda** (`.postcssrc.json`, 9 fixtures,
`api/PLAN*.md`, `doc/ui-ux.md`, `tsconfig.*`, `src/environments/*`) + 2 inputs
(`auth.md`, `refactormotor.md`).
