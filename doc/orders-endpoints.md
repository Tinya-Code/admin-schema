# Orders API Endpoints

Recurso: `orders` (Pedidos y autorizados de retiro - PickPass)

Schema: `api/schema/resources/orders.js`

---

## Formato de Request (Google Apps Script)

**IMPORTANTE:** Google Apps Script NO expone headers y solo acepta `POST`. Por eso, todas las solicitudes usan el siguiente envelope:

```json
{
  "token": "tu-token-admin",
  "method": "GET | POST | PUT | PATCH | DELETE",
  "path": "/ruta/endpoint",
  "payload": {}
}
```

**Campos del envelope:**

- `token` (string, opcional para endpoints públicos): Token de autenticación
- `method` (string): Método HTTP lógico (GET, POST, PUT, PATCH, DELETE)
- `path` (string): Ruta del endpoint (ej: `/admin/orders`, `/p/orders/abc123`)
- `payload` (object): Cuerpo de la solicitud (vacío si no hay datos)

**Content-Type:** `text/plain` con JSON en el body (NO `application/json` para evitar preflight/CORS)

**Restricciones de Apps Script:**

- Sin headers custom (criterio 11 de baseapi)
- Solo POST (el método lógico va en el body)
- Sin CORS/preflight
- El token nunca viaja en la URL ni en logs

---

## Formato de Response

**Éxito → JSON plano, SIN sobre.** El backend devuelve directamente el dato
(objeto o array) a través de `ContentService.createTextOutput()`:

```json
[{ "ref": "abc123", "status": "PENDIENTE" }]
```

```json
{ "ref": "abc123", "status": "PENDIENTE" }
```

**Error → sobre canónico `{ error: { … } }`** (`core/12-http.js`):

```json
{
  "error": {
    "status": 401,
    "message": "PIN incorrecto",
    "errors": [{ "path": "customer_name", "message": "Requerido" }]
  }
}
```

- `errors` sólo aparece en validaciones de negocio (422); el resto de
  errores llevan sólo `status` y `message`.
- **No existe `{ ok: false }`.** Ese shape sólo lo usan las funciones de
  setup (`setup/*`), que corren desde el editor de Apps Script y no por
  petición.
- La única respuesta de éxito con `ok` es `POST /p/pin/:ref`
  (`{ "ok": true, "ref": "…" }`), que lo devuelve a propósito.

---

## Autenticación

### Token de Admin

El token viaja en el campo `token` del envelope (no en headers):

```json
{
  "token": "tu-token-aqui",
  "method": "GET",
  "path": "/admin/orders",
  "payload": {}
}
```

**Validación:**

- El token se hashea con SHA-256 en el backend
- Se compara con `ADMIN_TOKEN_HASH` (propiedad del script)
- Comparación en tiempo constante (previene timing attacks)
- Token inválido → HTTP 401 "No autorizado"
- Token faltante → HTTP 401 "No autorizado"
- Sin hash configurado → HTTP 500 (error de configuración)

### Niveles de Acceso

| Nivel    | Requiere Token | Endpoints                                                       |
| -------- | -------------- | --------------------------------------------------------------- |
| `admin`  | Sí             | CRUD genérico (`/admin/orders`), Dashboard (`/admin/dashboard`) |
| `public` | No             | Vista pública (`/p/orders/:ref`), Verificar PIN (`/p/pin/:ref`) |

---

## 1. GET /admin/orders - Listado de pedidos

**Request:**

```json
{
  "token": "tu-token-admin",
  "method": "GET",
  "path": "/admin/orders",
  "payload": {
    "filter": "pendientes_recientes" | "pendientes" | "entregados" | "cancelados" | null,
    "key": "ref_del_pedido" | null
  }
}
```

**Response:**

```json
[
  {
    "ref": "abc123",
    "pin": "123456",
    "customer_name": "Juan Pérez",
    "status": "PENDIENTE",
    "pickup_date": "2026-10-10",
    "auth_state": "NINGUNO",
    "created_at": "2026-10-06"
  }
]
```

**Views disponibles (en `payload.filter`):**

