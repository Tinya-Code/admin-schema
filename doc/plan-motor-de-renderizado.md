# Plan por fases — Motor de renderizado y reforma de schemas

> **Propósito.** Reformar la forma en que `orders`, `pickpass` y `dashboard`
> declaran y renderizan, para que el sistema tenga **un motor** — front y back —
> y no tres conjuntos de decisiones específicas.
>
> **Formato.** Cada tarea es autocontenida: objetivo, archivos exactos, pasos,
> comando de verificación y criterio de «hecho». Está pensada para ejecutarse
> sin decisiones de alcance. Si una tarea obliga a decidir algo no previsto,
> **se detiene y se documenta** en «Decisiones pendientes» en vez de improvisar.
>
> **Documento de origen.** Los hallazgos R1–R10 están en
> `doc/pedidos-rectificacion.md`. Este plan los consume; no los repite.

---

## Cómo ejecutar este plan

1. **Una tarea a la vez.** Marcar el checkbox sólo después de que la
   verificación pase.
2. **Gates antes de cerrar cada tarea:**

   ```bash
   npm test                # front
   npm run test:api        # back
   npm run api:check       # contrato
   npm run build           # build de producción
   npx prettier --check . 2>&1   # ⚠️ los warnings van a stderr
   ```

3. **Reglas no negociables.**
   - **Nada específico de un schema.** Un componente, registro o endpoint nuevo
     se diseña para que _cualquier_ schema futuro lo use. Si sólo lo necesita
     `orders` hoy, igual se diseña genérico — esa no es una razón para
     hacerlo específico.
   - **Nada que toque los ficheros congelados:** `doc/ui-ux.md`, `doc/plan.md`,
     `api/PLAN.md`, `api/PLAN-MEJORAS.md`, `api/fixtures/*.json`,
     `.postcssrc.json`, `tsconfig.*.json`.
   - **Artefactos en español neutro; identificadores, UI y código en inglés.**
   - **Commits convencionales, sin atribución a IA.**
   - **Gotcha zsh:** cita los flags — `grep --include='*.ts'`; sin comillas la
     tanda entera aborta con `no matches found` y **los greps previos no corren**.
   - **`setupDrift()` sólo corre desde el editor de Apps Script.** Si una tarea
     necesita una columna nueva, se anota aquí y se le pide al humano correrlo.

---

## 0. Estado actual medido

Todo esto está verificado leyendo el código; nada es suposición.

### 0.1 Frontend — estructura

| Capa        | Qué hay                                                                                                                           | Dónde                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Schemas     | 7: `categories`, `dashboard`, `legal`, `orders`, `pickpass`, `products`, `site`                                                   | `src/app/schemas/`           |
| Campos      | 20 tipos + infraestructura (`field-host`, `field-node`)                                                                           | `src/app/fields/`            |
| Widgets     | 7 carpetas: `bar-chart`, `chart-line`, `metric-card`, `quick-actions`, `record-list`, `status-progress`, `widget-host`            | `src/app/widgets/`           |
| Compartidos | 10: `badge`, `button`, `confirm-dialog`, `copy-share`, `drawer`, `empty-state`, `modal`, `post-create-modal`, `skeleton`, `toast` | `src/app/shared/components/` |
| Páginas     | 6: `dashboard`, `detail-view`, `drawer-form`, `form-view`, `list-view`, `resource-page`                                           | `src/app/pages/`             |

### 0.2 El patrón de despacho está duplicado

`field-host` (431 líneas) y `widget-host` tienen **la misma forma**:

```
Set<string> de tipos soportados
+ imports manuales de cada componente
+ @switch (type) { @case ('…') { … } }
```

|               | Tipos declarados             | Componentes       | Forma             |
| ------------- | ---------------------------- | ----------------- | ----------------- |
| `field-host`  | `SUPPORTED_FIELD_TYPES` (20) | 20 imports a mano | `Set` + `@switch` |
| `widget-host` | `SUPPORTED_WIDGET_TYPES` (6) | 6 imports a mano  | `Set` + `@switch` |

**No existe equivalente para acciones.** `copy-share` se resuelve a mano en
`list-view.ts:714`, `detail-view.ts` y `post-create-modal.ts` — tres
implementaciones de la misma idea.

### 0.3 Uso real medido

