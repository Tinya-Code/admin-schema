# Plan 2 — Refactor del motor hacia un sistema 100 % guiado por schemas

> **Objetivo:** una pantalla, un campo, un endpoint, un CRUD, una acción o un
> cálculo se crean **declarándolos**, no escribiendo vistas ni handlers
> sueltos. **Sólo se tocan schemas.**
>
> **Fuentes:** `doc/refactormotor.md` (mejoras F1–F10 / B1–B14) y
> `doc/auth.md` (autenticación, audiencias, overrides).
> **Absorbe** `doc/plan-motor-de-renderizado.md` (31 tareas) — ver mapa §3.
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

- [ ] **R0.1** — Confirmar `doc/plan-limpieza.md` cerrado
  - **Hecho cuando:** Fases 1–6 del plan de limpieza marcadas y gates verdes.

- [ ] **R0.2** — Baseline de gates con cifras
  - **Pasos:** ejecutar los 5 gates; anotar en §7.
  - **Hecho cuando:** §7 tiene los 5 resultados con fecha.

- [ ] **R0.3** — Resolver `refactormotor.md` §9 (6 decisiones)
  - **(1)** autodescubrimiento vs registro manual de una línea
  - **(2)** `snake_case` vs `kebab-case` para ids de recurso
  - **(3)** codegen DATA→front → **ya resuelto por O1**: _no aplica_; queda
    «dos schemas independientes + contrato por consumidor»
  - **(4)** qué parte del lenguaje de condiciones se comparte literalmente
  - **(5)** hasta dónde llegan los `aggregates` en Sheets
  - **(6)** política de deprecación (cuántas versiones)
  - **Hecho cuando:** las 6 están en §6.

- [ ] **R0.4** — Resolver `auth.md` §9 (7 decisiones)
  - **(1)** proveedor A (Google) / B (contraseña) / ambos
  - **(2)** duración de sesión (propuesta 6 h + renovación deslizante)
  - **(3)** «recordarme» en `localStorage`
  - **(4)** cuántos roles
  - **(5)** formato de respuesta existente (para no romperlo)
  - **(6)** ¿habrá cuentas de cliente (audiencia `customer`)?
  - **(7)** ¿se acepta logout «best-effort»?
  - **Hecho cuando:** las 7 están en §6.

- [ ] **R0.5** — Cerrar D8: absorción del plan anterior
  - **Pasos:** confirmar que `doc/plan-motor-de-renderizado.md` queda
    **histórico** tras esta absorción (mapa en §3) y añadirle cabecera.
  - **Hecho cuando:** no hay dos planes paralelos compitiendo.

- [ ] **R0.6** — Fijar nomenclatura vigente
  - **Pasos:** confirmar §5 con las tablas de `refactormotor.md` §2
    (identificadores, sufijos, archivos, funciones).
  - **Hecho cuando:** quien escriba código tiene una referencia única.

- [ ] **R0.7** — Documentar los gates y el flujo de trabajo
  - **Archivo:** `README.md`
  - **Pasos:** tabla de comandos + aviso del `2>&1` de prettier.
    _(Absorbe T6.3.)_
  - **Hecho cuando:** un agente nuevo sabe qué correr sin preguntar.

- [ ] **R0.8** — Inventario de consumo de endpoints
  - **Pasos:** evidencia archivo:línea para los 6 endpoints
    (`schema`, `uploadSignature`, `dashboard`, `events`, `publicOrder`,
    `pinVerify`). _(Absorbe T2.1.)_
  - **Hecho cuando:** los tres dudosos (`events`, `publicOrder`, `pinVerify`)
    tienen veredicto fundado.

---

## Fase 1 — Red de seguridad

> **Es la primera por un motivo:** es lo que hace que todo lo demás sea
> reversible. Impacto muy alto, esfuerzo bajo-medio, riesgo bajo
> (`refactormotor.md` §8).

**Precondición:** Fase 0.

### 1.1 Fail-loud en la escritura (B4 — cierra R1/R2)

