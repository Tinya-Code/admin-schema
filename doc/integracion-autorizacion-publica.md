# Integrar la autorización pública de retiro

El cliente consulta el pedido, verifica el PIN, obtiene una firma de carga y
envía el comando con el grant y una clave idempotente. El grant autoriza un
solo comando para un pedido; el cliente no necesita credenciales admin.

## Recorrido

En todos los pasos hacia Apps Script, envía un `POST` con el envelope JSON en
el cuerpo. `method` y `path` indican la ruta lógica; las respuestas de error
usan `body.error.status` aunque la respuesta HTTP sea 200.

### 1. Consultar el pedido

```json
{
  "method": "GET",
  "path": "/p/orders/ORD-123",
  "payload": {}
}
```

Respuesta exitosa de ejemplo:

```json
{
  "ref": "ORD-123",
  "customer_name": "Juan Pérez",
  "description": "Paquete frágil",
  "pickup_date": "2026-10-10",
  "status": "PENDIENTE",
  "reference_photo": "https://res.cloudinary.com/<cloud>/image/upload/v1/orders/ref.jpg",
  "authorized_name": "",
  "authorized_photo": "",
  "auth_state": "NINGUNO",
  "created_at": "2026-10-05T10:00:00Z",
  "updated_at": "2026-10-05T10:00:00Z"
}
```

La respuesta pública no incluye el PIN, notas internas ni el historial
completo.

### 2. Verificar el PIN y conservar el grant

```json
{
  "method": "POST",
  "path": "/p/pin/ORD-123",
  "payload": { "pin": "123456" }
}
```

Respuesta exitosa:

```json
{
  "ok": true,
  "ref": "ORD-123",
  "grant": "<grant-opaco>",
  "expires_at": "2026-10-11T12:15:00.000Z"
}
```

Conserva el grant sólo en memoria mientras dure el flujo; no lo pongas en
URLs, logs, analytics ni almacenamiento persistente del navegador.

### 3. Solicitar una firma para `pickupPhoto`

```json
{
  "method": "POST",
  "path": "/p/uploads/signature/pickupPhoto",
  "payload": { "grant": "<grant>" }
}
```

La respuesta de ejemplo contiene sólo parámetros generados por el servidor:

```json
{
  "cloud_name": "<cloud>",
  "api_key": "<public-api-key>",
  "timestamp": 1791711000,
  "signature": "<firma-cloudinary>",
  "folder": "public-api/pickup",
  "public_id": "public-api/pickup/<asset-id>",
  "allowed_formats": "jpg,jpeg,png,webp",
  "upload_url": "https://api.cloudinary.com/v1_1/<cloud>/image/upload",
  "expires_at": "2026-10-11T12:15:00.000Z"
}
```

Usa los campos devueltos (`upload_url`, `api_key`, `timestamp`, `signature`,
`folder`, `public_id` y `allowed_formats`) para subir directamente a
Cloudinary. No cambies los parámetros firmados. Conserva la respuesta completa
del proveedor para el paso siguiente.

La respuesta firmada por Cloudinary debe incluir al menos `public_id`,
`secure_url`, `format`, `bytes`, `version` y `signature`; esos valores se
envían dentro de `input.photo` en el paso 4.

Respuesta del proveedor, reducida a los campos que consume el backend:

```json
{
  "public_id": "public-api/pickup/<asset-id>",
  "secure_url": "https://res.cloudinary.com/<cloud>/image/upload/v123/public-api/pickup/<asset-id>.png",
  "format": "png",
  "bytes": 184320,
  "version": 123,
  "signature": "<firma-de-respuesta-cloudinary>"
}
```

La firma tiene vigencia limitada por el grant y el perfil. Si expira, solicita
otra firma mientras el grant siga activo. Las solicitudes de firma no consumen
el grant del comando.

### 4. Registrar el responsable y la carga verificada

Genera una clave aleatoria de 16–128 caracteres por acción lógica y reutilízala
sin cambios si debes reintentar esa misma petición.

```json
{
  "method": "POST",
  "path": "/p/orders/ORD-123/commands/register-pickup-person",
  "payload": {
    "grant": "<grant>",
    "idempotencyKey": "client-generated-random-key-001",
    "input": {
      "authorized_name": "Ana Pérez",
      "photo": {
        "public_id": "public-api/pickup/<asset-id>",
        "secure_url": "https://res.cloudinary.com/<cloud>/image/upload/v123/public-api/pickup/<asset-id>.png",
        "format": "png",
        "bytes": 184320,
        "version": 123,
        "signature": "<signature-de-la-respuesta-cloudinary>"
      }
    }
  }
}
```

