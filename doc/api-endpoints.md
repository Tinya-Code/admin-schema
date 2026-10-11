# API — contrato de endpoints (OpenAPI-lite)

> **Documento generado** por `scripts/api-doc.mjs` a partir de
> `api/schema/endpoints/*.js`. No editar a mano: `npm run api:doc` lo
> regenera y `npm run api:check` lo marca ROJO si no coincide con el
> registro.

## Envelope (contrato para el front)

Apps Script no expone cabeceras: todo viaja en el cuerpo de un `POST`
(`Content-Type: text/plain`, sin preflight — ver `doc/baseapi.md` §2).

```json
{ "token": "<sólo admin>", "method": "POST", "path": "/auth/login", "payload": {} }
```

| Código              | Cuándo                                                                                           | Forma                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| **422**             | El `input` declarado rechaza la petición. Se valida **antes** del handler: el handler no corre.  | `{ error: { status, message, errors: [{ path, message, code }] } }`               |
| **500**             | Sólo en dev: la salida no cumple el `output` declarado. En prod el contrato documenta, no frena. | `{ error: { status, message: "Salida fuera de contrato en <ruta>: <campo> …" } }` |
| **401 / 403 / 429** | Auth, `access` y límites — no los decide el contrato de `input`.                                 | `{ error: { status, message, code } }`                                            |

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

**Campos — payload y respuesta (los `secret` no existen para el doc, R7.6)**

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

**Política** — read: `admin` · write: `admin` · cache: {"ttl":300} · audit · lock · publicable a front

### `dashboard`

titleField: `label` · kind: `dashboard` · sheet: `—` · keyField: `id`

**Operaciones**

| Método | Path | Notas |
| ------ | ---- | ----- |

**Campos — payload y respuesta (los `secret` no existen para el doc, R7.6)**

| Campo | Tipo | Obligatorio | Reglas |
| ----- | ---- | ----------- | ------ |

**Listado** — `listProjection`: —

**Política** — read: `admin` · write: `admin` · publicable a front

### `legal`

titleField: `legal_name` · kind: `singleton` · sheet: `legal_config` · keyField: `key` · ordering: none

**Operaciones**

| Método | Path           | Notas |
| ------ | -------------- | ----- |
| GET    | `/admin/legal` | —     |
| PUT    | `/admin/legal` | —     |

**Campos — payload y respuesta (los `secret` no existen para el doc, R7.6)**

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

**Política** — read: `admin` · write: `admin` · cache: {"ttl":300} · audit · lock · publicable a front

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

**Campos — payload y respuesta (los `secret` no existen para el doc, R7.6)**

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

**Política** — read: `admin` · write: `admin` · cache: {"ttl":60} · audit · lock · publicable a front

### `pickpass`

titleField: `public_base_url` · kind: `singleton` · sheet: `pickpass_config` · keyField: `key` · ordering: none

**Operaciones**

| Método | Path              | Notas |
| ------ | ----------------- | ----- |
| GET    | `/admin/pickpass` | —     |
| PUT    | `/admin/pickpass` | —     |

**Campos — payload y respuesta (los `secret` no existen para el doc, R7.6)**

| Campo                    | Tipo       | Obligatorio | Reglas                                                                                                         |
| ------------------------ | ---------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `public_base_url`        | `url`      | sí          | —                                                                                                              |
| `share_message_template` | `textarea` | sí          | default: Hola {customer_name}, puede retirar su pedido {ref} aquí: {public_base_url}/p/{ref}. Su PIN es {pin}. |
| `pin_ttl_hours`          | `number`   | sí          | min: 1 · max: 720 · default: 24                                                                                |
| `pin_enabled`            | `select`   | sí          | enum: 2 valores · default: SI                                                                                  |

**Listado** — `listProjection`: —

**Política** — read: `admin` · write: `admin` · cache: {"ttl":300} · audit · lock · publicable a front

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

**Campos — payload y respuesta (los `secret` no existen para el doc, R7.6)**

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

**Política** — read: `admin` · write: `admin` · cache: {"ttl":300} · audit · lock · publicable a front

### `site`

titleField: `name` · kind: `singleton` · sheet: `site_config` · keyField: `key` · ordering: none

**Operaciones**

| Método | Path          | Notas |
| ------ | ------------- | ----- |
| GET    | `/admin/site` | —     |
| PUT    | `/admin/site` | —     |

**Campos — payload y respuesta (los `secret` no existen para el doc, R7.6)**

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

**Política** — read: `admin` · write: `admin` · cache: {"ttl":300} · audit · lock · publicable a front

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

**Campos — payload y respuesta (los `secret` no existen para el doc, R7.6)**

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

**Política** — read: `role:admin` · write: `role:admin` · cache: {"ttl":60} · audit · lock · publicable a front

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
| 10  | POST   | `/p/pin/:ref`             | public  | `5/min`                                                  | `orders` | no      | sí       | `1.0`   |

## Endpoints

### `GET /admin/dashboard`

| Handler           | Acceso | Límites | Recurso  | `cache` | `since` |
| ----------------- | ------ | ------- | -------- | ------- | ------- |
| `handleDashboard` | admin  | 30/min  | `orders` | —       | `1.0`   |

**input** — sin contrato declarado.

**output** — sin contrato declarado.

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

---

### `GET /admin/schema`

| Handler        | Acceso | Límites | Recurso | `cache` | `since` |
| -------------- | ------ | ------- | ------- | ------- | ------- |
| `handleSchema` | admin  | —       | —       | —       | `1.0`   |

**input** — sin contrato declarado.

**output** — sin contrato declarado.

---

### `GET /admin/sheet-drift`

| Handler            | Acceso | Límites | Recurso | `cache` | `since` |
| ------------------ | ------ | ------- | ------- | ------- | ------- |
| `handleSheetDrift` | admin  | —       | —       | —       | `1.0`   |

**input** — sin contrato declarado.

**output** — sin contrato declarado.

---

### `POST /admin/upload-signature`

| Handler                 | Acceso | Límites | Recurso | `cache` | `since` |
| ----------------------- | ------ | ------- | ------- | ------- | ------- |
| `handleUploadSignature` | admin  | 10/min  | —       | —       | `1.0`   |

**input** — sin contrato declarado.

**output** — sin contrato declarado.

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

Los campos **no declarados en `input` se ignoran** (lista blanca).

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

---

### `GET /p/orders/:ref`

| Handler             | Acceso | Límites | Recurso  | `cache` | `since` |
| ------------------- | ------ | ------- | -------- | ------- | ------- |
| `handlePublicOrder` | public | 60/min  | `orders` | —       | `1.0`   |

**input** — sin contrato declarado.

**output** — sin contrato declarado.

---

### `POST /p/pin/:ref`

| Handler           | Acceso | Límites | Recurso  | `cache` | `since` |
| ----------------- | ------ | ------- | -------- | ------- | ------- |
| `handlePinVerify` | public | 5/min   | `orders` | —       | `1.0`   |

**input** — sin contrato declarado.

**output — se valida sólo en dev (500 si falla)**

| Campo | Tipo      | Obligatorio | Reglas |
| ----- | --------- | ----------- | ------ |
| `ok`  | `boolean` | sí          | —      |
| `ref` | `text`    | sí          | —      |