- [ ] **R1.1** — `rowValues_` no puede descartar en silencio
  - **Archivo:** `api/engine/24-crud.js` (y/o `21-repo.js`)
  - **Pasos:** si el payload trae una clave que `storageMap` espera y la hoja
    **no** tiene la columna → **error explícito** (422/500), no descarte.
  - **Verificación:** test que mande un campo sin columna y falle ruidoso.
  - **Hecho cuando:** imposible que un campo vuelva vacío por esta vía.

- [ ] **R1.2** — `sheet-check` (drift schema ↔ hoja)
  - **Archivo nuevo:** `scripts/sheet-drift-check.mjs`
  - **Pasos:**
    1. Comparar `storageMap_` de cada recurso con los headers reales.
    2. Reportar **faltantes y sobrantes**.
    3. ⚠️ **O3**: corre en Node/despliegue, **no** en cada ejecución de GAS.
    4. `clasp pull` a **directorio temporal** — `clasp pull --rootDir` no
       existe en clasp 3.4.1 y pisaría cambios.
  - **Verificación:** detecta un campo ficticio añadido a un recurso.
  - **Hecho cuando:** habría fallado antes de R1.

- [ ] **R1.3** — Respuesta desde lo escrito, no desde la relectura
  - **Archivo:** `api/engine/24-crud.js` (`shapeResponse_` + `readDetail_`)
  - **Pasos:** construir la respuesta de `create/update` desde **lo escrito +
    computed**, y releer sólo para confirmar.
  - **Verificación:** test R6.2 (abajo) en verde.
  - **Hecho cuando:** un campo computado jamás vuelve vacío por fallo de
    lectura.

- [ ] **R1.4** — `ensureColumns_` bajo flag explícito (opcional)
  - **Pasos:** crea columnas faltantes **nunca por defecto**; sólo con flag
    explícito. Si no, se omite y se documenta por qué.
  - **Hecho cuando:** decidido y registrado.

### 1.2 Meta-schema (B12)

- [ ] **R1.5** — `validateRegistry_()` al cargar
  - **Archivo nuevo:** `api/schema/validate-registry.js`
  - **Checks:**
    1. claves desconocidas en un recurso → **error** (detecta typos)
    2. referencias rotas: `titleField`, `listProjection`, `dependents`,
       `relation`
    3. tipos/validadores/computed/hooks inexistentes
    4. `listProjection` ⊇ lo que `listColumns` del front necesita (cierra R6)
  - **Verificación:** un typo de clave en un resource rompe `api:check`.
  - **Hecho cuando:** los 4 checks corren.

- [ ] **R1.6** — `contract-check` ampliado _(absorbe T2.4)_
  - **Archivo:** `scripts/contract-check.mjs`
  - **Comparar además de `kind`/`endpoint`/`required`/`validators`:**
    1. `enum` (back) ↔ `options[].value` (front)
    2. `default` ↔ `default`
    3. `listProjection` (back) ⊇ `listColumns` (front)
    4. `postCreate.summaryFields` y `detail.headerFields` ⊆ campos declarados
  - **Verificación:** `npm run api:check` en verde con los 7 recursos.
  - **Hecho cuando:** si alguna diverge, se **documenta** en §6, no se parchea.

- [ ] **R1.7** — Test de contrato del front (F9)
  - **Archivo nuevo:** `src/app/core/registry/contract.spec.ts`
  - **Pasos:** recorrer `registry.ts` entero y verificar que cada
    `type`/`format`/`action` existe en su registro, que cada `*Field` apunta a
    un campo real y que cada `config` valida contra su `configSchema`.
  - **Hecho cuando:** un `type` inventado en cualquier schema **falla el
    test**.

### 1.3 Pruebas de regresión de los hallazgos

- [ ] **R1.8** — Test e2e del mensaje compartido _(absorbe T6.1, cierra R4)_
  - **Archivo:** `src/app/schemas/orders.schema.spec.ts` (o spec nuevo)
  - **Pasos:** partir de la **respuesta del back simulada** (con `pin`
    presente) y afirmar que el texto copiado termina con el PIN.
    **No** inyectar el PIN en la plantilla.
  - **Hecho cuando:** si el back deja de enviar `pin`, este test falla.

