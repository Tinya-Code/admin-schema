# Pedidos — flujo de la información y rectificación

> **Alcance.** Revisión de `orders` (Pedidos) de punta a punta: contrato back
> (`api/schema/resources/orders.js`) ↔ contrato front
> (`src/app/schemas/orders.schema.ts`), el motor que los une
> (`api/engine/*`) y los componentes que renderizan ambos.
>
> **Método.** Cada afirmación lleva `archivo:línea`. No se afirma nada que no
> esté leído. Lo verificado automáticamente se separa de lo que requiere
> verificación manual contra la hoja real.
>
> **Disparador.** El mensaje copiado al cliente salía con el PIN en blanco:
> _«…puede retirar su pedido W4EHU3 aquí: http://localhost:4200/p/W4EHU3. Su PIN es .»_

---

## 1. Lo que Pedidos debe hacer

1. **Alta.** El operador carga nombre, descripción, fecha de retiro, estado y
   (opcional) persona autorizada. El sistema **genera** dos valores que el
   operador no escribe:
   - `ref` — código de 6 caracteres legibles (sin `0/O`, `1/I`), identidad
     inmutable del pedido.
   - `pin` — 6 dígitos de un solo uso, que autoriza el retiro.
2. **Compartir.** Tras el alta se ofrece un mensaje listo para mandar al
   cliente: saludo, `ref`, enlace público y **el PIN**.
3. **Retiro.** El cliente abre `/p/{ref}` e ingresa el PIN. El sistema lo
   verifica contra el **hash** guardado — nunca contra el valor en claro —,
   con límite de intentos, de un solo uso y con traza de fallos.
4. **Consulta.** El operador ver/pida el PIN de un pedido en particular
   (dictarlo por teléfono), pero **no puede editarlo**: modificarlo a mano
   rompería la correspondencia con el hash.

---

## 2. Flujo de la información

### 2.1 Alta y mensaje compartido

```
form-view ──buildPayload──▶ envelope {token, method, path, payload}
   │                          │  form-model.ts:52  excluye nodos hidden()
   ▼                          ▼
10-router.js:163 doPost ──▶ dispatchResource_ (24-crud:41)
   ▼
resourceCreate_ (24-crud:171)
   ├─ validateHooks_ (175)         falla rápido si falta un hook declarado
   ├─ preparePayload_ (176) ──▶ computeRules_ (617)
   │      computeRules_ SÓLO si isNew (618)
   │      respeta valor entrante  (635)
   │      exige `from` no vacío   (637)  ← ref y pin declaran from: customer_name
   │      escribe sólo string≠''  (639)
   ├─ validateAndThrow_ ×2 (181, 195)
   ├─ contractToFlat_ (213 → 22-assemble:46)   salta col.system || col.computed (49)
   ├─ rowValues_(data.headers, flat) (21-repo:89)   ▲ itera los headers de la HOJA
   ├─ setValues (228)
   ├─ writeChildren_ (235)         hoja hija: order_history
   ├─ auditWrite_ (239) · cacheInvalidate_ (240)
   ├─ emitHook_ (241)              pinHash → escribe hash en _pin  (aislado)
   └─ shapeResponse_(…, readDetail_(…)) (242)   ▲ la respuesta LEE LA HOJA
   ▼
postCreateModal · record() = respuesta
   ├─ interpolateTemplate(description, record, configValues)   (:98)
   └─ interpolateTemplate(shareTextTemplate, record, …)        (:129)
   ▼
copy-share ──buildShareMessage──▶ portapapeles   (clipboard.ts:18)
```

**Punto crítico:** la respuesta **no devuelve el payload que se envió**; devuelve
lo que `readDetail_` encontró escrito en la hoja (línea 242). Todo lo que el
motor descarte al escribir desaparece también de la respuesta.

### 2.2 Los tres contextos de interpolación

| Contexto      | Fuente de datos                                                              | Archivo                                       |
| ------------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| Modal de alta | `record()` — registro completo                                               | `post-create-modal.ts:129`                    |
| Detalle       | `effectiveRecord()`                                                          | `detail-view.ts:465,472`                      |
| Listado       | `buildInterpolationContext(row)` = `{...config, ...record, public_base_url}` | `list-view.ts:711`, `config.service.ts:68-72` |

Los tres comparten `interpolateTemplate`, que **no avisa de claves faltantes**:
devuelve cadena vacía. Un dato ausente no produce error, produce texto incompleto.