- `pendientes_recientes`: Lista los 5 pedidos pendientes más recientes (ordenados por `created_at` desc)
- `pendientes`: Contador de pedidos con status = PENDIENTE
- `entregados`: Contador de pedidos con status = ENTREGADO
- `cancelados`: Contador de pedidos con status = CANCELADO
- `null` o ausente: Listado completo sin filtros

**Notas:**

- Solo retorna los campos de `listProjection` (campos mínimos para el listado)
- `pin` se retorna en claro para que el operador pueda copiarlo al cliente
- Cache TTL: 60 segundos
- Rate-limit: 60/min (heredado de `policies.limits`)

---

## 2. GET /admin/orders/:ref - Detalle de pedido

**Request:**

```json
{
  "token": "tu-token-admin",
  "method": "GET",
  "path": "/admin/orders/abc123",
  "payload": {}
}
```

**Response:**

```json
{
  "ref": "abc123",
  "pin": "123456",
  "customer_name": "Juan Pérez",
  "description": "Pedido de pruebas con múltiples ítems",
  "pickup_date": "2026-10-10",
  "status": "PENDIENTE",
  "reference_photo": "https://...",
  "customer_notes": "Notas del cliente",
  "authorized_name": "María López",
  "authorized_photo": "https://...",
  "authorized_notes": "Notas de autorización",
  "auth_state": "NINGUNO",
  "created_at": "2026-10-06T12:00:00",
  "updated_at": "2026-10-06T12:00:00",
  "history": [
    {
      "at": "2026-10-06T12:00:00",
      "action": "PEDIDO_CREADO",
      "detail": "Pedido inicial"
    }
  ]
}
```

**Notas:**

- Retorna todos los campos del pedido
- Incluye el array `history` con el historial de cambios
- Cache TTL: 60 segundos
- Rate-limit: 60/min

---

## 3. POST /admin/orders - Crear pedido

**Request:**

```json
{
  "token": "tu-token-admin",
  "method": "POST",
  "path": "/admin/orders",
  "payload": {
    "customer_name": "Juan Pérez",
    "description": "Pedido de prueba",
    "pickup_date": "2026-10-10",
    "reference_photo": "https://url-imagen",
    "customer_notes": "Notas opcionales"
  }
}
```

**Campos obligatorios en `payload`:**

- `customer_name` (string, max 80 caracteres)
- `description` (textarea, min 3 palabras, max 120 palabras)
- `pickup_date` (date)

**Campos opcionales en `payload`:**

- `reference_photo` (image)
- `customer_notes` (textarea, max 500 caracteres)

**Campos computados (generados automáticamente):**

- `ref`: Token único generado desde `customer_name` (transform `token`)
- `pin`: PIN de 12 caracteres generado desde `customer_name` (transform `pin`)
- `status`: Default = "PENDIENTE"
- `auth_state`: Default = "NINGUNO"
- `created_at`: Timestamp actual
- `updated_at`: Timestamp actual

**Response:**

```json
{
  "ref": "abc123",
  "pin": "123456",
  "customer_name": "Juan Pérez",
  "description": "Pedido de prueba",
  "pickup_date": "2026-10-10",
  "status": "PENDIENTE",
  "auth_state": "NINGUNO",
  "created_at": "2026-10-06T12:00:00",
  "updated_at": "2026-10-06T12:00:00",
  "history": [
    {
      "at": "2026-10-06T12:00:00",
      "action": "PEDIDO_CREADO",
      "detail": "Pedido inicial"
    }
  ]
}
```

**Validaciones (checks):**

- `not-in-sheet`: No permite valores que están en la hoja `_placeholders`
- `no-auth-after-delivered`: No permite autorizar un pedido ya entregado
- `history-append-only`: El historial es append-only (no se puede modificar)

**Hooks:**

- `pinHash`: Crea el hash SHA-256 del PIN en la hoja `_pin` después de escribir

**Notas:**

- Rate-limit: 60/min
- Lock: true (escritura con lock de Google Sheets)

---

## 4. PUT /admin/orders/:ref - Actualizar pedido

**Request:**