- [ ] **R1.9** — Test back: `create` → respuesta con `pin` _(absorbe T6.2, cierra R1)_
  - **Archivo:** `api/__tests__/pin-generate.spec.js`
  - **Pasos:** además del transform y del hook, afirmar que la **respuesta**
    incluye `pin` no vacío.
  - **Hecho cuando:** R1 cubierto por test, no por inspección.

- [ ] **R1.10** — Degradación controlada de tipo desconocido (F9)
  - **Front:** en dev, componente `UnknownRender` con aviso visible; en prod,
    se omite y se loguea. **Nunca pantalla rota.**
  - **Hecho cuando:** hay test para tipo desconocido.

- [ ] **R1.11** — Gates de la fase
  - **Comandos:** 5 gates + `sheet-check`.
  - **Hecho cuando:** todo verde.

---

## Fase 2 — Autenticación

> `auth.md` §7 fases 1–3. **Por qué aquí:** sin roles no hay sentido para las
> políticas finas (F7) ni para `access: session`.

**Precondición:** Fase 1 (puede correr en paralelo — no comparte ficheros).

### 2.1 Núcleo (auth §7.1)

- [ ] **R2.1** — Hoja `_users`
  - **Columnas:** `id`, `email` (único), `name`, `role`, `active`,
    `token_version`, `pass_hash`, `pass_salt` (sólo opción B),
    `last_login_at`, `created_at`.
  - ⚠️ **Nunca expuesta** ni en admin ni en público.

- [ ] **R2.2** — `setupAuth_()` y `bootstrapAdmin_()`
  - **Pasos:** funciones **sólo ejecutables desde el editor de Apps Script**:
    generan `AUTH_SECRET` (+ `GOOGLE_CLIENT_ID`) en Script Properties y la
    fila inicial de admin.
  - ⚠️ **Nunca por endpoint.**

- [ ] **R2.3** — `issueToken_` / `verifyToken_`
  - **Formato:** `base64url(payload) + '.' + base64url(HMAC-SHA256(AUTH_SECRET, …))`
  - **Payload:** `sub, sid, v, iat, exp, aud`.
  - **Requisitos:** HMAC con `Utilities.computeHmacSha256Signature` ·
    comparación en **tiempo constante** (no `===`) · `aud: 'admin'` ·
    TTL ≤ 6 h · **renovación deslizante** (< 25 % de vida ⇒ `meta.renewedToken`).
  - **Rol no viaja en el token** — se lee del snapshot.

- [ ] **R2.4** — Niveles de `access` en `11-auth` (aditivo)
  - **Valores:** `public` · `session` · `role:staff` · `role:admin` (alias
    `admin`) · **sin declarar ⇒ `role:admin`** (fail-closed).
  - **Hecho cuando:** los niveles actuales siguen valiendo.

- [ ] **R2.5** — Handlers `/auth/login`, `/auth/me`, `/auth/logout`
  - **Declarativos** (B2): `input`/`access`/`limits` en `REGISTRY.endpoints`.
  - **Sobre de respuesta:** conservar el formato existente y **añadir**
    códigos `AUTH_REQUIRED`, `AUTH_INVALID`, `AUTH_EXPIRED`, `FORBIDDEN`,
    `RATE_LIMITED`.

- [ ] **R2.6** — Cadena de verificación por request (auth §3.4)
  - **Pasos, en orden:** firma HMAC → `exp` + `aud` → `sid` no revocado →
    snapshot (`active`, `v == token_version`) → resolver `access` → ejecutar
    → renovación si la vida es corta.
  - **Hecho cuando:** coste típico 0 lecturas de hoja por request.

### 2.2 Front (auth §7.2)

- [ ] **R2.7** — `AuthService` (signals)
  - **Estado:** `user`, `token`, `isAuthenticated`, `login()`, `logout()`,
    `applyRenewedToken()`.

