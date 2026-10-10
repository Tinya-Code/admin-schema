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
