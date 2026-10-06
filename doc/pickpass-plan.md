# PickPass — plan de implementación

> **Etapa 2 de 2: los datos.** Asume el motor ya ampliado
> ([`motor-plan.md`](./motor-plan.md) — Etapa 1, el renderizador) y acá se
> implementan los **schemas** para probarlos con datos reales.
>
> El **por qué** vive en [`pickpass-viabilidad.md`](./pickpass-viabilidad.md):
> **A6** = criterio de diseño, **C4** = inventario de huecos del DSL.

**Leyenda**

| Marcador | Significado                                                 |
| -------- | ----------------------------------------------------------- |
| 🔵       | **No toca `engine/` ni `setup/`** — registro o declaración  |
| 🟡       | **Toca el motor** → su test se escribe **antes** del cambio |
| 🔴       | Bloqueante de una fase posterior                            |

---

## ⚙️ Qué toca el motor (referencia)

> **Las fases 1, 2, 4, 5 y 6 NO tocan ni `engine/` ni `setup/`.**
> Los 3 cambios posibles (M1, M2, M3) están en `motor-plan.md` Parte 1.2
> y **M1 se hace en la Etapa 1 (T2)** — acá sólo se usa.

| Se quiere                           | Por qué no hace falta tocar nada                                                |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| Reportar eventos del navegador      | `REGISTRY.endpoints` + handler — `upload-signature.js` (`limits: '10/min'`)     |
| Hecho de negocio (crear / entregar) | Ya está: `_audit_log` vía `24-crud.js:706`                                      |
| Métricas agregadas                  | `views` ya tiene escape hatch `handler` (`27-views.js:7-13`, ejecuta en `:199`) |
| Página de config                    | `kind: 'singleton'` ya existe (`site.js:1`)                                     |
| Acciones custom / `request.action`  | No se necesita — se actualiza como cualquier campo                              |

---

# Fase 1 — Recurso `orders` 🔴

> **Resultado:** el negocio crea pedidos, anota el autorizado, marca ENTREGADO
> y lee el historial. Sustituye el WhatsApp desde el día uno.
> **Motor:** 🔵 cero cambios en `orders` — **salvo los 2 checks** (ver 1.1).
> ✅ **`transform token` ya está hecho** (motor-plan T1.1, Etapa 1).
> **Especificación completa:** `pickpass-viabilidad.md` **B4**.

### 1.1 Registros back 🔵

> ⚠️ **Los 2 checks NO son 🔵** — ver motor-plan T1.2. El scope estándar no da
> acceso al historial guardado: `childrenForValidation_` (`24-crud:622`) sólo
> trae las hijas del payload y `ctx.current` (`23-validate:103`) es sólo
> columnas. O se pasa `currentChildren` a `checkCtx` (🟡, test primero), o el
> check lee la hoja por su cuenta con `storageMap_` + `readChildren_`
> (🔵, precedente: `not-in-sheet` ya lee hojas con `ctx.ss`).

- [x] **Decidir** el acceso al historial guardado (🟡 engine vs 🔵 self-read)
- [x] **Test primero** de `REGISTRY.transforms.token` en
      `api/__tests__/transforms.spec.js` ✅ Etapa 1
- [x] Registrar `REGISTRY.transforms.token` en `api/primitives/transforms.js`
      ✅ Etapa 1
- [x] **Test primero** de los checks en `api/__tests__/checks.spec.js`
      (fichero nuevo)
- [x] Registrar `REGISTRY.checks['history-append-only']` en `api/primitives/checks.js`
- [x] Registrar `REGISTRY.checks['no-auth-after-delivered']` en el mismo
- [x] Firma de check: `fn(scope) → [{ path, message }]` — **no lanza**
- [x] `npm run test:api` verde

### 1.2 Recurso back 🔵

- [x] Crear `api/schema/resources/orders.js`
- [x] `kind: 'collection'` · `sheet: 'orders'` · `keyField: 'ref'`
- [x] `immutableKey: true` · `activeField: null` · `dependents: []`
- [x] **`ordering: 'none'`** — sólo `'none' | 'positioned'` es válido
- [x] **`imageFolder: 'orders'`** — obligatorio: hay campos `image`
      (`upload-signature.js:26`)
- [x] `ref` **sin** `system: true` — `22-assemble.js:49` lo descartaría
- [x] `operations.create.computed` →
      `[{ field: 'ref', transform: 'token', from: 'customer_name' }]`
- [x] **`from` es obligatorio** (`24-crud.js:598`) — no usar `created_at`
      (`'now'` corre en storage, **después** de `preparePayload_`)