```json
{
  "token": "tu-token-admin",
  "method": "PUT",
  "path": "/admin/orders/abc123",
  "payload": {
    "customer_name": "Juan Pérez Modificado",
    "description": "Descripción actualizada",
    "pickup_date": "2026-10-11",
    "status": "ENTREGADO",
    "reference_photo": "https://nueva-url",
    "customer_notes": "Nuevas notas",
    "authorized_name": "María López",
    "authorized_photo": "https://url-autorizacion",
    "authorized_notes": "Notas de autorización",
    "auth_state": "ACTIVA"
  }
}
```

**Campos que se pueden actualizar:**

- Todos los campos excepto `ref` (inmutable) y los campos de sistema (`created_at`, `updated_at`)
- `pin` NO se puede actualizar manualmente (es generado al crear)
- Los campos no enviados se conservan (PATCH quirúrgico)

**Enums:**

- `status`: ["PENDIENTE", "ENTREGADO", "CANCELADO"]
- `auth_state`: ["NINGUNO", "ACTIVA", "REVOCADA"]

**Response:**

```json
{
  "ref": "abc123",
  "pin": "123456",
  "customer_name": "Juan Pérez Modificado",
  "description": "Descripción actualizada",
  "pickup_date": "2026-10-11",
  "status": "ENTREGADO",
  "auth_state": "ACTIVA",
  "created_at": "2026-10-06T12:00:00",
  "updated_at": "2026-10-06T14:00:00",
  "history": [
    {
      "at": "2026-10-06T12:00:00",
      "action": "PEDIDO_CREADO",
      "detail": "Pedido inicial"
    },
    {
      "at": "2026-10-06T14:00:00",
      "action": "AUTORIZADO",
      "detail": "Autorización agregada"
    }
  ]
}
```

**Notas:**

- `updated_at` se actualiza automáticamente
- Los cambios en `auth_state` agregan entradas al `history`
- Rate-limit: 60/min
- Lock: true

---

## 5. DELETE /admin/orders/:ref - Eliminar pedido

**Request:**

```json
{
  "token": "tu-token-admin",
  "method": "DELETE",
  "path": "/admin/orders/abc123",
  "payload": {}
}
```

**Response:**

```json
{ "deleted": "abc123" }
```

**Notas:**

- `onDelete: 'restrict'` - No permite eliminar si tiene dependientes
- Invalida la caché del recurso
- Rate-limit: 60/min

---

## 6. GET /p/orders/:ref - Vista pública de pedido (público)

**Endpoint custom declarado en:** `api/schema/endpoints/public-order.js`

**Request:**

```json
{
  "method": "GET",
  "path": "/p/orders/abc123",
  "payload": {}
}
```

**Response:**

```json
{
  "ref": "abc123",
  "customer_name": "Juan Pérez",
  "description": "Pedido de prueba",
  "pickup_date": "2026-10-10",
  "status": "PENDIENTE",
  "reference_photo": "https://...",
  "authorized_name": "María López",
  "authorized_photo": "https://...",
  "auth_state": "NINGUNO",
  "created_at": "2026-10-06T12:00:00",
  "updated_at": "2026-10-06T12:00:00",
  "history": [
    {
      "at": "2026-10-06T12:00:00",
      "action": "PEDIDO_CREADO",
      "detail": "Pedido inicial"
    }
  ]
}
```

**Campos expuestos (whitelist estricto):**

- `ref`, `customer_name`, `description`, `pickup_date`, `status`
- `reference_photo`, `authorized_name`, `authorized_photo`
- `auth_state`, `created_at`, `updated_at`, `history`

**Campos ocultos (no expuestos al público):**

- `pin` (el PIN nunca se expone al público)
- `customer_notes` (notas internas)
- `authorized_notes` (notas internas)

**Notas:**

- Acceso `public` - NO requiere token
- Rate-limit: 60 requests por minuto
- Solo expone campos que el cliente y el autorizado necesitan ver
- Proyección de solo lectura del endpoint privado

---

## 7. GET /admin/dashboard - Métricas del panel (admin)

**Endpoint custom declarado en:** `api/schema/endpoints/dashboard.js`

**Request:**