`photo` es opcional. Si no se adjunta una foto nueva, omite ese campo: un
reemplazo de responsable conserva la foto anterior. El servidor verifica la
firma del proveedor, el `public_id` emitido para ese grant, la URL, el formato,
el tamaño y la expiración; nunca uses una URL suministrada por el cliente como
fuente de verdad.

### 5. Confirmar

Respuesta exitosa de ejemplo:

```json
{
  "ok": true,
  "ref": "ORD-123",
  "authorized_name": "Ana Pérez",
  "authorized_photo": "https://res.cloudinary.com/<cloud>/image/upload/v123/public-api/pickup/<asset-id>.png",
  "auth_state": "ACTIVA"
}
```

`authorized_photo` se omite si no se adjuntó foto nueva y el pedido no tenía
una anterior. También puedes volver a consultar el pedido público para mostrar
el estado persistido.

## Errores y reintentos

| `error.status` | Códigos comunes                                                                              | Acción del cliente                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 401            | `PIN_INVALID`, `GRANT_INVALID`, `GRANT_REQUIRED`                                             | Corregir el PIN o volver a verificarlo; no repetir ciegamente.                                                          |
| 403            | `ORDER_NOT_ELIGIBLE`, `GRANT_SCOPE_MISMATCH`, `UPLOAD_SCOPE_MISMATCH`                        | Detener el flujo: pedido, grant, firma y comando no coinciden.                                                          |
| 409            | `GRANT_IN_PROGRESS`, `GRANT_CONSUMED`, `IDEMPOTENCY_CONFLICT`, `COMMAND_PRECONDITION_FAILED` | Repetir sólo la misma petición pendiente con la misma clave; para otro intento se requiere un grant nuevo.              |
| 410            | `PIN_EXPIRED`, `GRANT_EXPIRED`, `UPLOAD_EXPIRED`                                             | Reiniciar desde una verificación PIN válida.                                                                            |
| 422            | `VALIDATION_*`, `UPLOAD_TOO_LARGE`, `UPLOAD_FORMAT_NOT_ALLOWED`                              | Corregir los datos o cargar un archivo permitido; una carga rechazada no actualiza el pedido.                           |
| 429            | `RATE_LIMITED`                                                                               | Esperar a que termine la ventana indicada por el servicio antes de volver a intentar.                                   |
| 500/503        | errores de configuración o proveedor                                                         | No crear otra acción con clave nueva. Reintentar la misma operación sólo si la solicitud previa puede haberse aplicado. |

Un replay con la misma clave y el mismo contenido devuelve el resultado
persistido. La misma clave con otro contenido responde `409
IDEMPOTENCY_CONFLICT`. El token admin nunca es necesario para este flujo.

## Límites conocidos

- El perfil acepta JPEG, PNG y WebP, con un máximo de 10 MiB. El motor verifica
  `bytes` al aceptar la respuesta de Cloudinary; no afirma que la firma actual
  impida que Cloudinary reciba o almacene temporalmente un archivo mayor.
- Sheets no ofrece transacciones ACID. El motor registra operaciones
  recuperables, reserva grants bajo lock y deduplica eventos; no promete
  rollback entre las hojas.
- El frontend de muestra ya implementa el flujo contra este contrato y su build
  local pasa. La compatibilidad con Apps Script y una carga real siguen
  pendientes de probar después de desplegar esta versión backend.

## Despliegue y reversión

1. Validar y desplegar primero el backend que contiene comandos, perfiles y
   endpoints públicos; ejecutar `setupAuth_` para asegurar las propiedades de
   autenticación/grants y `setupDrift` para crear o actualizar las hojas
   auxiliares declaradas.
2. Confirmar el contrato desplegado con PIN de prueba y una carga autorizada
   antes de publicar el cliente que presenta el nuevo formulario.
3. Para revertir el cliente, volver a publicar el frontend anterior o retirar
   el formulario. No borrar las hojas `_domain_*` ni el secreto de grants:
   pueden ser necesarios para auditar y resolver operaciones en curso.
4. No retirar el backend ni sus hojas mientras existan grants u operaciones
   recuperables. No se describe la reversión como rollback ACID.