| Elemento                           | Usos         | Estado                                   |
| ---------------------------------- | ------------ | ---------------------------------------- |
| `app-confirm-dialog`               | **0**        | **Sin usar**                             |
| `bar-chart`, `chart-line`          | 0 en schemas | Implementados, ningún schema los declara |
| `app-button`                       | 12           | ✅                                       |
| `app-skeleton` / `app-empty-state` | 5 / 5        | ✅                                       |
| Los 20 tipos de campo              | ≥ 1 cada uno | ✅ — ninguno huérfano                    |

### 0.4 Backend

| Endpoint          | Ruta                           | Consumo front       |
| ----------------- | ------------------------------ | ------------------- |
| `schema`          | `GET /admin/schema`            | ✅ 4 usos           |
| `uploadSignature` | `POST /admin/upload-signature` | ✅ 4 usos           |
| `dashboard`       | `GET /admin/dashboard`         | ✅ 1 uso            |
| `events`          | `POST /admin/events`           | **0 usos**          |
| `publicOrder`     | `GET /p/orders/:ref`           | **0 llamadas HTTP** |
| `pinVerify`       | `POST /p/orders/:ref/pin`      | **0 llamadas HTTP** |

Recursos con `exposeToFront: true`: los 7 (los mismos que tienen schema front).

Catálogo de tipos: **20 back (`api/schema/types/01-types.js`) ↔ 20 front**
— alineados.

### 0.5 ⚠️ Hallazgo que condiciona todo el plan

**No existe la ruta `/p/:ref` en el front.** `app.routes.ts` sólo declara el
shell de admin (`:id`, `:id/new`, `:id/:key/edit`, `:id/:key`) y `**` redirige
al inicio. Nadie llama a `pinVerify`.

Las únicas apariciones de `/p/{ref}` son **plantillas de URL** dentro de
`orders.schema.ts:62,64,73,75`.

**O sea: el admin genera enlaces a una página que no está en este repositorio.**

Hay dos lecturas y **cambian el alcance de la Fase 5**:

- **(a)** Existe una app pública separada (otro repo/deploy) → entonces hay que
  documentar su contrato y verificar que coincide con `publicOrder`/`pinVerify`.
- **(b)** No existe → el flujo de retiro está incompleto de punta a punta y hay
  que construirlo.

> **⛔ DECISIÓN BLOQUEANTE (D1).** Resolver antes de arrancar la Fase 5.
> El resto del plan no depende de esto.

---

## 1. Principios rectores

| #      | Principio                                                                                                                                                            | Cómo se verifica                                                                    |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **P1** | **Genérico por defecto.** Ningún componente, registro o endpoint se diseña para un schema concreto. Si `orders` es el único usuario hoy, se diseña igual para todos. | Revisión: el fichero nuevo no importa ni referencia `orders`/`pickpass`/`dashboard` |
| **P2** | **Declarar, no programar.** El schema **declara** `type`; el motor **resuelve**. Añadir un tipo = registrarlo una vez.                                               | No crece ningún `@switch` nuevo                                                     |
| **P3** | **Una sola forma de despachar.** `field-host` y `widget-host` comparten el mismo mecanismo; las acciones entran en él.                                               | El patrón vive en un único fichero                                                  |
| **P4** | **El back expone sólo lo que se consume.** Un endpoint sin consumidor se retira o se justifica.                                                                      | Lista de endpoints ↔ grep de consumo                                                |
| **P5** | **Contrato verificable.** Lo que el back proyecta y lo que el front muestra se comparan automáticamente.                                                             | `npm run api:check` ampliado                                                        |

---

## Fase 0 — Baseline y decisiones

**Objetivo:** tener una línea base medible y las decisiones abiertas resueltas
antes de tocar código.

- [ ] **T0.1** — Congelar el baseline actual
  - **Objetivo:** poder demostrar después qué cambió.
  - **Archivos:** `doc/plan-motor-de-renderizado.md` (este).
  - **Pasos:**
    1. Ejecutar los 5 gates y anotar las cifras exactas en la tabla
       «Baseline» (§0.6 al final de este documento).
    2. Contar componentes, tipos y endpoints con los greps de §0.1–0.4.
  - **Verificación:** las cifras anotadas coinciden con las del §0 (ya medidas).
  - **Hecho cuando:** la tabla §0.6 tiene los 5 gates con su cifra.

- [ ] **T0.2** — Resolver D1 (app pública `/p/:ref`)
  - **Objetivo:** definir si la Fase 5 construye o sólo verifica.
  - **Pasos:**
    1. Preguntar al humano: _¿existe la app pública en otro repo/deploy?_
    2. Registrar la respuesta en «Decisiones pendientes».
  - **Hecho cuando:** D1 está marcado como (a) o (b). **No se avanza a la
    Fase 5 sin esto.**