```json
{
  "token": "tu-token-admin",
  "method": "GET",
  "path": "/admin/dashboard",
  "payload": {}
}
```

**Response:**

```json
{
  "pendientes": 15,
  "entregados": 42,
  "cancelados": 3,
  "pendientes_recientes": [
    {
      "ref": "abc123",
      "pin": "123456",
      "customer_name": "Juan Pérez",
      "status": "PENDIENTE",
      "pickup_date": "2026-10-10",
      "auth_state": "NINGUNO",
      "created_at": "2026-10-06"
    }
  ]
}
```

**Vistas ejecutadas (desde `orders.views`):**

- `pendientes`: Contador de pedidos con status = PENDIENTE
- `entregados`: Contador de pedidos con status = ENTREGADO
- `cancelados`: Contador de pedidos con status = CANCELADO
- `pendientes_recientes`: Lista de 5 pedidos pendientes más recientes

**Notas:**

- Acceso `admin` - Requiere token
- Rate-limit: 30 requests por minuto
- Ejecuta todas las vistas declaradas en `resource.views`
- Para vistas con `aggregate: 'count'`, extrae el valor escalar (o 0 si null)

---

## 8. POST /p/pin/:ref - Verificar PIN (público)

**Endpoint custom declarado en:** `api/schema/endpoints/pin-verify.js`

**NOTA:** La ruta es `/p/pin/:ref` (no `/p/orders/:ref/pin`) porque el router de Google Apps Script solo soporta un nivel de parámetro al final de la ruta.

**Request:**

```json
{
  "method": "POST",
  "path": "/p/pin/abc123",
  "payload": {
    "pin": "123456"
  }
}
```

**Response (PIN correcto):**

```json
{
  "ok": true,
  "ref": "abc123"
}
```

**Errores:**

| Código | Descripción                                       | Causa                                                  |
| ------ | ------------------------------------------------- | ------------------------------------------------------ |
| 400    | "Falta la referencia del pedido en la ruta"       | Parámetro `:ref` faltante                              |
| 400    | "Falta el campo pin en el cuerpo de la solicitud" | Campo `pin` faltante                                   |
| 403    | "El pedido ya no admite retiro de PIN"            | El pedido no está en estado PENDIENTE (R8.9)           |
| 404    | "No hay PIN configurado para este pedido"         | Sin filas en `_pin`, o `pin_enabled` = NO (R8.9 · D12) |
| 409    | "El PIN de este pedido ya fue utilizado"          | Todos los PINes del pedido tienen `used_at`            |
| 410    | "El PIN de este pedido expiró"                    | `created_at` + `pin_ttl_hours` vencido (R8.9 · D12)    |
| 401    | "PIN incorrecto"                                  | El hash del PIN no coincide                            |
| 429    | "Demasiados intentos fallidos para este pedido"   | 5 intentos fallidos en 60 segundos                     |
| 503    | "El sistema de PIN no está configurado"           | La hoja `_pin` no existe                               |

**Lógica de verificación:**

1. Lee la hoja `_pin` buscando filas para el `ref`
2. Lee la config del singleton (`pickpass_config`): si `pin_enabled` = NO → 404 (mismo contrato que «sin PIN», D12)
3. Si no hay PIN configurado → 404
4. Lee el estado del pedido: si no está PENDIENTE (ENTREGADO/CANCELADO) → 403 (R8.9)
5. Toma el PIN activo (más reciente con `used_at` vacío)
6. Si no hay PIN activo (todos usados) → 409
7. Comprueba el TTL: `created_at` + `pin_ttl_hours` (default 24 h) contra el reloj actual; vencido o sello ilegible → 410 (fail-closed, R8.9)
8. Cuenta intentos fallidos recientes (filas `__failed__` en 60 segundos)
9. Si >= 5 intentos → 429
10. Verifica el hash SHA-256 del PIN recibido contra `pin_hash` almacenado
11. Si no coincide → registra intento fallido y responde 401
12. Si coincide → marca `used_at` en la fila y responde 200

**Seguridad:**