### 2.3 Verificación del PIN

```
cliente ──POST /p/orders/:ref/pin──▶ handlePinVerify (public, access 'public')
   ├─ busca el ref en _pin
   ├─ activo y no usado ─▶ compara SHA-256
   ├─ acierto ─▶ marca used_at (un solo uso)
   └─ fallo  ─▶ fila __failed__ aparte; 429 tras 5 en 60 s
```

---

## 3. Qué se renderiza y qué no

### 3.1 Regla base de visibilidad (front)

| Mecanismo                                    | Efecto                                                        | Evidencia                                       |
| -------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| `hidden()` → `@if (supported())`             | **No se dibuja**                                              | `field-host.ts:132`, `:310`                     |
| `hidden()` en `buildPayload`                 | **Fuera del payload**                                         | `form-model.ts:52`                              |
| `hidden` / `disabled` / `readonly`           | **Fuera de la validación**                                    | `shouldSkipValidation`, fuente `@angular/forms` |
| `hiddenOn: 'create' \| 'update' \| 'always'` | Ciclo de vida de **visibilidad** por modo                     | `schema.model.ts`, `form-schema.ts`             |
| `readonlyOn`                                 | Ciclo de vida de **bloqueo** por modo                         | `schema.model.ts:52-55`                         |
| `visibleWhen`                                | Condición sobre el valor de **otro campo** (no sobre el modo) | `schema.model.ts`                               |

> `hiddenOn` y `readonlyOn` no son intercambiables: el primero decide si el
> campo **existe en pantalla**, el segundo si se puede **tocar**.

### 3.2 Qué llega a cada superficie

| Superficie           | Define qué se ve               | Fuente del dato                                   |
| -------------------- | ------------------------------ | ------------------------------------------------- |
| Tabla del listado    | `listColumns`                  | filas **proyectadas** por `listProjection` (back) |
| Cabecera del detalle | `detail.headerFields`          | registro completo                                 |
| Cuerpo del detalle   | `fields[]`                     | `effectiveRecord()`                               |
| Formulario           | `fields[]` + `layout.sections` | payload editado                                   |
| Resumen del modal    | `postCreate.summaryFields`     | respuesta del create (vacío ⇒ `—`)                |
| Mensaje compartido   | `shareTextTemplate`            | respuesta del create                              |
| Filtros / búsqueda   | `filters`, `search`            | proyecto del listado                              |

**Regla que no está escrita en ningún lado:** si un campo no está en
`listProjection`, **nunca llega al listado**, aunque esté en `listColumns`.
El front no avisa: la celda sale vacía. Es la causa directa de la asimetría
observada.

---

## 4. Rectificación: esperado vs. actual

### 🔴 Bloqueantes

#### R1 — Faltaba la columna `orders.pin` — ✅ RESUELTO

**Esperado:** al crear, el PIN se escribe en la fila y su hash en `_pin`.

**Actual:** el valor en claro se descartaba en silencio.

**Reporte de `setupDrift()` (06/10/2026):**

```json
{
  "ok": true,
  "createdSheets": [],
  "added": ["orders.pin"],
  "orphans": [],
  "blocked": [],
  "schemaVersion": "8355f37c21116605",
  "schemaVersionChanged": true
}
```

Confirmado: **lo único que faltaba era la columna `orders.pin`**. La hoja
`_pin` ya existía (`createdSheets: []`), sin huérfanas ni conflictos de tipo.

> **Corrección de esta misma revisión.** La primera versión de este documento
> afirmó que `_pin` también faltaba y que por eso `pin-verify` respondería 404.
> **Eso era falso**: `createdSheets: []` lo desmiente. El hook `pinHash` sí
> corrió en cada alta — lee `ctx.payload.pin` (`pin-verify.js:153`) y el
> payload **sí** tenía el PIN, porque `computeRules_` lo rellena antes de
> escribir la fila.

**Cadena de evidencia (por qué salía vacío):**

1. `rowValues_(headers, flat)` itera **los headers de la hoja física**, no el
   payload — `21-repo.js:89-94`. Sin columna `pin`, su valor **jamás entraba
   en la fila**.
2. `setHeaderCell_` hace `if (idx !== -1) row[idx] = value` —
   `24-crud.js:722-725`. Columna ausente ⇒ **no escribe y no avisa**.
3. La respuesta sale de `readDetail_`, no del payload — `24-crud.js:242`.
   Por eso `ref` sí aparecía (columna existente) y `pin` no: **misma
   transformación, distinta existencia de columna.**