- [ ] **T0.3** — Definir el alcance de «motor de renderizado» para este repo
  - **Objetivo:** que todas las fases siguientes midan contra lo mismo.
  - **Pasos:** escribir 3–5 líneas en este documento, bajo §1, que digan qué
    significa «motor» acá (propuesta: _un registro por tipo de entidad
    renderizable — campo, widget, acción — con resolución declarativa y
    fallback explícito_).
  - **Hecho cuando:** §1 tiene la definición y ningún principio queda ambiguo.

---

## Fase 1 — Motor de renderizado (front)

**Objetivo:** reemplazar los `Set` + `@switch` duplicados por **registros
declarativos**. Es el corazón del plan.

**Precondición:** Fase 0 completada.

### 1.1 Acciones

- [ ] **T1.1** — Extraer el despacho de acciones a un registro
  - **Objetivo:** hoy `copy-share` está implementado 3 veces
    (`list-view.ts:714`, `detail-view.ts`, `post-create-modal.ts`).
  - **Archivos nuevos:** `src/app/actions/action-host/action-host.ts`,
    `src/app/actions/action-registry.ts`
  - **Archivos a tocar:** `list-view.ts`, `detail-view.ts`,
    `post-create-modal.ts`
  - **Pasos:**
    1. Crear `ActionSchema` como tipo en `core/models/schema.model.ts` si no
       existe (revisar primero; puede estar como `ResourceAction`).
    2. Crear `action-registry.ts`: mapa `type → componente`, con el mismo
       estilo que se proponga en T1.2.
    3. Crear `ActionHost` que reciba `action` + `record` y resuelva.
    4. Reemplazar los tres bloques manuales por `<app-action-host>`.
    5. **No** referenciar `orders` ni ningún schema dentro del registro.
  - **Verificación:** `npm test` en verde; `grep -rn "copy-share" src/app --include='*.ts'`
    sólo devuelve el registro y el schema.
  - **Hecho cuando:** sólo existe UNA implementación de `copy-share`.

- [ ] **T1.2** — Unificar el patrón de resolución campo/widget/acción
  - **Objetivo:** aplicar **P3** — una sola forma de despachar.
  - **Archivos:** `src/app/core/registry/render-registry.ts` (nuevo),
    `fields/field-host/field-host.ts`, `widgets/widget-host/widget-host.ts`
  - **Pasos:**
    1. Crear una función genérica `resolve<T>(registry, type, fallback)`.
    2. Migrar `SUPPORTED_FIELD_TYPES` y `SUPPORTED_WIDGET_TYPES` a entradas de
       registro con la misma forma.
    3. **Conservar** los `Set` existentes como derivados del registro (para no
       romper `isSupportedWidgetType`).
    4. El fallback explícito ya existe (`Skeleton` / `empty-state`): mantenerlo.
  - **Verificación:** `npm test`, `npm run build`. Un test nuevo que registre
    un tipo inventado y compruebe que resuelve.
  - **Hecho cuando:** añadir un tipo de campo exige **un registro**, no editar
    un `@switch`.

- [ ] **T1.3** — Test de exhaustividad del registro
  - **Objetivo:** que ningún tipo declarado en un schema quede sin componente.
  - **Archivos:** `src/app/core/registry/render-registry.spec.ts` (nuevo)
  - **Pasos:** test que recorra `REGISTRY` de tipos y afirme que **cada** tipo
    usado en `src/app/schemas/*.schema.ts` tiene componente asignado.
  - **Verificación:** `npm test`.
  - **Hecho cuando:** añadir `type: 'foo'` a cualquier schema **falla el test**.

### 1.2 Componentes compartidos

- [ ] **T1.4** — Auditar `confirm-dialog` (0 usos)
  - **Objetivo:** decidir entre usarlo o retirarlo. **No se decide solo.**
  - **Pasos:**
    1. Comprobar si `list-view` hace confirmación de borrado con otra cosa
       (revisar `notifications`/`confirm`).
    2. Documentar el hallazgo en «Decisiones pendientes» (D2).
  - **Hecho cuando:** D2 está registrado con la evidencia. El borrado de código
    **sólo** se hace con aprobación explícita.

