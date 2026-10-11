# API — contrato de endpoints (OpenAPI-lite)

> **Documento generado** por `scripts/api-doc.mjs` a partir de
> `api/schema/endpoints/*.js`. No editar a mano: `npm run api:doc` lo
> regenera y `npm run api:check` lo marca ROJO si no coincide con el
> registro.

## Envelope (contrato para el front)

Apps Script no expone cabeceras: todo viaja en el cuerpo de un `POST`
(`Content-Type: text/plain`, sin preflight — ver `doc/baseapi.md` §2).
El `token` va en el envelope para rutas protegidas y se omite en rutas `public`; no se envía en una cabecera ni en la URL. `path` es la ruta lógica, no la URL del web app. Las query strings se descartan: envía filtros en `payload`.

```json
{ "token": "<token de sesión>", "method": "GET", "path": "/admin/orders", "payload": {} }
```

La respuesta exitosa es el JSON plano del handler (no se envuelve en `data`). Para errores, inspecciona `body.error` aunque `response.status` sea 200; usa `error.status` como estado funcional y, si existe, `error.code` para distinguir el caso. En validación, procesa todos los elementos de `error.errors` usando su `path`.

```json
{
  "error": {
    "status": 422,
    "message": "Errores de validación",
    "errors": [{ "path": "pin", "message": "...", "code": "VALIDATION_*" }]
  }
}
```

En producción, `output` es documentación del contrato; sólo se valida en modo dev. Una respuesta puede añadir `meta.renewedToken` cuando se renueva una sesión.

| Código de aplicación | Cuándo                                                                                                                      | Forma                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **HTTP 200**         | Apps Script devuelve éxito y errores de aplicación con HTTP 200; el estado funcional está en el JSON.                       | JSON plano en éxito; `{ error: { status, message, code?, errors? } }` en error.                         |
| **400**              | JSON/envelope inválido, método o payload mal formados, o clave de ruta inválida.                                            | `{ error: { status, message } }`                                                                        |
| **401**              | Sesión no válida o rechazo de credenciales/PIN.                                                                             | `{ error: { status, message, code? } }`                                                                 |
| **403**              | Acceso insuficiente o la operación no está permitida para el estado actual.                                                 | `{ error: { status, message } }`                                                                        |
| **404**              | Ruta, recurso o registro inexistente; algunos endpoints ocultan recursos no disponibles con este estado.                    | `{ error: { status, message } }`                                                                        |
| **409**              | Conflicto de estado, como un PIN ya utilizado.                                                                              | `{ error: { status, message } }`                                                                        |
| **410**              | Recurso temporal vencido, como un PIN expirado.                                                                             | `{ error: { status, message } }`                                                                        |
| **422**              | El `input` declarado rechaza la petición. Se valida **antes** del handler: el handler no corre.                             | `{ error: { status, message, errors: [{ path, message, code }] } }`                                     |
| **429**              | Límite de peticiones o intentos excedido.                                                                                   | `{ error: { status, message, code? } }`                                                                 |
| **500**              | Error interno; en dev también si la salida incumple `output` (en producción ese chequeo de contrato no frena la respuesta). | `{ error: { status, message: "Salida fuera de contrato en <ruta>: <campo> …" } }` para salida inválida. |
| **503**              | Dependencia o configuración temporalmente no disponible.                                                                    | `{ error: { status, message } }`                                                                        |

Los `code` de un 422 son `VALIDATION_*` y comparten vocabulario con
`src/app/core/registry/field-validators.ts` (check 11 de contract-check).

## Listados de recurso (`GET /admin/<recurso>`, R6.4)

Las rutas CRUD de recurso **no** salen de `REGISTRY.endpoints` (no tienen
`handler` propio): las arma el motor desde el recurso. Éste es el contrato
que comparten todas las de listado.

### Entrada de paginación — mutuamente excluyente

| Clave    | Forma                       | Cuándo se usa                                |
| -------- | --------------------------- | -------------------------------------------- |
| `page`   | `{ size: ≥1, offset?: ≥0 }` | primera página, por posición                 |
| `cursor` | `<nextCursor>`              | continuación: el token de la página anterior |

Las dos a la vez, un `size`/`offset` no entero, una clave fuera de
`size`/`offset` o un cursor corrupto ⇒ **422** con `errors[]`. Se valida
**antes** de leer la hoja.

### Salida — sobre estándar

Cuando la operación declara `shape.envelope: 'list'`, la respuesta es
SIEMPRE ésta, con y sin página pedida:

```json
{ "items": [ … ], "nextCursor": "eyJ2IjoxLCJvIjoyfQ", "total": 128 }
```

| Clave        | Significado                                                   |
| ------------ | ------------------------------------------------------------- |
| `items`      | la página pedida; sin paginar, la lista entera                |
| `nextCursor` | token **opaco** para la página siguiente; `null` en la última |
| `total`      | filas que coinciden con el filtro/vista **antes** del corte   |

Sin `envelope: 'list'` no hay dónde devolver el cursor, así que **pedir
página a ese listado responde 422** en vez de cortar en silencio; lo
mismo con una vista `aggregate` (devuelve UNA fila de resultado). Los
`code` de éstos y de la paginación son `VALIDATION_PAGE`,
`VALIDATION_PAGE_SIZE`, `VALIDATION_PAGE_OFFSET`, `VALIDATION_CURSOR` y
`VALIDATION_PAGINATION`, con `path` relativo al payload.

## Recursos (CRUD por recurso)

> **Generado** de `api/schema/resources/*.js` (este bloque no se edita a
> mano). Las rutas salen de la misma proyección que sirve
> `GET /admin/schema`: una operación apagada no aparece acá porque
> responde 405. Los campos `secret` jamás se nombran.

| #   | Recurso                     | keyField | Operaciones                                 | Acceso (write) |
| --- | --------------------------- | -------- | ------------------------------------------- | -------------- |
| 1   | [`categories`](#categories) | `slug`   | `create`, `get`, `list`, `remove`, `update` | `admin`        |
| 2   | [`dashboard`](#dashboard)   | `id`     |                                             | `admin`        |
| 3   | [`legal`](#legal)           | `key`    | `get`, `update`                             | `admin`        |
| 4   | [`orders`](#orders)         | `ref`    | `create`, `get`, `list`, `remove`, `update` | `admin`        |
| 5   | [`pickpass`](#pickpass)     | `key`    | `get`, `update`                             | `admin`        |
| 6   | [`products`](#products)     | `slug`   | `create`, `get`, `list`, `remove`, `update` | `admin`        |
| 7   | [`site`](#site)             | `key`    | `get`, `update`                             | `admin`        |
| 8   | [`users`](#users)           | `id`     | `create`, `get`, `list`, `remove`, `update` | `role:admin`   |

### `categories`

titleField: `name` · kind: `collection` · sheet: `categories` · keyField: `slug` · activeField: `active` · ordering: positioned

**Operaciones**

| Método | Path                      | Notas                    |
| ------ | ------------------------- | ------------------------ |
| GET    | `/admin/categories`       | —                        |
| GET    | `/admin/categories/{key}` | —                        |
| POST   | `/admin/categories`       | genera: `slug` (slugify) |
| PUT    | `/admin/categories/{key}` | —                        |
| DELETE | `/admin/categories/{key}` | baja lógica vía `active` |

**Campos del CRUD del recurso — payload y respuesta (los `secret` no existen para el doc, R7.6)**

| Campo             | Tipo       | Obligatorio | Reglas                                    |
| ----------------- | ---------- | ----------- | ----------------------------------------- |
| `slug`            | `slug`     | sí          | unique: true · generado: create · slugify |
| `name`            | `text`     | sí          | —                                         |
| `seo_title`       | `text`     | sí          | —                                         |
| `seo_description` | `textarea` | sí          | —                                         |
| `intro`           | `textarea` | sí          | minLength: 100 · maxLength: 1000          |
| `image_url`       | `image`    | sí          | —                                         |
| `image_alt`       | `text`     | no          | —                                         |
| `active`          | `boolean`  | sí          | default: true                             |
| `position`        | `number`   | sí          | sistema                                   |

**Listado** — `listProjection`: `slug`, `image_url`, `name`, `active`, `position`

**Política** — read: `admin` · write: `admin` · cache: {"ttl":300} · audit · lock · visible en `/admin/schema`

### `dashboard`

titleField: `label` · kind: `dashboard` · sheet: `—` · keyField: `id`

**Operaciones**

| Método | Path | Notas |
| ------ | ---- | ----- |

**Campos del CRUD del recurso — payload y respuesta (los `secret` no existen para el doc, R7.6)**

| Campo | Tipo | Obligatorio | Reglas |
| ----- | ---- | ----------- | ------ |

**Listado** — `listProjection`: —

**Política** — read: `admin` · write: `admin` · visible en `/admin/schema`

### `legal`

titleField: `legal_name` · kind: `singleton` · sheet: `legal_config` · keyField: `key` · ordering: none

**Operaciones**

| Método | Path           | Notas |
| ------ | -------------- | ----- |
| GET    | `/admin/legal` | —     |
| PUT    | `/admin/legal` | —     |

**Campos del CRUD del recurso — payload y respuesta (los `secret` no existen para el doc, R7.6)**

| Campo                    | Tipo            | Obligatorio | Reglas                  |
| ------------------------ | --------------- | ----------- | ----------------------- |
| `legal_name`             | `text`          | sí          | —                       |
| `trade_name`             | `text`          | sí          | —                       |
| `ruc`                    | `text`          | sí          | pattern: ^\d{11}$       |
| `fiscal_address`         | `text`          | sí          | —                       |
| `last_updated`           | `readonly-text` | sí          | generado: now · sistema |
| `email`                  | `email`         | sí          | —                       |
| `phone`                  | `phone`         | sí          | —                       |
| `reclamos_email`         | `email`         | sí          | —                       |
| `reclamos_response_days` | `number`        | sí          | min: 0                  |
| `prices_include_igv`     | `boolean`       | sí          | default: true           |
| `currency`               | `text`          | sí          | pattern: ^[A-Z]{3}$     |

**Listado** — `listProjection`: —

**Política** — read: `admin` · write: `admin` · cache: {"ttl":300} · audit · lock · visible en `/admin/schema`

### `orders`

titleField: `customer_name` · kind: `collection` · sheet: `orders` · keyField: `ref` · ordering: none

**Operaciones**

| Método | Path                  | Notas                              |
| ------ | --------------------- | ---------------------------------- |
| GET    | `/admin/orders`       | —                                  |
| GET    | `/admin/orders/{key}` | —                                  |
| POST   | `/admin/orders`       | genera: `ref` (token), `pin` (pin) |
| PUT    | `/admin/orders/{key}` | —                                  |
| DELETE | `/admin/orders/{key}` | hard delete                        |

**Acciones de dominio**

| Método | Path                                         | Handler               | Acceso                      |
| ------ | -------------------------------------------- | --------------------- | --------------------------- |
| POST   | `/admin/orders/{ref}/actions/regenerate-pin` | `handlePinRegenerate` | write del recurso (`admin`) |

**Campos del CRUD del recurso — payload y respuesta (los `secret` no existen para el doc, R7.6)**

| Campo              | Tipo            | Obligatorio | Reglas                                  |
| ------------------ | --------------- | ----------- | --------------------------------------- |
| `ref`              | `text`          | sí          | unique: true · generado: create · token |
| `pin`              | `text`          | no          | maxLength: 12 · generado: create · pin  |
| `customer_name`    | `text`          | sí          | maxLength: 80                           |
| `description`      | `textarea`      | sí          | —                                       |
| `pickup_date`      | `date`          | sí          | —                                       |
| `status`           | `select`        | sí          | enum: 3 valores · default: PENDIENTE    |
| `reference_photo`  | `image`         | no          | —                                       |
| `customer_notes`   | `textarea`      | no          | maxLength: 500                          |
| `authorized_name`  | `text`          | no          | maxLength: 80                           |
| `authorized_photo` | `image`         | no          | —                                       |
| `authorized_notes` | `textarea`      | no          | maxLength: 300                          |
| `auth_state`       | `select`        | no          | enum: 3 valores · default: NINGUNO      |
| `created_at`       | `readonly-text` | no          | generado: now · sistema                 |
| `updated_at`       | `readonly-text` | no          | generado: now · sistema                 |
| `history`          | `list`          | no          | min: 0 · max: 200                       |
| `history.at`       | `readonly-text` | no          | generado: now · sistema                 |
| `history.action`   | `select`        | no          | enum: 5 valores                         |
| `history.detail`   | `text`          | no          | maxLength: 120                          |

**Listado** — `listProjection`: `ref`, `pin`, `customer_name`, `status`, `pickup_date`, `auth_state`, `created_at`

**Audiencia pública** — operaciones CRUD: `get`
**Proyección pública** — `ref`, `customer_name`, `description`, `pickup_date`, `status`, `reference_photo`, `authorized_name`, `authorized_photo`, `auth_state`, `created_at`, `updated_at`, `history`
Las acciones y endpoints custom se declaran por separado; no son operaciones CRUD de esta audiencia.

**Política** — read: `admin` · write: `admin` · cache: {"ttl":60} · audit · lock · visible en `/admin/schema`

### `pickpass`

titleField: `public_base_url` · kind: `singleton` · sheet: `pickpass_config` · keyField: `key` · ordering: none

**Operaciones**

| Método | Path              | Notas |
| ------ | ----------------- | ----- |
| GET    | `/admin/pickpass` | —     |
| PUT    | `/admin/pickpass` | —     |

**Campos del CRUD del recurso — payload y respuesta (los `secret` no existen para el doc, R7.6)**

| Campo                    | Tipo       | Obligatorio | Reglas                                                                                                         |
| ------------------------ | ---------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `public_base_url`        | `url`      | sí          | —                                                                                                              |
| `share_message_template` | `textarea` | sí          | default: Hola {customer_name}, puede retirar su pedido {ref} aquí: {public_base_url}/p/{ref}. Su PIN es {pin}. |
| `pin_ttl_hours`          | `number`   | sí          | min: 1 · max: 720 · default: 24                                                                                |
| `pin_enabled`            | `select`   | sí          | enum: 2 valores · default: SI                                                                                  |

**Listado** — `listProjection`: —

**Política** — read: `admin` · write: `admin` · cache: {"ttl":300} · audit · lock · visible en `/admin/schema`

### `products`

titleField: `name` · kind: `collection` · sheet: `products` · keyField: `slug` · activeField: `active` · ordering: none

**Operaciones**

| Método | Path                    | Notas                    |
| ------ | ----------------------- | ------------------------ |
| GET    | `/admin/products`       | —                        |
| GET    | `/admin/products/{key}` | —                        |
| POST   | `/admin/products`       | genera: `slug` (slugify) |
| PUT    | `/admin/products/{key}` | —                        |
| DELETE | `/admin/products/{key}` | baja lógica vía `active` |

**Campos del CRUD del recurso — payload y respuesta (los `secret` no existen para el doc, R7.6)**

| Campo                | Tipo            | Obligatorio | Reglas                                    |
| -------------------- | --------------- | ----------- | ----------------------------------------- |
| `slug`               | `slug`          | sí          | unique: true · generado: create · slugify |
| `name`               | `text`          | sí          | —                                         |
| `category_slug`      | `relation`      | sí          | —                                         |
| `sku`                | `text`          | sí          | unique: true                              |
| `brand`              | `text`          | no          | —                                         |
| `price`              | `currency`      | sí          | —                                         |
| `availability`       | `select`        | sí          | enum: availability                        |
| `featured`           | `boolean`       | sí          | default: false                            |
| `active`             | `boolean`       | sí          | default: true                             |
| `description`        | `textarea`      | sí          | minLength: 100 · maxLength: 2000          |
| `seo_title`          | `text`          | no          | —                                         |
| `seo_description`    | `textarea`      | sí          | —                                         |
| `registro_sanitario` | `text`          | no          | —                                         |
| `clase_riesgo`       | `select`        | no          | enum: risk_class                          |
| `titular_registro`   | `text`          | no          | —                                         |
| `updated_at`         | `readonly-text` | no          | generado: now · sistema                   |
| `images`             | `list`          | sí          | min: 1                                    |
| `images.image_url`   | `image`         | sí          | —                                         |
| `images.image_alt`   | `text`          | sí          | —                                         |
| `specs`              | `key-value`     | no          | —                                         |
| `faq`                | `list`          | no          | —                                         |
| `faq.question`       | `text`          | sí          | —                                         |
| `faq.answer`         | `textarea`      | sí          | —                                         |

**Listado** — `listProjection`: `slug`, `name`, `category_slug`, `price`, `availability`, `registro_sanitario`, `featured`, `active`, `images`

**Política** — read: `admin` · write: `admin` · cache: {"ttl":300} · audit · lock · visible en `/admin/schema`

### `site`

titleField: `name` · kind: `singleton` · sheet: `site_config` · keyField: `key` · ordering: none

**Operaciones**

| Método | Path          | Notas |
| ------ | ------------- | ----- |
| GET    | `/admin/site` | —     |
| PUT    | `/admin/site` | —     |

**Campos del CRUD del recurso — payload y respuesta (los `secret` no existen para el doc, R7.6)**

| Campo          | Tipo          | Obligatorio | Reglas                             |
| -------------- | ------------- | ----------- | ---------------------------------- |
| `name`         | `text`        | sí          | —                                  |
| `url`          | `url`         | sí          | —                                  |
| `description`  | `textarea`    | sí          | —                                  |
| `currency`     | `text`        | sí          | pattern: ^[A-Z]{3}$ · default: PEN |
| `phone`        | `phone`       | sí          | —                                  |
| `whatsapp`     | `phone`       | sí          | —                                  |
| `email`        | `email`       | sí          | —                                  |
| `address`      | `group`       | sí          | —                                  |
| `geo`          | `group`       | sí          | —                                  |
| `hours`        | `list`        | no          | —                                  |
| `hours.days`   | `multiselect` | sí          | enum: days                         |
| `hours.opens`  | `time`        | sí          | —                                  |
| `hours.closes` | `time`        | sí          | —                                  |
| `social`       | `string-list` | no          | —                                  |

**Listado** — `listProjection`: —

**Política** — read: `admin` · write: `admin` · cache: {"ttl":300} · audit · lock · visible en `/admin/schema`

### `users`

titleField: `name` · kind: `collection` · sheet: `_users` · keyField: `id` · activeField: `active`

**Operaciones**

| Método | Path                 | Notas                    |
| ------ | -------------------- | ------------------------ |
| GET    | `/admin/users`       | —                        |
| GET    | `/admin/users/{key}` | —                        |
| POST   | `/admin/users`       | genera: `id` (uuid)      |
| PUT    | `/admin/users/{key}` | —                        |
| DELETE | `/admin/users/{key}` | baja lógica vía `active` |

**Campos del CRUD del recurso — payload y respuesta (los `secret` no existen para el doc, R7.6)**

| Campo           | Tipo            | Obligatorio | Reglas                                 |
| --------------- | --------------- | ----------- | -------------------------------------- |
| `id`            | `text`          | sí          | unique: true · generado: create · uuid |
| `email`         | `email`         | sí          | unique: true                           |
| `name`          | `text`          | sí          | —                                      |
| `role`          | `select`        | sí          | enum: 1 valores · default: admin       |
| `active`        | `boolean`       | sí          | default: true                          |
| `last_login_at` | `readonly-text` | no          | —                                      |
| `created_at`    | `readonly-text` | no          | —                                      |

**Listado** — `listProjection`: `id`, `email`, `name`, `role`, `active`, `last_login_at`

**Política** — read: `role:admin` · write: `role:admin` · cache: {"ttl":60} · audit · lock · visible en `/admin/schema`

## Resumen

| #   | Método | Ruta                      | Acceso  | Límites                                                  | Recurso  | `input` | `output` | `since` |
| --- | ------ | ------------------------- | ------- | -------------------------------------------------------- | -------- | ------- | -------- | ------- |
| 1   | GET    | `/admin/dashboard`        | admin   | `30/min`                                                 | `orders` | no      | no       | `1.0`   |
| 2   | POST   | `/admin/events`           | admin   | `60/min`                                                 | —        | no      | sí       | `1.0`   |
| 3   | GET    | `/admin/schema`           | admin   | —                                                        | —        | no      | no       | `1.0`   |
| 4   | GET    | `/admin/sheet-drift`      | admin   | —                                                        | —        | no      | no       | `1.0`   |
| 5   | POST   | `/admin/upload-signature` | admin   | `10/min`                                                 | —        | no      | no       | `1.0`   |
| 6   | POST   | `/auth/login`             | public  | `{"read":"10/min","write":"10/min","account":"5/15min"}` | —        | sí      | sí       | `1.0`   |
| 7   | POST   | `/auth/logout`            | session | —                                                        | —        | no      | sí       | `1.0`   |
| 8   | POST   | `/auth/me`                | session | —                                                        | —        | no      | sí       | `1.0`   |
| 9   | GET    | `/p/orders/:ref`          | public  | `60/min`                                                 | `orders` | no      | no       | `1.0`   |
| 10  | POST   | `/p/pin/:ref`             | public  | `5/min`                                                  | `orders` | sí      | sí       | `1.0`   |

## Endpoints

### `GET /admin/dashboard`

| Handler           | Acceso | Límites | Recurso  | `cache` | `since` |
| ----------------- | ------ | ------- | -------- | ------- | ------- |
| `handleDashboard` | admin  | 30/min  | `orders` | —       | `1.0`   |

**input** — sin contrato declarado.

**output** — sin contrato declarado.

**Cómo llamar** — envía siempre un `POST` HTTP a `API_URL`; el método de la operación va en `method` dentro del envelope.
Sustituye los parámetros `{...}` de `path` por valores URL-encoded. Los campos y filtros van en `payload`; los `params` declarados se extraen de la ruta y no se repiten en el body. El ejemplo usa valores ilustrativos, no necesariamente válidos para todas las reglas.

```json
{
  "token": "<token de sesión/admin>",
  "method": "GET",
  "path": "/admin/dashboard",
  "payload": {}
}
```

**Errores comunes del router** — 400 (JSON, envelope o método mal formados) · 401/403 (sesión o acceso) · 404 (ruta o registro inexistente) · 429 (límite) · 500 (error interno). Los detalles específicos del handler se listan aparte cuando están declarados.

---

### `POST /admin/events`

| Handler        | Acceso | Límites | Recurso | `cache` | `since` |
| -------------- | ------ | ------- | ------- | ------- | ------- |
| `handleEvents` | admin  | 60/min  | —       | —       | `1.0`   |

**input** — sin contrato declarado.

**output — se valida sólo en dev (500 si falla)**

| Campo | Tipo      | Obligatorio | Reglas |
| ----- | --------- | ----------- | ------ |
| `ok`  | `boolean` | sí          | —      |

**Cómo llamar** — envía siempre un `POST` HTTP a `API_URL`; el método de la operación va en `method` dentro del envelope.
Sustituye los parámetros `{...}` de `path` por valores URL-encoded. Los campos y filtros van en `payload`; los `params` declarados se extraen de la ruta y no se repiten en el body. El ejemplo usa valores ilustrativos, no necesariamente válidos para todas las reglas.

```json
{
  "token": "<token de sesión/admin>",
  "method": "POST",
  "path": "/admin/events",
  "payload": {}
}
```

**Errores comunes del router** — 400 (JSON, envelope o método mal formados) · 401/403 (sesión o acceso) · 404 (ruta o registro inexistente) · 429 (límite) · 500 (error interno). Los detalles específicos del handler se listan aparte cuando están declarados.

---

### `GET /admin/schema`

| Handler        | Acceso | Límites | Recurso | `cache` | `since` |
| -------------- | ------ | ------- | ------- | ------- | ------- |
| `handleSchema` | admin  | —       | —       | —       | `1.0`   |

**input** — sin contrato declarado.

**output** — sin contrato declarado.

**Cómo llamar** — envía siempre un `POST` HTTP a `API_URL`; el método de la operación va en `method` dentro del envelope.
Sustituye los parámetros `{...}` de `path` por valores URL-encoded. Los campos y filtros van en `payload`; los `params` declarados se extraen de la ruta y no se repiten en el body. El ejemplo usa valores ilustrativos, no necesariamente válidos para todas las reglas.

```json
{
  "token": "<token de sesión/admin>",
  "method": "GET",
  "path": "/admin/schema",
  "payload": {}
}
```

**Errores comunes del router** — 400 (JSON, envelope o método mal formados) · 401/403 (sesión o acceso) · 404 (ruta o registro inexistente) · 500 (error interno). Los detalles específicos del handler se listan aparte cuando están declarados.

---

### `GET /admin/sheet-drift`

| Handler            | Acceso | Límites | Recurso | `cache` | `since` |
| ------------------ | ------ | ------- | ------- | ------- | ------- |
| `handleSheetDrift` | admin  | —       | —       | —       | `1.0`   |

**input** — sin contrato declarado.

**output** — sin contrato declarado.

**Cómo llamar** — envía siempre un `POST` HTTP a `API_URL`; el método de la operación va en `method` dentro del envelope.
Sustituye los parámetros `{...}` de `path` por valores URL-encoded. Los campos y filtros van en `payload`; los `params` declarados se extraen de la ruta y no se repiten en el body. El ejemplo usa valores ilustrativos, no necesariamente válidos para todas las reglas.

```json
{
  "token": "<token de sesión/admin>",
  "method": "GET",
  "path": "/admin/sheet-drift",
  "payload": {}
}
```

**Errores comunes del router** — 400 (JSON, envelope o método mal formados) · 401/403 (sesión o acceso) · 404 (ruta o registro inexistente) · 500 (error interno). Los detalles específicos del handler se listan aparte cuando están declarados.

---

### `POST /admin/upload-signature`

| Handler                 | Acceso | Límites | Recurso | `cache` | `since` |
| ----------------------- | ------ | ------- | ------- | ------- | ------- |
| `handleUploadSignature` | admin  | 10/min  | —       | —       | `1.0`   |

**input** — sin contrato declarado.

**output** — sin contrato declarado.

**Cómo llamar** — envía siempre un `POST` HTTP a `API_URL`; el método de la operación va en `method` dentro del envelope.
Sustituye los parámetros `{...}` de `path` por valores URL-encoded. Los campos y filtros van en `payload`; los `params` declarados se extraen de la ruta y no se repiten en el body. El ejemplo usa valores ilustrativos, no necesariamente válidos para todas las reglas.

```json
{
  "token": "<token de sesión/admin>",
  "method": "POST",
  "path": "/admin/upload-signature",
  "payload": {}
}
```

**Errores comunes del router** — 400 (JSON, envelope o método mal formados) · 401/403 (sesión o acceso) · 404 (ruta o registro inexistente) · 429 (límite) · 500 (error interno). Los detalles específicos del handler se listan aparte cuando están declarados.

---

### `POST /auth/login`

| Handler           | Acceso | Límites                                                | Recurso | `cache` | `since` |
| ----------------- | ------ | ------------------------------------------------------ | ------- | ------- | ------- |
| `handleAuthLogin` | public | {"read":"10/min","write":"10/min","account":"5/15min"} | —       | —       | `1.0`   |

**input — se valida ANTES del handler (422 si falla)**

| Campo      | Tipo     | Obligatorio | Reglas |
| ---------- | -------- | ----------- | ------ |
| `email`    | `email`  | no          | —      |
| `password` | `secret` | no          | —      |

**output — se valida sólo en dev (500 si falla)**

| Campo   | Tipo    | Obligatorio | Reglas |
| ------- | ------- | ----------- | ------ |
| `token` | `text`  | sí          | —      |
| `user`  | `group` | sí          | —      |

**Cómo llamar** — envía siempre un `POST` HTTP a `API_URL`; el método de la operación va en `method` dentro del envelope.
Sustituye los parámetros `{...}` de `path` por valores URL-encoded. Los campos y filtros van en `payload`; los `params` declarados se extraen de la ruta y no se repiten en el body. El ejemplo usa valores ilustrativos, no necesariamente válidos para todas las reglas.

```json
{
  "method": "POST",
  "path": "/auth/login",
  "payload": {
    "email": "usuario@example.com",
    "password": "<PASSWORD>"
  }
}
```

**Errores comunes del router** — 400 (JSON, envelope o método mal formados) · 404 (ruta o registro inexistente) · 422 (contrato de entrada) · 429 (límite) · 500 (error interno). Los detalles específicos del handler se listan aparte cuando están declarados.

Los campos **no declarados en `input` no se validan por el contrato**; el handler recibe el payload original.

---

### `POST /auth/logout`

| Handler            | Acceso  | Límites | Recurso | `cache` | `since` |
| ------------------ | ------- | ------- | ------- | ------- | ------- |
| `handleAuthLogout` | session | —       | —       | —       | `1.0`   |

**input** — sin contrato declarado.

**output — se valida sólo en dev (500 si falla)**

| Campo       | Tipo      | Obligatorio | Reglas |
| ----------- | --------- | ----------- | ------ |
| `loggedOut` | `boolean` | sí          | —      |

**Cómo llamar** — envía siempre un `POST` HTTP a `API_URL`; el método de la operación va en `method` dentro del envelope.
Sustituye los parámetros `{...}` de `path` por valores URL-encoded. Los campos y filtros van en `payload`; los `params` declarados se extraen de la ruta y no se repiten en el body. El ejemplo usa valores ilustrativos, no necesariamente válidos para todas las reglas.

```json
{
  "token": "<token de sesión/admin>",
  "method": "POST",
  "path": "/auth/logout",
  "payload": {}
}
```

**Errores comunes del router** — 400 (JSON, envelope o método mal formados) · 401/403 (sesión o acceso) · 404 (ruta o registro inexistente) · 500 (error interno). Los detalles específicos del handler se listan aparte cuando están declarados.

---

### `POST /auth/me`

| Handler        | Acceso  | Límites | Recurso | `cache` | `since` |
| -------------- | ------- | ------- | ------- | ------- | ------- |
| `handleAuthMe` | session | —       | —       | —       | `1.0`   |

**input** — sin contrato declarado.

**output — se valida sólo en dev (500 si falla)**

| Campo  | Tipo    | Obligatorio | Reglas |
| ------ | ------- | ----------- | ------ |
| `user` | `group` | sí          | —      |

**Cómo llamar** — envía siempre un `POST` HTTP a `API_URL`; el método de la operación va en `method` dentro del envelope.
Sustituye los parámetros `{...}` de `path` por valores URL-encoded. Los campos y filtros van en `payload`; los `params` declarados se extraen de la ruta y no se repiten en el body. El ejemplo usa valores ilustrativos, no necesariamente válidos para todas las reglas.

```json
{
  "token": "<token de sesión/admin>",
  "method": "POST",
  "path": "/auth/me",
  "payload": {}
}
```

**Errores comunes del router** — 400 (JSON, envelope o método mal formados) · 401/403 (sesión o acceso) · 404 (ruta o registro inexistente) · 500 (error interno). Los detalles específicos del handler se listan aparte cuando están declarados.

---

### `GET /p/orders/:ref`

| Handler             | Acceso | Límites | Recurso  | `cache` | `since` |
| ------------------- | ------ | ------- | -------- | ------- | ------- |
| `handlePublicOrder` | public | 60/min  | `orders` | —       | `1.0`   |

**input** — sin contrato declarado.

**output** — sin contrato declarado.

**Cómo llamar** — envía siempre un `POST` HTTP a `API_URL`; el método de la operación va en `method` dentro del envelope.
Sustituye los parámetros `{...}` de `path` por valores URL-encoded. Los campos y filtros van en `payload`; los `params` declarados se extraen de la ruta y no se repiten en el body. El ejemplo usa valores ilustrativos, no necesariamente válidos para todas las reglas.

```json
{
  "method": "GET",
  "path": "/p/orders/{ref}",
  "payload": {}
}
```

**Errores comunes del router** — 400 (JSON, envelope, método o clave mal formados) · 404 (ruta o registro inexistente) · 429 (límite) · 500 (error interno). Los detalles específicos del handler se listan aparte cuando están declarados.

---

### `POST /p/pin/:ref`

| Handler           | Acceso | Límites | Recurso  | `cache` | `since` |
| ----------------- | ------ | ------- | -------- | ------- | ------- |
| `handlePinVerify` | public | 5/min   | `orders` | —       | `1.0`   |

**input — se valida ANTES del handler (422 si falla)**

| Campo        | Tipo     | Obligatorio | Reglas |
| ------------ | -------- | ----------- | ------ |
| `params.ref` | `text`   | sí          | —      |
| `pin`        | `secret` | sí          | —      |

**output — se valida sólo en dev (500 si falla)**

| Campo | Tipo      | Obligatorio | Reglas |
| ----- | --------- | ----------- | ------ |
| `ok`  | `boolean` | sí          | —      |
| `ref` | `text`    | sí          | —      |

**Cómo llamar** — envía siempre un `POST` HTTP a `API_URL`; el método de la operación va en `method` dentro del envelope.
Sustituye los parámetros `{...}` de `path` por valores URL-encoded. Los campos y filtros van en `payload`; los `params` declarados se extraen de la ruta y no se repiten en el body. El ejemplo usa valores ilustrativos, no necesariamente válidos para todas las reglas.

```json
{
  "method": "POST",
  "path": "/p/pin/{ref}",
  "payload": {
    "pin": "<PIN>"
  }
}
```

**Errores comunes del router** — 400 (JSON, envelope, método o clave mal formados) · 404 (ruta o registro inexistente) · 422 (contrato de entrada) · 429 (límite) · 500 (error interno). Los detalles específicos del handler se listan aparte cuando están declarados.

**Errores específicos declarados** — `status` es el código de aplicación dentro de `error`; Apps Script responde HTTP 200.

| `status` | `code` | Significado                                                                                    |
| -------- | ------ | ---------------------------------------------------------------------------------------------- |
| **401**  | —      | El PIN recibido no coincide con el hash guardado.                                              |
| **403**  | —      | El pedido no está PENDIENTE y ya no admite retiro.                                             |
| **404**  | —      | No hay PIN para el pedido, el PIN está deshabilitado o el pedido no existe.                    |
| **409**  | —      | El PIN ya fue utilizado.                                                                       |
| **410**  | —      | El PIN superó pin_ttl_hours (24 h por defecto) o su fecha de creación no se puede interpretar. |
| **422**  | —      | Falta el PIN requerido en el payload.                                                          |
| **429**  | —      | Se agotaron los intentos por pedido o el límite de 5/min.                                      |
| **500**  | —      | Error de configuración o estructura interna de las hojas.                                      |
| **503**  | —      | La hoja auxiliar _pin no está configurada.                                                     |

Los campos **no declarados en `input` no se validan por el contrato**; el handler recibe el payload original.