- [ ] **R2.8** — Interceptor de transporte
  - **Pasos:** envolver cada petición en
    `{ route, op, token, payload }` con `Content-Type: text/plain` y **sin
    cabeceras personalizadas** (evita preflight CORS); leer
    `meta.renewedToken`.
  - ⚠️ **Todo autenticado por POST** — nada de tokens en URL/GET.

- [ ] **R2.9** — Manejo centralizado de `AUTH_*`
  - **Archivo:** interceptor/manejador de errores — **un solo lugar** interpreta
    la tabla de códigos (login / limpiar sesión / «sin permiso» sin cerrar
    sesión / espera).

- [ ] **R2.10** — Guards
  - **`authGuard`, `roleGuard`** sobre las rutas generadas desde
    `registry.ts` (`shell.routes.ts`).
  - Menú filtrado por rol (**sólo UX** — la seguridad real es del back).

- [ ] **R2.11** — Pantalla de login declarada (`authSchema`)
  - **Pieza nueva** en el schema del front: `providers`, `loginFields`,
    `redirectAfterLogin`, `rememberMe`.
  - **Requisito (F1):** `contract-check` verifica que las claves de
    `loginFields` existan en el `input` de `/auth/login`.

- [ ] **R2.12** — Almacenamiento del token
  - **Default:** `sessionStorage` (muere con la pestaña). Con «recordarme»:
    `localStorage` — **sólo si D10-3 lo aprueba**.
  - Nunca en la URL ni en `GET`.
  - Al recibir `AUTH_INVALID`/`AUTH_EXPIRED`: borrar token **y** usuario antes
    de redirigir.

### 2.3 Robustez (auth §7.3)

- [ ] **R2.13** — Rate-limit del login
  - **Declarado** en `limits` del endpoint, **ejecutado** por `26-lock-cache`.
  - Por **cuenta + global** (no por IP — Apps Script no da IP), bajo
    `LockService` (el incremento no es atómico).
  - Mensaje de fallo **siempre genérico**; igual de rápido exista o no el email.

- [ ] **R2.14** — Auditoría de auth
  - **En `_audit`:** `login_ok`, `login_fail`, `logout`, `forbidden`.
    **Nunca** tokens ni contraseñas.

- [ ] **R2.15** — Snapshot cacheado + `token_version`
  - **TTL 60 s** con `CacheService` → hoja `_users` si falta.
  - Subir `token_version` invalida **todas** las sesiones del usuario
    (firme, efectiva en ≤ 60 s).

- [ ] **R2.16** — `/auth/logout` con revocación
  - `sid` a la lista de revocados en cache (TTL 6 h) — **best-effort**,
    documentado como tal (D10-7).

- [ ] **R2.17** — Pruebas mínimas (auth §8)
  - Cada caso de la lista de §8 tiene su test: sin token → `AUTH_REQUIRED`;
    token alterado → `AUTH_INVALID`; vencido → `AUTH_EXPIRED`; `aud` distinto
    → rechazado; `active=false` → ≤ 60 s; subir `token_version` → cae todo;
    `staff` en `role:admin` → `FORBIDDEN` sin cerrar sesión; logout → `sid`
    rechazado; 6.º fallo → `RATE_LIMITED`; `/public/*` sin campos internos;
    ninguna respuesta con `pass_hash`/`pass_salt`/`token_version`.

- [ ] **R2.18** — Gates de la fase

---

## Fase 3 — Registros

> Corazón del plan. **Impacto muy alto.** Absorbe T1.1, T1.2, T1.3.

**Precondición:** Fases 0 y 1.

### 3.1 Registro único de render (F1)