- [ ] **T1.5** — Verificar que todo componente compartido es genérico
  - **Objetivo:** aplicar **P1** retroactivamente.
  - **Archivos:** los 10 de `src/app/shared/components/`
  - **Pasos:** para cada uno, `grep` de referencia a un schema concreto
    (`orders|pickpass|dashboard`) dentro del componente.
  - **Verificación:** grep en 0 resultados (los `*.spec.ts` que prueban
    integración con un schema sí están permitidos).
  - **Hecho cuando:** los 10 pasan, o las excepciones están en «Decisiones
    pendientes».

---

## Fase 2 — Motor de exposición (back)

**Objetivo:** que lo que el back expone esté declarado y sea comprobable —
**P4** y **P5**.

**Precondición:** Fase 1 (parcial puede correr en paralelo; no comparten
ficheros).

- [ ] **T2.1** — Inventario de consumo de endpoints
  - **Objetivo:** cerrar el §0.4 con evidencia de archivo:línea.
  - **Pasos:** para cada uno de los 6 endpoints, localizar el fichero y línea
    del consumidor front, o marcar «sin consumidor».
  - **Verificación:** la tabla §0.4 tiene la columna «evidencia» completa.
  - **Hecho cuando:** `events`, `publicOrder` y `pinVerify` tienen veredicto
    fundado (no «creo que»).

- [ ] **T2.2** — Decidir el destino de `events` (D3)
  - **Pasos:** si nadie lo consume, registrar D3: retirarlo, o justificarlo
    (p. ej. telemetría futura). **No se retira sin aprobación.**
  - **Hecho cuando:** D3 registrado.

- [ ] **T2.3** — Declarar la exposición en una sola fuente
  - **Objetivo:** que `exposeToFront` y la existencia del schema front no
    puedan divergir.
  - **Archivos:** `scripts/contract-check.mjs`
  - **Pasos:**
    1. Regla nueva: recurso con `exposeToFront: true` **debe** tener
       `src/app/schemas/{id}.schema.ts`, y viceversa.
    2. Verificar que ya no lo hace de forma incompleta (hoy compara
       back→front en la línea 217, pero **no** el caso inverso de
       `exposeToFront`).
  - **Verificación:** `npm run api:check`.
  - **Hecho cuando:** un recurso sin schema front rompe el gate.

- [ ] **T2.4** — Ampliar `contract-check` con lo que hoy no compara (R6)
  - **Objetivo:** cerrar el hueco que permitió divergencias en verde.
  - **Archivos:** `scripts/contract-check.mjs`
  - **Pasos:** añadir comparación de, en este orden:
    1. `enum` (back) ↔ `options[].value` (front) para `select`/`multiselect`
    2. `default` back ↔ `default` front
    3. `listProjection` (back) ⊇ `listColumns` (front)
    4. `postCreate.summaryFields` y `detail.headerFields` ⊆ campos declarados
  - **Verificación:** `npm run api:check` en verde con los 7 recursos.
  - **Hecho cuando:** los 4 puntos corren y ninguno reporta divergencia — si
    alguna diverge, **se documenta en Decisiones pendientes**, no se parchea a
    ciegas.

- [ ] **T2.5** — Añadir detección de drift schema ↔ hoja (R2)
  - **Objetivo:** que esto no vuelva a pasar como con `orders.pin`.
  - **Archivos:** `scripts/contract-check.mjs` o script nuevo
    `scripts/sheet-drift-check.mjs`
  - **Pasos:**
    1. Analizar vía `clasp pull` a directorio temporal (**nunca** en `api/`,
       `clasp pull --rootDir` no existe en clasp 3.4.1 y pisaría cambios).
    2. Comparar headers reales de cada hoja contra los campos del recurso.
    3. Reportar columnas faltantes como **error**.
  - **Verificación:** el script detecta un campo ficticio si se añade a un
    recurso sin tocar la hoja.
  - **Hecho cuando:** existe un gate que habría fallado antes de R1.

---

## Fase 3 — Reforma de los schemas front

**Objetivo:** que `orders`, `pickpass` y `dashboard` declaren en la forma nueva
y **nada específico** quede en el schema.

**Precondición:** Fase 1 completada.

- [ ] **T3.1** — `orders.schema.ts`: revisar declaraciones contra el back
  - **Pasos:**
    1. Recorrer los 20 campos: ¿`label`, `help`, `section`, `width`,
       `hiddenOn`, `readonlyOn` están justificados?
    2. Verificar `listColumns` ⊆ `listProjection` (hoy `pin` **no** está en
       `listColumns` — decisión que debe quedar explícita).
    3. Verificar `postCreate.summaryFields` — R9: ¿`pin` entra o no?
  - **Verificación:** `npm run api:check` + `npm test`.
  - **Hecho cuando:** cada decisión de excluir un campo está anotada en el
    fichero como comentario de **una línea**, no como texto largo.