> **Restricción operativa:** `setupDrift` **sólo** corre desde el editor —
> `clasp run` y la Execution API devuelven `NOT_FOUND`
> (`PLAN-MEJORAS.md:692`). No existe endpoint de setup a propósito (R7).
> **Es la razón de que esto quedara roto en silencio:** toda evolución de
> schema exige un paso manual invisible que nada verifica.

**Consecuencia pendiente → R10:** los pedidos creados **antes** de esta corrida
tienen `pin` vacío en la fila. Ver R10.

#### R2 — El motor descarta datos en silencio

`rowValues_` y `setHeaderCell_` ignoran valores cuya columna no existe, sin
error ni reporte. El fallo se manifiesta **aguas abajo** como un texto
incompleto («Su PIN es .») o como un registro sin su campo.

**Rectificación propuesta:** al construir la fila, reportar (o bloquear) cuando
un valor del payload no tiene columna destino. Hoy `contract-check` valida el
código, pero **nada valida la hoja real**.

#### R10 — Los pedidos creados antes del arreglo quedaron sin PIN recuperable

**Esperado:** cada pedido tiene un PIN que el cliente puede usar una vez.

**Actual:** los pedidos altados **antes** de la corrida de `setupDrift` tienen
`pin` vacío en la fila, porque el valor nunca llegó a persistirse. Y no hay
cómo recuperarlo:

- El hash **sí** está en `_pin` (el hook leyó `payload.pin`, que tenía valor),
  pero es SHA-256: no se revierte.
- **No existe ruta de regeneración**:
  - `computeRules_` sólo corre con `isNew` — `24-crud.js:618`; el update lo
    llama con `isNew: false` (`:265`, `:340`) y **no** rederiva nada.
  - El único uso del transform `pin` es `orders.js:39` (alta).
  - El front declara `readonlyOn: 'always'` → el campo no se puede editar en
    la UI; a mano en la hoja, además, dejaría el hash de `_pin` desincronizado.

**Consecuencia:** esos pedidos **no pueden completar el retiro**: o no tienen
hash (altados antes de desplegar el hook) o tienen hash sin nadie que conozca
el PIN.

**Opciones:** recrear el pedido (ahora funciona), o regenerar el PIN en el back
— que implica una operación nueva: transform + escritura en la fila **y**
sustitución de la fila en `_pin` en la misma transacción.

---

### 🟡 Medios

| #   | Hallazgo                                                                                                                                                                                                                                                                | Evidencia                                         | Por qué importa                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3  | `pin_ttl_hours` y `pin_enabled` **no los lee ningún código runtime**: el back los declara (`pickpass.js:29-30`), el front permite editarlos (`pickpass.schema.ts:44,56`) y `transforms.js:56` los menciona en un comentario de diseño pendiente, pero nadie los consume | grep sin consumidores                             | El PIN **no caduca nunca** y `pin_enabled` no lo desactiva. Además `pin-verify.js` **no compara `status`** (grep vacío): un pedido `ENTREGADO` o `CANCELADO` sigue aceptando el PIN.                           |
| R4  | El único test que interpola el mensaje **inyecta él mismo el PIN**, así que pasa aunque el back nunca lo envíe                                                                                                                                                          | `orders.schema.spec.ts:115-124` (`pin: '482913'`) | **Es la razón de que R1 haya pasado en verde.** Prueba plantilla + interpolador, pero nada afirma que la respuesta del create contenga `pin`. Es un test autoconfirmatorio: no puede fallar por la falla real. |
| R5  | `public_base_url` cae a `window.location.origin` si el config está vacío                                                                                                                                                                                                | `config.service.ts:66`                            | Un enlace copiado desde el origen del admin (hoy `localhost:4200`) no le sirve al cliente.                                                                                                                     |
| R6  | `contract-check` **no compara** `enum`/`options`, `default`, `listProjection`↔`listColumns`, `summaryFields`, `headerFields`                                                                                                                                            | `contract-check.mjs:122-175`                      | Compara `kind`, `endpoint`, `required` y `validators`. Un `enum` divergente pasaría en verde.                                                                                                                  |
| R7  | `setupDrift` exige editor; sin endpoint ni `clasp run`                                                                                                                                                                                                                  | `PLAN-MEJORAS.md:692`                             | Toda evolución de schema (como la de `pin`) requiere un paso manual que nadie ve. Fue exactamente lo que falló acá.                                                                                            |
| R8  | `appsscript.json` no declara `filePushOrder`                                                                                                                                                                                                                            | grep vacío                                        | El orden de carga de scripts no está fijado explícitamente.                                                                                                                                                    |