- [x] `policies.access = { read: 'admin', write: 'admin' }`
- [x] `checks` con `not-in-sheet` + los 2 nuevos
- [x] `history` como `type: 'list'` con `itemFields`

### 1.3 Schema front 🔵

- [x] Crear `src/app/schemas/orders.schema.ts`
- [x] Añadirlo a `src/app/schemas/registry.ts` (import + array)
- [x] **Espejar** los campos del back — `api:check` valida la paridad
- [x] `npm run api:check` verde

### 1.4 Verificación de fase

- [x] `npm run test:api`
- [x] `npm run api:check` (4 → 5 recursos)
- [x] `npm test`
- [x] `npx ng build`

---

# Fase 2 — Config `pickpass` 🔵

> **Resultado:** `public_base_url` y mensaje de compartir → habilita
> `copy-share`.
> **Motor:** 🔵 cero cambios. Repite el patrón de `site`
> (`kind: 'singleton'`, `listProjection: null` → form directo).

### 2.1 Recurso back

- [x] Crear `api/schema/resources/pickpass.js`
- [x] `kind: 'singleton'` · `sheet: 'pickpass_config'`
- [x] `kvColumns: ['key', 'value', 'type', 'note']`
- [x] `listProjection: null` · `imageFolder: null`
- [x] `policies.access = { read: 'admin', write: 'admin' }`
- [x] Campos: `public_base_url` (url) · `share_message_template` (textarea,
      con `{ref}`) · `pin_ttl_hours` (number) · `pin_enabled` (select)
- [x] **NO meter el rate-limit acá** — es `REGISTRY.endpoints.limits`

### 2.2 Schema front

- [x] Crear `src/app/schemas/pickpass.schema.ts`
- [x] Añadirlo a `src/app/schemas/registry.ts`
- [x] `npm run api:check` verde (paridad estricta, `contract-check.mjs:229`)

### 2.3 Verificación de fase

- [x] `npm run test:api` · `npm run api:check` · `npm test` · `npx ng build`

---

# Fase 3 — Dashboard 🟡

> **Resultado:** panel con métricas declaradas en el schema.
> **Motor:** M1 ya hecho en Etapa 1 (T2). M2 opcional.

### 3.1 Despacho por kind 🔵

- [x] `kind: 'dashboard'` ya ampliado en `schema.model.ts:339` (Etapa 1 T4)
- [x] Rama `@case ('dashboard')` ya en `resource-page.ts:26` (Etapa 1 T4)
- [x] `widget-host` ya creado (Etapa 1 T5)
- [x] Confirmar que **no** hay que crear ruta nueva —
      `shell.routes.ts` ya resuelve cualquier `:id`

### 3.2 Vistas de métricas 🔵

- [x] Declarar vistas en `api/schema/resources/orders.js` → `views`
- [x] Ej: `pendientes` con `where: [{ field: 'status', op: 'eq', value: 'PENDIENTE' }]`
- [x] Agregados (count/sum/avg): **`views.handler`** si no hay M2,
      **`aggregate:`** si sí
- [x] `npm run api:check` verde

### 3.3 Endpoint + handler 🔵

- [x] Declarar `REGISTRY.endpoints.dashboard` en `api/schema/endpoints/`
- [x] `route` · `method: 'GET'` · `access: 'admin'` · `limits` declarativo
- [x] Handler en `api/primitives/handlers/dashboard.js` (genérico declarativo)
- [x] Registrar en `REGISTRY.handlers`
- [x] Test del handler en `api/__tests__/`
- [x] `npm run test:api` verde

### 3.4 Widgets con datos sintéticos 🔵 (Etapa 1 T6/T7)

- [x] `metric-card` renderiza `{ label, value }` sin `orders`
- [x] `bar-chart` renderiza `data[]` con CSS, sin librería
- [x] `chart-line` detrás de `@defer` con `@placeholder` CSS
- [x] `copy-share` copia una URL de fixture al portapapeles
- [x] **Criterio de salida de la Etapa 1:** un schema sintético declara y
      dibuja **sin errores de render**, antes de que existan datos reales

### 3.5 Página + datos reales 🔵

- [x] Crear `src/app/pages/dashboard/dashboard.ts`
- [x] Iterar los `widgets` del schema → `widget-host`
- [x] Datos con `api.request('GET', schema.endpoint.get)` reactivo
- [ ] (opcional) redirect de landing en `app.routes.ts:10`
- [x] `copy-share` con el `public_base_url` real (fase 2)
- [x] `npm test` · `npx ng build` verdes — **el bundle inicial NO crece**

---

# Fase 4 — Endpoint público de solo lectura 🔵

> **Resultado:** enlace compartible para cliente y autorizado. **Sin PIN.**

