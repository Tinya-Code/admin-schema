# `api/` — Backend con Google Apps Script + Google Sheets

> Concepto **v2**: corrige la v1 según `doc/baseapi.md` (autoridad) y
> `doc/api.md` §3 (contrato de datos). **Sin código**: sólo carpetas,
> responsabilidades, endpoints y reglas.
>
> - Plan de ejecución: [`PLAN.md`](./PLAN.md) (12 fases con criterios).
> - Consumidor: admin Angular (`src/app/core/services/api.service.ts`).

---

## 1. Restricciones del entorno (definen la estructura)

- Apps Script V8: **scope global, sin `import`/`export` ni `require`**. Las
  carpetas son organización lógica; el **orden de carga lo garantiza
  `filePushOrder`** en `.clasp.json` (no el prefijo alfabético: clasp no lo
  respeta). Archivos con nombres únicos.
- Nada de `class`: servicios como **object literals**; handlers como funciones
  globales. Setup no expuesto como endpoint (se corre desde el editor).
- **Secretos/IDs sólo en Script Properties** (manifiesto de nombres en
  `00-config`; único acceso en `core/13-props`; verificación en
  `setup/00-check-properties`). `.clasp.json` y archivos con IDs no se
  commitean.
- **Transporte v2 (sin CORS):** todo `/admin/*` es **POST** con cuerpo
  `text/plain` (JSON `{ token, method, path, payload }`) — nunca
  `application/json` ni cabeceras custom (disparan _preflight_, que Apps Script
  no soporta). El token va en el **cuerpo**: `doGet/doPost` no exponen las
  cabeceras HTTP, así que `Authorization: Bearer` no sirve.
- Web App siempre responde **HTTP 200**: error dentro del JSON
  `{ "error": { "status": …, "message": …, "errors": [{ "path", "message" }] } }`
  con **todos** los errores de un 422; el front lo convierte en `ApiError`.
- El **backend es dueño de `position`**: el front manda _intención_ («mover X
  después de Y»), el backend calcula con paso 1000 dentro del lock.
- Escrituras con `LockService` + hijos en **lote**; lecturas por rango completo
  - caché **por recurso y troceada** (≈100 KB/valor, TTL corto, invalidar al
    escribir).
- Imágenes: **Cloudinary**, firma emitida por el backend
  (`/admin/upload-signature`); el navegador sube directo. No hay `/upload` ni
  Drive.

---

## 2. Estructura de carpetas (v2)

```
api/
├── README.md                  ← este documento (concepto v2)
├── PLAN.md                    ← plan de 12 fases con tareas/criterios
├── appsscript.json            ← manifiesto (V8, webapp)
├── .clasp.json                ← local, NO se commitea (scriptId + filePushOrder)
├── .claspignore               ← sólo empuja appsscript.json, *.js, *.html
│
├── 00-config                  ← constantes + MANIFIESTO de propiedades
│                                (sólo nombres, required/secret/source; jamás valores)
│
├── schema/                    ← 🧠 FUENTE ÚNICA (datos declarativos)
│   ├── 01-types               ← 21 tipos del catálogo (idénticos al front)
│   ├── 02-enums               ← availability, days, risk_class
│   ├── 03-resources-*         ← categories, products, site, legal (uno por archivo)
│   └── 04-registry            ← índice recurso → ruta /admin/{id}
│
├── setup/                     ← manual, idempotente, desde el editor
│   ├── 00-check-properties    ← verifica/genera propiedades según manifiesto
│   │                            (primero de todo; lista faltantes y se detiene)
│   ├── 01-setup-spreadsheet   ← crea libro o reutiliza (SPREADSHEET_ID)
│   ├── 02-setup-sheets        ← hojas + cabeceras + Texto plano + validaciones
│   │                            + protege fila 1 (todo desde schema/)
│   ├── 03-setup-drift         ← schema vs hojas: agrega columnas/hijas,
│   │                            reporta renombrados, bloquea cambios de tipo,
│   │                            actualiza SCHEMA_VERSION + _audit_log
│   └── 04-setup-seed          ← puebla _enums y _placeholders
│
├── core/                      ← marco común (no conoce hojas ni reglas)
│   ├── 10-router              ← doPost: cuerpo text/plain → {token, method,
│   │                            path, payload}; resuelve ruta + política,
│   │                            auth y rate-limit antes de delegar
│   ├── 11-auth                ← auth por POLÍTICA de ruta (access del
│   │                            schema): 'public' sin token; sin política
│   │                            ⇒ admin (fail-closed); hash en tiempo
│   │                            constante; token jamás en URL ni logs
│   ├── 12-http                ← envelope éxito/error (200 siempre, 422 en lote)
│   └── 13-props               ← ÚNICO acceso a PropertiesService; lee 1× por
│                                ejecución y cachea; falta → 500 «falta X»
│
├── engine/                    ← motor genérico parametrizado por schema/
│   ├── 20-storage-map         ← campo → columna (grupos con prefijo) / fila KV
│   │                            / hoja hija
│   ├── 21-repo                ← rangos completos; filas ↔ objetos por cabecera
│   ├── 22-assemble            ← objetos anidados; proyección de listado vs
│   │                            detalle completo; intérprete de `shape`
│   │                            (pick/include/nest/rename/envelope, F5)
│   ├── 23-validate            ← declarativos acumulando TODOS los errores con
│   │                            ruta + origen de imagen (https + cloud propio)
│   ├── 24-crud                 ← pipelines lectura/escritura completos (§8)
│   ├── 25-ordering            ← intención del front; paso 1000; rebalanceo en
│   │                            lock; hijos: verdad = orden del arreglo
│   ├── 26-lock-cache          ← LockService + caché troceada + invalidación
│   │                            + rate-limit genérico ('10/min' declarado)
│   └── 27-views               ← vistas declarativas where/sort/limit/extends
│                                + forma efectiva de respuesta (F5)
│
├── primitives/                 ← primitivas genéricas (cero dominio)
│   ├── ops                     ← operadores de consulta (eq/in/gt/contains/…)
│   ├── transforms              ← derivados parametrizados (slugify: lower/sep/keep)
│   ├── checks                  ← checks declarados (pattern/mod11/not-in-sheet)
│   └── handlers/               ← handlers no-CRUD (firma Cloudinary, /schema,
│                                 hidden-list: escape hatch §6 justificado)
│
├── schema/endpoints/           ← endpoints no-CRUD declarados (§9)
│                                 (route/method/handler → REGISTRY.endpoints)
│
├── 50-audit                   ← append a _audit_log (CRUD + reorder + cambios
│                                de SCHEMA_VERSION)
│
└── (futuro) 60-public         ← lecturas públicas GET ?path= sin token (R1–R6)
```