- [ ] **T3.2** — `pickpass.schema.ts`: campos sin consumidor (R3)
  - **Pasos:**
    1. Verificar que `pin_ttl_hours` y `pin_enabled` siguen sin runtime que
       los lea.
    2. Decidir D4: implementar TTL/`pin_enabled`, o **retirar los campos**
       (hoy se puede configurar algo que no hace nada → error de UX).
  - **Hecho cuando:** D4 registrado con evidencia `grep`.

- [ ] **T3.3** — `dashboard.schema.ts`: widgets y rutas
  - **Pasos:**
    1. Verificar `record-list.action.routeTemplate = '/orders/{ref}'` contra
       las rutas reales de `shell.routes.ts` (`:id/:key` ✓).
    2. Verificar `quick-actions.navigateTo = '/orders/new'` → coincide con
       `:id/new` ✓.
    3. Verificar `source: 'payload'` de `status-progress` contra lo que
       realmente devuelve el endpoint.
    4. Decidir D5: `bar-chart`/`chart-line` existen y ningún schema los
       declara → ¿se usan en un próximo widget o se retiran?
  - **Verificación:** `npm test` + `npm run build`.
  - **Hecho cuando:** los 5 widgets del dashboard apuntan a claves que el
    endpoint devuelve (comprobar con el fixture de respuesta real).

---

## Fase 4 — Reforma de los resources back

**Objetivo:** los 3 recursos declaren sólo lo que el sistema usa.

**Precondición:** Fase 2 completada.

- [ ] **T4.1** — `orders.js`
  - **Pasos:**
    1. Verificar `listProjection` contra `listColumns` (regla T2.4 ya activa).
    2. Verificar `views` (`pendientes`, `entregados`, `cancelados`,
       `pendientes_recientes`) — ¿se consumen las 4? `pendientes_recientes`
       sí (record-list); las 3 de aggregate van al `status-progress`.
    3. Revisar `checks`: `not-in-sheet`, `no-auth-after-delivered`,
       `history-append-only` — ¿están cubiertos por tests?
    4. Revisar `policies.cache.ttl: 60` frente a `audit: true` y `lock: true`
       — coherencia.
  - **Verificación:** `npm run test:api` + `npm run api:check`.

- [ ] **T4.2** — `pickpass.js`
  - **Pasos:**
    1. Verificar `kvColumns` contra la hoja real (singleton KV).
    2. Verificar que `policies.cache.ttl: 300` no sirve datos obsoletos tras
       cambiar `public_base_url` (¿se invalida en update?).
    3. Resolución de D4 (T3.2).
  - **Verificación:** `npm run test:api`.

- [ ] **T4.3** — `dashboard.js`
  - **Pasos:**
    1. `sheet: null` y `fields: []` — confirmar que el guard de M1 cubre
       `getSheetByName(undefined)` (ya verificado en `02-setup-sheets.js:119`).
    2. Verificar `exposeToFront: true` — ¿de verdad necesita exponerse si no
       tiene campos? Relacionado con T2.3.
    3. Verificar `policies.access` coherente con el endpoint `admin`.
  - **Verificación:** `npm run api:check` + `npm run test:api`.

---

## Fase 5 — Integración pública (⛔ requiere D1)

**Objetivo:** el flujo de retiro funciona de punta a punta.

**No se ejecuta hasta resolver D1 (T0.2).**

### Si D1 = (a) app pública en otro repo

- [ ] **T5.1** — Documentar el contrato público
  - **Pasos:** anotar aquí las rutas que esa app llama y compararlas con
    `publicOrder` (`GET /p/orders/:ref`) y `pinVerify`
    (`POST /p/orders/:ref/pin`), incluida la forma del body y los códigos de
    error.
  - **Hecho cuando:** no hay diferencia entre lo que el back expone y lo que
    esa app llama.

### Si D1 = (b) no existe

- [ ] **T5.2** — Construir la ruta pública
  - **Pasos:**
    1. Ruta `/p/:ref` fuera del shell de admin (`app.routes.ts`).
    2. Página que llama `publicOrder`, muestra los datos permitidos.
    3. Formulario de PIN que llama `pinVerify`.
    4. Estados: activo, incorrecto, agotado (429), ya usado (409), 404.
  - **Verificación:** `npm test` con un spec por estado.
  - **Hecho cuando:** el enlace generado en el modal de alta abre y se puede
    completar el retiro.