### 🟢 Bajos

| #   | Hallazgo                                                                                                              | Evidencia             |
| --- | --------------------------------------------------------------------------------------------------------------------- | --------------------- |
| R9  | `pin` no figura en `postCreate.summaryFields` — no aparece en la tarjeta de resumen (sólo dentro del mensaje copiado) | `orders.schema.ts:56` |

---

### ✅ Ya rectificado en este ciclo

| Qué                                                                             | Cómo                                                                                                                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref` y `pin` se mostraban vacíos y de solo-lectura en el alta                  | `hiddenOn: 'create'` en ambos; `ref` además pasó a `readonlyOn: 'always'` (coherente con `immutableKey: true`, que rechaza la edición en el back) |
| `pin` no llegaba al listado                                                     | Añadido a `listProjection` (`orders.js:26-34`)                                                                                                    |
| `form-schema.ts` sin ningún test (538 líneas)                                   | Nuevo `form-schema.spec.ts` — cubre `hiddenOn` por modo y su distinción con `visibleWhen`                                                         |
| Harness de tests: `Utilities.getUuid` devolvía un Proxy y bucleaba para siempre | Comprobación de tipo y longitud en el stub                                                                                                        |

---

## 5. Verificación

### Automatizada — verde

| Gate                      | Resultado                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test` (front)        | **147/147** — 29 ficheros                                                                                                                                    |
| `npm run test:api` (back) | **144/144** — 15 ficheros                                                                                                                                    |
| `npm run api:check`       | 🟢 7 recursos, **84 campos** comparados                                                                                                                      |
| `npm run build`           | 🟢                                                                                                                                                           |
| `npx prettier --check .`  | 🟢 (los 16 warnings restantes son deuda preexistente: `doc/ui-ux.md`, `doc/plan.md`, `api/PLAN*.md`, `api/fixtures/*.json`, `tsconfig.*`, `.postcssrc.json`) |

### Manual — pendiente (no verificable sin la hoja real)

1. ~~**Estado de la hoja `orders`**~~ — ✅ faltaba `orders.pin` (reporte de `setupDrift`).
2. ~~**Estado de la hoja `_pin`**~~ — ✅ ya existía (`createdSheets: []`).
3. ~~**Correr `setupDrift()`**~~ — ✅ 06/10/2026, `ok: true`.
4. **Reintentar el alta** y confirmar que el mensaje copiado trae el PIN.
5. **`pin-verify` end-to-end**: acierto, error, agotamiento y doble uso.
6. **`public_base_url` en producción**: que no caiga al origen del admin.
7. **Inventariar los pedidos previos** y decidir R10 (recrear o regenerar).

---

## 6. Acciones de rectificación

| #         | Acción                                                                                                                                                                        | Bloquea |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| ~~**1**~~ | ~~Correr `setupDrift()` desde el editor de Apps Script~~ ✅ `added: ["orders.pin"]`                                                                                           | ~~R1~~  |
| **2**     | Repetir el alta y verificar el PIN en el mensaje                                                                                                                              | R1      |
| **3**     | Probar `pin-verify` de punta a punta                                                                                                                                          | R1      |
| **3b**    | **Decidir R10**: recrear los pedidos previos o implementar regeneración de PIN                                                                                                | R10     |
| **4**     | Añadir un test que afirme que **la respuesta del create contiene `pin`** y que el listado lo proyecta — hoy el único test que interpola lo inyecta él mismo y no puede fallar | R4, R2  |
| **5**     | Decidir TTL (`pin_ttl_hours`) e invalidación por `status`                                                                                                                     | R3      |
| **6**     | Reservar `public_base_url` en el config de producción                                                                                                                         | R5      |
| **7**     | Ampliar `contract-check` con `enum`/`options`, `default` y alineación de proyecciones                                                                                         | R6      |
| **8**     | Decidir si `pin` entra en `summaryFields`                                                                                                                                     | R9      |

> **Nota sobre R2/R4:** un test que construye su hoja falsa **a partir del
> schema** nunca puede detectar que la hoja real se quedó atrás del schema.
> Por eso los 291 tests estuvieron en verde mientras el PIN salía vacío: el
> hueco está entre el schema y la hoja, y hoy no hay nada que lo mida.