**Regla de oro:** recurso estándar nuevo = 1 archivo en `schema/` + 1 línea en
`04-registry` — **0 código nuevo**. Campo escalar nuevo = schema + correr setup.

---

## 3. Endpoints (contrato v2 que consume el front)

Transporte: **POST** `API_URL` con cuerpo `text/plain`;
`{ token, method, path, payload }` (`method` = `GET` también para lecturas).
Respuesta: JSON plano 200. Sólo la lectura pública futura usa `GET ?path=`.

| `method` (envelope) | `path`                    | `payload`                                                     | Hojas                                        | Notas                                                                                                                 |
| ------------------- | ------------------------- | ------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| GET                 | `/admin/categories`       | —                                                             | `categories`                                 | proyección de listado; orden por `position` (visible sólo para admin)                                                 |
| GET                 | `/admin/categories/{key}` | —                                                             | `categories`                                 | detalle completo                                                                                                      |
| POST                | `/admin/categories`       | payload                                                       | `categories`                                 | posición final (última + paso)                                                                                        |
| PUT                 | `/admin/categories/{key}` | payload; en reorder: `{ intent }` («después de Y» / «inicio») | `categories`                                 | `LockService`; rebalanceo en lote                                                                                     |
| DELETE              | `/admin/categories/{key}` | —                                                             | `categories`                                 | con productos → 409 con motivo                                                                                        |
| GET                 | `/admin/products`         | —                                                             | `products` + hijas                           | **`{ items, total }`** (shape F5: pick de 10 campos + `brand`)                                                        |
| GET                 | `/admin/products/{key}`   | —                                                             | `products` + `product_images/specs/faq`      | detalle completo                                                                                                      |
| POST                | `/admin/products`         | payload                                                       | `products` + hijas                           | FK `category_slug` sólo activas                                                                                       |
| PUT                 | `/admin/products/{key}`   | payload                                                       | `products` + hijas                           | hijos en **lote** (reemplazo completo, dentro del lock)                                                               |
| DELETE              | `/admin/products/{key}`   | —                                                             | `products` + hijas                           | borra hijas asociadas                                                                                                 |
| GET                 | `/admin/site`             | —                                                             | `site_config` + `site_hours` + `site_social` | KV → objeto anidado                                                                                                   |
| PUT                 | `/admin/site`             | objeto anidado                                                | ídem                                         | objeto → filas KV; `checks: not-in-sheet`                                                                             |
| GET                 | `/admin/legal`            | —                                                             | `legal_config`                               | KV → objeto                                                                                                           |
| PUT                 | `/admin/legal`            | objeto                                                        | `legal_config`                               | `checks: not-in-sheet` + anti-uniformes; `last_updated` computado                                                     |
| POST                | `/admin/upload-signature` | `{ resource }`                                                | —                                            | fija carpeta/formatos y firma; **nunca** `api_secret`; `limits: '10/min'`                                             |
| GET                 | `/admin/schema`           | —                                                             | —                                            | proyección pública por recurso: `model` + `operations` (rutas efectivas + `shape`) + `views` + `policies.access` (F7) |