### En ambos casos

- [ ] **T5.3** — Cerrar R10 (pedidos sin PIN recuperable)
  - **Pasos:** decisión D6 — recrear los pedidos previos, o implementar
    regeneración (transform + fila + sustitución de la fila en `_pin` en la
    misma transacción; hacerlo en dos pasos deja el hash desincronizado).
  - **Hecho cuando:** D6 registrado y, si aplica, implementado con test.

- [ ] **T5.4** — TTL y estado del pedido (R3)
  - **Pasos:** si D4 decide implementar, `pin-verify` debe comparar
    `created_at + pin_ttl_hours` contra `now` y rechazar pedidos
    `ENTREGADO`/`CANCELADO`.
  - **Verificación:** tests de: vigente, expirado, entregado, cancelado.

---

## Fase 6 — Verificación continua

- [ ] **T6.1** — Test end-to-end del mensaje compartido (R4)
  - **Objetivo:** eliminar el test autoconfirmatorio.
  - **Archivos:** `src/app/schemas/orders.schema.spec.ts` o spec nuevo
  - **Pasos:** test que parta de la **respuesta del back simulada** (con
    `pin` presente) y afirme que el texto copiado termina con el PIN. **No**
    inyectar el PIN en la plantilla: pasar el registro entero.
  - **Hecho cuando:** si el back deja de enviar `pin`, este test falla.

- [ ] **T6.2** — Test back: create → respuesta contiene `pin`
  - **Archivos:** `api/__tests__/pin-generate.spec.js`
  - **Pasos:** además del transform y del hook, afirmar que la **respuesta** de
    `resourceCreate_` incluye `pin` no vacío.
  - **Hecho cuando:** R1 está cubierto por un test, no sólo por inspección.

- [ ] **T6.3** — Documentar los gates en el README del repo
  - **Pasos:** tabla de comandos + aviso del `2>&1` de prettier.
  - **Hecho cuando:** un agente nuevo sabe qué correr sin preguntar.

---

## Fase 7 — Limpieza

**Precondición:** fases anteriores cerradas. **Nada se borra sin aprobación.**

- [ ] **T7.1** — Confirmar D2 (`confirm-dialog`)
- [ ] **T7.2** — Confirmar D5 (`bar-chart`/`chart-line`)
- [ ] **T7.3** — Confirmar D3 (`events`)
- [ ] **T7.4** — Reejecutar los 5 gates y comparar contra el baseline T0.1
- [ ] **T7.5** — Actualizar este documento con el estado final

---

## Decisiones pendientes

| ID     | Decisión                                                  | Bloquea    | Estado     |
| ------ | --------------------------------------------------------- | ---------- | ---------- |
| **D1** | ¿Existe la app pública `/p/:ref` en otro repo?            | Fase 5     | ⛔ abierta |
| **D2** | ¿Se usa `confirm-dialog` o se retira?                     | T1.4, T7.1 | abierta    |
| **D3** | ¿Se retira `POST /admin/events`?                          | T2.2, T7.3 | abierta    |
| **D4** | ¿Se implementa TTL/`pin_enabled` o se retiran los campos? | T3.2, T4.2 | abierta    |
| **D5** | ¿Se usan `bar-chart`/`chart-line` o se retiran?           | T3.3, T7.2 | abierta    |
| **D6** | ¿R10: recrear pedidos o regenerar PIN?                    | T5.3       | abierta    |
| **D7** | ¿`pin` entra en `postCreate.summaryFields`? (R9)          | T3.1       | abierta    |

---

## 0.6 Baseline

_Cargar en T0.1._

| Gate                               | Resultado         | Fecha      |
| ---------------------------------- | ----------------- | ---------- |
| `npm test`                         | —                 | —          |
| `npm run test:api`                 | —                 | —          |
| `npm run api:check`                | —                 | —          |
| `npm run build`                    | —                 | —          |
| `npx prettier --check . 2>&1`      | —                 | —          |
| Componentes compartidos            | 10                | 2026-10-06 |
| Tipos de campo                     | 20 ↔ 20           | 2026-10-06 |
| Endpoints                          | 6 (3 sin consumo) | 2026-10-06 |
| Widgets declarados / implementados | 4 / 6             | 2026-10-06 |