- [x] Declarar `GET /p/orders/:ref` en `api/schema/endpoints/`
- [x] Handler de proyección en `api/primitives/handlers/` —
      **whitelist de campos**, nunca el schema completo
- [x] `limits` declarativo en la propia declaración del endpoint
- [x] `orders` **se queda** en `{ read: 'admin', write: 'admin' }` —
      la proyección la hace el handler, no una política más suelta
- [x] Test del handler: sólo campos públicos, `ref` inexistente ⇒ 404
- [x] `npm run test:api` · `npm run api:check` verdes

> **Patrón ya probado:** `handleSchema` (`handlers/schema.js`) y
> `hiddenList` (`handlers/hidden-list.js:18`).

---

# Fase 5 — PIN 🔴

> **Resultado:** escritura pública protegida. El mayor de todos — sólo se
> justifica si las fases anteriores confirman que el flujo funciona.

- [x] Hoja auxiliar `_pin` en `api/schema/05-aux-sheets.js` —
      `[ref, pin_hash, created_at, used_at]`
- [x] **El PIN nunca va en la hoja pública** — sólo `pin_hash`
- [x] Endpoint público de escritura en `api/schema/endpoints/`
- [x] Handler que verifica el PIN con **cifrado** — **nunca `==`** sobre texto plano
- [x] Rate-limit por pedido con `limits` declarativo
- [x] Test: PIN incorrecto ⇒ 401 · agotados los intentos ⇒ 429
- [x] `npm run test:api` · `npm run api:check` verdes

> **Precedente de hoja auxiliar:** `_audit_log`, `_placeholders`.

---

# Fase 6 — Eventos de uso 🔵 (M3 🟡 opcional)

> **Resultado:** trazabilidad de adopción. **No bloquea nada.**

- [x] Declarar `POST /admin/events` en `api/schema/endpoints/`
- [x] Handler que escribe en `_events`
- [x] Hoja auxiliar `_events` en `api/schema/05-aux-sheets.js`
- [x] `limits` declarativo (es una superficie de escritura)
- [x] Test del handler
- [ ] _(opcional)_ M3 `REGISTRY.hooks` en `engine/24-crud.js` —
      **test primero** (Etapa 1 T2c)
- [x] `npm run test:api` · `npm run api:check` verdes

> ⚠️ **Los eventos reportados por el cliente nunca son fuente de verdad de
> estado** (A4.13). Son señal de _uso_; el _estado_ lo da `_audit_log`.

---

# Orden y dependencias

```
Fase 1 (orders)  ──┬─────────────────────────────▶ Fase 3 (dashboard)
                   │                                      ▲
                   └──▶ Fase 2 (config) ──────────────────┤
                                                          │
Fase 1 ──▶ Fase 4 (lectura pública) ──▶ Fase 5 (PIN) ────┤
                                                          │
Fase 4 ──▶ Fase 6 (eventos)  [no bloquea nada] ───────────┘
```

| #   | Fase              | Depende de | Toca motor               |
| --- | ----------------- | ---------- | ------------------------ |
| 1   | Recurso `orders`  | —          | 🔵 **no**                |
| 2   | Config `pickpass` | —          | 🔵 **no**                |
| 3   | Dashboard         | 1, 2       | 🟡 M1 (ya en Etapa 1 T2) |
| 4   | Lectura pública   | 1, 2       | 🔵 **no**                |
| 5   | PIN               | 4          | 🔵 **no**                |
| 6   | Eventos           | 4          | 🔵 no (M3 opcional)      |

**Las fases 1 y 2 corren en paralelo** — ninguna toca el motor ni a la otra.

---

# Battería de verificación (al final de cada fase)

- [ ] `npm run test:api` — backend (`api/**/*.spec.js`)
- [ ] `npm run api:check` — nombres · registry ↔ ficheros · contract
- [ ] `npm test` — frontend
- [ ] `npx ng build`
- [ ] `npx prettier --check .`

> ⚠️ Antes de commit: `api/` tiene **11 ficheros** de prettier
> **preexistentes** e intocables (`api/fixtures/*.json` ×9, `api/PLAN.md`,
> `api/PLAN-MEJORAS.md`). `git diff HEAD` sobre ellos es vacío. No los
> arreglés en este trabajo.

---

# Fuera de este plan

- [ ] `.gitignore` + `.atl/` — decisión tuya, quedaron sin commitear
- [ ] Push — no pedido
- [ ] Frontend público — otro repositorio; de este lado sólo se sirven endpoints
- [ ] Typo `nonio` → `nono` en `src/app/shared/utils/slugify.ts` (pendiente menor)