- [ ] **R3.1** — Definir `RenderDescriptor`
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
      configSchema?: MetaSchema;
    }
    ```
  - **Hecho cuando:** el tipo compila y tiene test unitario.

- [ ] **R3.2** — Funciones de registro y consulta
  - **Según D9-1:** `provideRenderDescriptors(...)` con autodescubrimiento
    (`import.meta.glob`) **o** registro manual de una línea.
  - **API:** `register(kind, descriptor)` · `get(kind, type)` ·
    `isSupported(kind, type)` · `resolve(kind, type, fallback)`.
  - **Hecho cuando:** `isSupported` reemplaza a `isSupportedFieldType` sin
    romper a sus 4 consumidores.

- [ ] **R3.3** — Descriptores de los 20 tipos de campo
  - **Archivo nuevo por tipo:** `src/app/fields/<type>/<type>.descriptor.ts`
  - **Pasos:** uno por cada uno de los 20; cada uno declara `kind: 'field'`,
    `load`, `surfaces`.
  - **Verificación:** `npm test` — los 20 resuelven.
  - **Hecho cuando:** no queda ningún `Set` de tipos.

- [ ] **R3.4** — `<app-render-host>` genérico
  - **Archivo nuevo:** `src/app/core/registry/render-host.ts`
  - **Pasos:**
    1. Basado en `NgComponentOutlet`, con `[kind] [type] [config] [ctx]`.
    2. El contexto (`pathPrefix`, errores, `FIELD_ARIA`) sigue entrando **por
       DI** mediante un `RenderContext` tipado.
    3. Conservar el envoltorio: `<label>`, marca required/opcional,
       `data-field`, `colSpanClass`.
    4. Conservar el fallback `Skeleton`.
  - **Hecho cuando:** renderiza los 20 tipos.

- [ ] **R3.5** — Migrar `FieldHost` al registro
  - **Archivo:** `src/app/fields/field-host/field-host.ts` (431 líneas)
  - **Pasos:** eliminar `SUPPORTED_FIELD_TYPES` y los 21 imports a mano; el
    `@switch` pasa a resolverse desde el registro.
  - **Restricción:** conservar el **auto-import recursivo** (`group`/`list` vía
    `ngTemplateOutlet`) y `ListChildContext`.
  - **Verificación:** `npm test` · `npm run build` · sin pantalla rota en los
    7 schemas.

- [ ] **R3.6** — Migrar `WidgetHost` al registro
  - **Archivo:** `src/app/widgets/widget-host/widget-host.ts`
  - **Pasos:** eliminar `SUPPORTED_WIDGET_TYPES` y los 6 imports; añadir los
    6 descriptores `kind: 'widget'`.
  - **Verificación:** los 4 widgets del dashboard renderizan.

- [ ] **R3.7** — Test de exhaustividad _(absorbe T1.3)_
  - **Archivo:** `src/app/core/registry/contract.spec.ts`
  - **Pasos:** recorrer los schemas y afirmar que **cada** `field.type`,
    `column.format`, `widget.type` y `action.type` usado tiene descriptor.
  - **Hecho cuando:** añadir `type: 'foo'` a cualquier schema **falla el
    test**.

- [ ] **R3.8** — Verificación: «añadir un tipo no toca el motor»
  - **Pasos:** crear un tipo de prueba (`field-tmp`) y comprobar que **sólo**
    hay que crear carpeta + descriptor, sin editar hosts.
  - **Hecho cuando:** el tipo de prueba se elimina y el criterio §0 pasa.

### 3.2 Registro de acciones (F2 — absorbe T1.1)

- [ ] **R3.9** — `ActionDescriptor` y `ActionService`
  - **Archivos nuevos:** `src/app/actions/action-registry.ts`,
    `src/app/actions/action-service.ts`
  - **Contrato:**
    ```ts
    interface ActionDescriptor {
      type: string;
      surfaces: ('row' | 'detail' | 'header' | 'bulk' | 'post-create')[];
      run: (ctx: ActionContext, action: ResourceAction) => Promise<ActionResult>;
      confirm?: boolean; // usa confirm-dialog
    }
    interface ActionContext {
      record;
      resource;
      api;
      router;
      toast;
      user;
    }
    ```

- [ ] **R3.10** — Descriptores de las 3 acciones existentes
  - `copy-share` · `navigate` · `trigger`.
  - `copy-share` se implementa **una sola vez** (hoy: 3).

- [ ] **R3.11** — Migrar las vistas al `ActionService`
  - **Archivos:** `list-view.ts:714`, `detail-view.ts:408`,
    `post-create-modal.ts`
  - **Pasos:** reemplazar los `if (action.type === …)` por
    `actionService.run(action, ctx)`.
  - **Verificación:** `grep -rn "action.type ===" src/app --include='*.ts'` → 0
    fuera de los descriptores.

- [ ] **R3.12** — `trigger` → acción de backend declarada (B3)
  - **Pasos:** `action.type: 'trigger'` invoca
    `POST /admin/<recurso>/:id/actions/<name>` — **rutas lógicas** (O2).

### 3.3 Capacidades del back (B1)

- [ ] **R3.13** — Unificar `REGISTRY.capabilities`
  - **Archivo nuevo:** `api/capabilities/` con `fieldTypes/`, `validators/`,
    `checks/`, `computed/`, `hooks/`, `operators/`, `handlers/`, `adapters/`.
  - **Contrato uniforme:** `{ id, since, argsSchema, run }`.
  - **Puerta de entrada única:** `registerCapability(category, descriptor)`.

- [ ] **R3.14** — Migrar las capacidades existentes
  - `FIELD_TYPES` (20) · `checks` · `hooks` · `computed` (`token`, `pin`,
    `now`) · `handlers` · `operators`.
  - **Verificación:** `npm run test:api` — 144+ en verde.

- [ ] **R3.15** — Validación de referencias al cargar
  - **Pasos:** cada `computed: 'token'`, `check: 'not-in-sheet'`… debe
    existir, y sus `args` cumplir `argsSchema`.
  - **Hecho cuando:** una referencia rota rompe el arranque/CI (R1.5).

- [ ] **R3.16** — Gates de la fase

---

## Fase 4 — Unificación de ramas

> F3 + column-format + F7/B11. **Absorbe T1.5.**

**Precondición:** Fase 3.

- [ ] **R4.1** — Modo `display` en el registro (F3)
  - **Pasos:** cada descriptor de campo declara si sabe pintarse en `display`;
    si no, `display` por defecto según tipo.
  - **Hecho cuando:** hay descriptor para los 20.

- [ ] **R4.2** — Migrar `detail-view` al host genérico
  - **Archivo:** `src/app/pages/detail-view/detail-view.ts`
  - **Pasos:**
    1. Dejar de derivar `kind` a mano (`image|badge|text`).
    2. Usar `<app-render-host mode="display">`.
    3. Conservar `sections()` y `resolveFieldValue()` (agrupación).
  - **Verificación:** los 7 detalles renderizan igual (capturas antes/después).
  - **Hecho cuando:** `detail-view` no tiene plantilla propia de campo.

- [ ] **R4.3** — `column.format` como registro (`kind: 'column-format'`)
  - **Archivo:** `src/app/pages/list-view/list-view.ts:259`
  - **Pasos:** eliminar el `@switch` de 7 formatos; añadir los 7 descriptores.
  - **Hecho cuando:** añadir un formato no toca `list-view`.

- [ ] **R4.4** — Tabla de formato por defecto según `field.type`
  - **Pasos:** declarada, no implícita; `column.format` sólo para
    sobreescribirla.
  - **Hecho cuando:** un campo sin `format` renderiza predeciblemente.

- [ ] **R4.5** — Auditoría de componentes compartidos (absorbe T1.5)
  - **Pasos:** los 10 de `shared/components/` — grep de
    `orders|pickpass|dashboard` dentro de cada uno.
  - **Verificación:** 0 referencias (los `*.spec.ts` de integración sí
    valen).
  - **Hecho cuando:** los 10 pasan o las excepciones están en §6.

- [ ] **R4.6** — Validadores extensibles y compartidos (F7 + B11)
  - **Front:** registro de validadores con **los mismos nombres que el back**;
    `buildFormSchema` los resuelve del registro en vez de un `if` por regla.
  - **Back:** mensajes con **código estable** (`VALIDATION_REQUIRED`,
    `VALIDATION_UNIQUE`) además del texto.
  - ⚠️ **Conservar la forma exacta de `serverErrors[prefix+key]`** — es lo que
    `FieldHost` mapea.
  - **Hecho cuando:** añadir un validador = 1 entrada en cada lado.

- [ ] **R4.7** — Gates de la fase

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
- [ ] **R10.9** — Archivar `doc/plan-motor-de-renderizado.md` (D8) y este
      documento al cerrarse

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

| ID      | Decisión                                         | Bloquea | Estado  |
| ------- | ------------------------------------------------ | ------- | ------- |
| **D9**  | `refactormotor` §9 — 6 decisiones                | R0.3    | abierta |
| **D10** | `auth` §9 — 7 decisiones                         | R0.4    | abierta |
| **D8**  | Absorber `plan-motor-de-renderizado.md`          | R0.5    | abierta |
| **D11** | ¿`pin` en `postCreate.summaryFields`? (R9)       | R8.1    | abierta |
| **D12** | ¿Implementar TTL/`pin_enabled` o retirar campos? | R8.2    | abierta |
| **D13** | ¿Usar `bar-chart`/`chart-line` o retirarlos?     | R8.3    | abierta |
| **D14** | R10: recrear pedidos o regenerar PIN             | R8.8    | abierta |
| **D15** | `confirm-dialog`: usar o retirar                 | R10.1   | abierta |
| **D16** | `POST /admin/events`: retirar o justificar       | R10.2   | abierta |

---

## §5. Nomenclatura vigente

> **Dos fuentes.** `refactormotor.md` §2 (general) + **`auth.md` §6, que
> añade el dominio de autenticación** — ver O9: se suman, no se pisan.

### 5.1 General (`refactormotor.md` §2)

### Identificadores

| Elemento                        | Convención                                          |
| ------------------------------- | --------------------------------------------------- |
| Valor de `type`/`format`/`kind` | `kebab-case`, singular: `string-list`, `copy-share` |
| Claves de schema                | `camelCase`: `listProjection`, `visibleWhen`        |
| Id de recurso                   | **D9-2** (`snake_case` o `kebab-case`), plural      |
| Hojas / columnas                | `snake_case`: `customer_name`                       |
| Columnas de grupo               | `<grupo>_<campo>`: `address_street`                 |
| Hojas hijas                     | `<recurso>_<campo>`: `orders_items`                 |
| Namespaces custom               | prefijo `x-`                                        |

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

> ⚠️ **Colisión pendiente D9-2:** `refactormotor` §2.1 deja el id de recurso
> sin elegir (`snake_case` **o** `kebab-case`). El ejemplo de `auth.md` §4.2
> usa `users` (singular, que no es ni uno ni otro) — hay que fijarlo en el
> meta-schema y aplicarlo **también** a `_users`/`users`.

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

**Regla final:** si añadir X obliga a editar `engine/`, `FieldHost`,
`WidgetHost` o una vista existente, **el motor todavía no está terminado**.

---

## §7. Baseline

_Cargar en R0.2._

| Gate                                | Resultado                            | Fecha                          |
| ----------------------------------- | ------------------------------------ | ------------------------------ |
| `npm test`                          | ✅ **147/147** (29 ficheros)         | 2026-10-06                     |
| `npm run test:api`                  | ✅ **144/144** (15 ficheros)         | 2026-10-06                     |
| `npm run api:check`                 | ✅ **VERDE** — 7 recursos, 84 campos | 2026-10-06                     |
| `npm run build`                     | ✅ verde (2.1 s)                     | 2026-10-06                     |
| `npx prettier --check . 2>&1`       | ⚠️ **18**                            | → 16 tras `plan-limpieza` L4.5 |
| Tareas absorbidas del plan anterior | 24                                   | 2026-10-06                     |
| Decisiones a cerrar en Fase 0       | 13 (6 + 7)                           | 2026-10-06                     |
| Overrides de `auth.md`              | 6 (O1–O6)                            | 2026-10-06                     |