**Forma de respuesta (§7):** cada recurso puede declarar
`operations.<op>.shape` / `views.<n>.shape` (`pick`/`include`/`nest`/
`rename`/`envelope`) y el intérprete de `22-assemble` aplica la forma
**antes** del envelope de `12-http`. Cambiar la salida de un endpoint =
editar sólo `schema/resources/<id>.js`; sin declaración la salida es la
previa (fallback `listProjection` — **no se retiró en F7**: ver decisión
F7-3 en `PLAN-MEJORAS.md`; se retira en F7/P cuando todos declaren su
`shape`). Hoy sólo `products` la declara: su listado responde
`{ items, total }` con pick de 10 campos.

**Front sin conocimiento de recursos (F7):** desde F7 el admin no necesita
schemas locales para recursos nuevos — `/admin/schema` expone por recurso
`operations` (métodos, rutas y forma pública de la respuesta), `views`
(metadatos declarativos; vistas con `handler` ⇒ `{custom:true}`) y
`policies.access`; el front los fusiona por `key` sobre la presentación
local y sintetiza menú/listado/formulario de los ids que sólo existen en el
backend (evidencia F7-4: recurso `_prueba` con 0 cambios en `src/`). Sin
fugas: caché/audit/lock/rate-limit y internals jamás viajan (§12).

**Políticas (§8):** `access`/`limits`/`cache`/`audit`/`lock` viven en el
schema — `resource.policies.*` (los 4 recursos) y `access`/`limits` de
cada endpoint. El router resuelve la política de la ruta y aplica: auth
(`public` sin token; sin declaración ⇒ admin) y rate-limit genérico
(`'<n>/min'` → 429 en la 11ª llamada). Cambiar permisos o límites =
editar sólo el schema; `core/` y `engine/` no tienen rutas ni números.

**Subida de imágenes (dos pasos, sin `/upload`):** 1) el front pide firma a
`/admin/upload-signature`; 2) sube **directo a Cloudinary** con esa firma y
guarda `secure_url` en `image_url` (validado: `https` + prefijo del
`CLOUDINARY_CLOUD_NAME`). Miniaturas por transformación de URL (se guarda la
URL original).

---

## 4. `setup/` — creación y evolución del libro

1. **`00-check-properties`** (primero): manifiesto → verifica `manual` (lista
   cuáles faltan y se detiene) → genera `generated` idempotentes
   (`SPREADSHEET_ID`, `ADMIN_TOKEN_HASH`, `SCHEMA_VERSION`) → resumen sin
   secretos. Re-correrlo nunca regenera el token.
2. **`01-setup-spreadsheet`** crea o reutiliza el libro.
3. **`02-setup-sheets`** itera `schema/04-registry` → hojas, cabeceras,
   Formato Texto plano en columnas sensibles, validaciones (enums, casillas),
   protección de fila 1.
4. **`03-setup-drift`** evoluciona el schema: agrega columnas/hojas sin tocar
   datos, reporta renombrados (huérfana + nueva), bloquea cambios de tipo con
   datos incompatibles, registra `SCHEMA_VERSION` + `_audit_log`.
5. **`04-setup-seed`** puebla `_enums` y `_placeholders`.

Reglas: en ese orden · idempotente · **cero** columnas hardcodeadas (todo sale
de `schema/`) · manual desde el editor.

---

## 5. Modularidad y SOLID dentro del entorno GAS

| Principio | Cómo se cumple                                                                                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SRP**   | Cada carpeta un motivo de cambio: `schema/` declara; `setup/` materializa; `core/` no conoce hojas; `engine/` no conoce reglas de negocio; `rules/` es puro; `routes/` sólo lo singular |
| **OCP**   | Recurso nuevo = 1 definición + 1 registro; campo nuevo = schema + setup. Sin tocar `engine/` ni `core/`                                                                                 |
| **LSP**   | Repos de colección y singleton exponen el mismo contrato get/list/save intercambiable                                                                                                   |
| **ISP**   | Cada módulo recibe sólo lo que usa: validadores ven objetos armados, no hojas ni requests                                                                                               |
| **DIP**   | `engine/` y `rules/` dependen del registry (datos), no de `SpreadsheetApp`; el router depende de la tabla de rutas                                                                      |
| **DRY**   | Cabeceras y tipos sólo en `schema/`; envelope y errores sólo en `12-http`; propiedades sólo en `13-props`; lock/caché sólo en `26-lock-cache`                                           |

---

## 6. Orden de implementación

Definido y verificado en [`PLAN.md`](./PLAN.md) (Fases 0–11, con criterios de
salida y los 12 criterios de aceptación de `baseapi.md` §17.2). Este README es
la referencia conceptual; **no dupliques estados aquí**.