- El PIN se hashea con SHA-256 (Props.hashText) - NUNCA comparación en texto plano
- El PIN recibido no se registra ni se loguea
- Rate-limit: 5 intentos por minuto (declarativo en `limits: '5/min'`)
- Ventana de intentos: 60 segundos (los intentos viejos no cuentan)
- Si el hook `pinHash` falló al crear, el pedido queda sin PIN y responde 404 (comportamiento seguro)

**Notas:**

- Acceso `public` - NO requiere token
- El PIN nunca viaja en claro en la respuesta
- Intentos fallidos se registran en `_pin` con hash `__failed__`

---

## 9. POST /admin/orders/:ref/actions/regenerate-pin - Regenerar PIN (admin)

**Declarado en:** `api/schema/resources/orders.js` (`actions['regenerate-pin']` → handler `handlePinRegenerate`, `api/capabilities/handlers/pin-regenerate.js`).

Regenera el PIN de un pedido sin recrearlo: es el remedio operativo de «pedido sin PIN recuperable» (R10). El PIN anterior deja de verificar (su fila activa queda `used_at`) y el nuevo pasa a ser el único activo.

**Request:**

```json
{
  "token": "tu-token-aqui",
  "method": "POST",
  "path": "/admin/orders/abc123/actions/regenerate-pin",
  "payload": {}
}
```

**Response:**

```json
{
  "action": "regenerate-pin",
  "affected": "abc123",
  "handler": "handlePinRegenerate",
  "result": {
    "ok": true,
    "ref": "abc123",
    "pin": "482913"
  }
}
```

- `result.pin` es el PIN nuevo **en claro**: la llamada es admin autenticado y el operador necesita el valor para reenviárselo al cliente (el detail-view lo sirve readonly con el mismo criterio).

**Errores:**

| Código | Descripción                              | Causa                          |
| ------ | ---------------------------------------- | ------------------------------ |
| 400    | "Falta la clave del registro en la ruta" | Parámetro `:ref` faltante      |
| 403    | "No autorizado"                          | Token inválido o sin rol admin |
| 404    | "No existe: abc123"                      | El pedido no existe            |
| 503    | "El sistema de PIN no está configurado"  | La hoja `_pin` no existe       |

**Transacción** (todo bajo el lock de política del recurso):

1. Genera el PIN nuevo (mismo transform `pin` que el create)
2. Registra su SHA-256 en `_pin` (fila activa nueva)
3. Actualiza la columna `pin` de la fila del pedido
4. Sustitución: las filas activas viejas de ESTE ref quedan con `used_at` (las `__failed__` y las de otros refs no se tocan)
5. Auditoría (`action:regenerate-pin`) + invalidación de caché del recurso

**Notas:**

- Escape hatch §6: el handler hace su propia auditoría y invalidación de caché (el dispatch de acciones no se las regala en esta ruta)
- Ventana de fallo residual: si el proceso muere entre los pasos 2 y 3, el PIN viejo recibe 401 y el nuevo verifica (fail-closed, nunca acepta algo que no debería)

---

## Metadata del recurso

**Configuración:**

- `kind`: collection
- `sheet`: orders
- `keyField`: ref
- `immutableKey`: true
- `titleField`: customer_name
- `ordering`: none
- `activeField`: null
- `onDelete`: restrict
- `dependents`: []
- `imageFolder`: orders
- `exposeToFront`: true

**Policies:**

- `access`: read='admin', write='admin'
- `cache.ttl`: 60 segundos
- `audit`: true
- `lock`: true

**Transforms en create:**

- `ref`: transform='token', from='customer_name'
- `pin`: transform='pin', from='customer_name'

**Hooks:**

- `create`: ['pinHash'] - Crea hash SHA-256 del PIN en `_pin`

**Checks:**

- `not-in-sheet`: sheet='_placeholders'
- `no-auth-after-delivered`
- `history-append-only`

**ListProjection (campos en listado):**

- ref, pin, customer_name, status, pickup_date, auth_state, created_at

**Views declaradas:**

- `pendientes`: count where status=PENDIENTE
- `entregados`: count where status=ENTREGADO
- `cancelados`: count where status=CANCELADO
- `pendientes_recientes`: limit 5, sort created_at desc, where status=PENDIENTE
