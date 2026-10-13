# Propuesta: flujos de dominio declarativos en el motor API

**Recomendación:** sí es viable permitir que una persona pública registre a
quien recogerá un pedido, pero no conviene resolverlo agregando endpoints y
handlers exclusivos para `orders`. El caso debe servir para definir y probar
primitivas reutilizables del motor: comandos de dominio declarados en schemas,
credenciales temporales de alcance limitado, cargas de archivos vinculadas a
un flujo y escrituras idempotentes.

El pedido es un caso de uso de esa capacidad, no el modelo de arquitectura. El
objetivo no es prometer que cualquier flujo se construya sin código: el schema
debe declarar reglas y contratos; el motor ejecuta primitivas conocidas, y los
adaptadores de infraestructura encapsulan proveedores externos.

## Resumen ejecutivo

| Decisión         | Propuesta                                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unidad del flujo | Un **comando de dominio** con entrada, precondiciones, autorización, cambios permitidos, eventos y respuesta.                                                  |
| Configuración    | Declarar en schemas los datos, las políticas y la composición de primitivas ya soportadas. No escribir un handler por recurso para lógica común.               |
| Extensibilidad   | Reservar handlers/capabilities para comportamientos que no se puedan expresar con primitivas seguras; no convertir cada caso de uso en una función imperativa. |
| Acceso público   | No abrir CRUD público. Permitir que un comando requiera una concesión temporal, limitada por recurso, registro, comando, expiración y uso.                     |
| Archivos         | Declarar perfiles de carga en schema y delegar firma/verificación a un adaptador de almacenamiento, inicialmente Cloudinary.                                   |
| Consistencia     | Definir idempotencia y recuperación explícita. Sheets no ofrece transacciones ACID entre pedido, historial, concesión y estado de carga.                       |
| Caso PickPass    | Modelar la asignación del responsable como un comando público autorizado por una concesión obtenida al validar el PIN.                                         |

## Qué permite el motor hoy y qué falta

El motor ya proporciona piezas generales, pero aún no compone el flujo completo
de extremo a extremo:

| Capacidad existente            | Límite actual frente al flujo                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recursos y campos declarativos | `orders` ya declara persona autorizada, foto, estado e historial.                                                                                                                     |
| CRUD derivado de recursos      | La audiencia pública de `orders` sólo tiene `get`. Habilitar `update` no restringiría el cambio a los campos de autorización.                                                         |
| Acciones de dominio            | Aceptan `from`/`set` o un handler registrado. La ruta de acciones usa la política de escritura del recurso y no define una concesión pública ni un contrato propio de entrada/salida. |
| Endpoints declarativos         | Permiten declarar ruta, método lógico, acceso, rate limit, `input` y `output`; los handlers siguen siendo código.                                                                     |
| Checks y transiciones          | Permiten validaciones y cambios de estado genéricos en operaciones CRUD. No representan por sí solos un flujo multi-paso con credencial temporal y carga pendiente.                   |
| Hooks y eventos                | Reaccionan a escrituras; un hook post-escritura no es una transacción ni un mecanismo de autorización previo.                                                                         |
| Firma Cloudinary               | El endpoint existente requiere admin y firma una carga para la carpeta general del recurso; no queda vinculada a un grant ni a un comando.                                            |
| PIN de pedido                  | `POST /p/pin/:ref` valida y consume el PIN, y responde `{ ok, ref }`. No emite actualmente una concesión temporal.                                                                    |

**Conclusión:** el objetivo coincide con el diseño del motor, pero requiere una
extensión genérica de sus contratos y runtime. No es correcto describir los
nuevos endpoints como si ya fueran configurables sólo con los schemas actuales.

## Modelo conceptual

El motor debería poder expresar un flujo como una secuencia de **comandos**
declarativos. Cada comando es una operación de dominio acotada, distinta del
CRUD y del endpoint HTTP:

1. **Resolver** el recurso y el registro objetivo.
2. **Autorizar** al principal configurado: sesión, acceso público limitado o
   una concesión temporal.
3. **Validar** `input` y precondiciones contra el estado actual.
4. **Ejecutar** cambios permitidos mediante operaciones conocidas por el motor.
5. **Registrar** eventos/historial, auditoría e invalidación de caché con
   políticas explícitas.
6. **Responder** con `output` declarado y un resultado estable para los
   reintentos.

El schema describe **qué** se permite y el motor define **cómo** se aplica.
Los endpoints son una forma de transporte del comando, no el lugar donde se
duplica la regla de negocio.

### Componentes genéricos que harían falta

#### 1. Comandos de recurso con contrato propio

Extender las acciones actuales o incorporar una declaración equivalente para
que cada comando pueda declarar:

- `input` y `output` validados por el contrato de endpoint;
- audiencia/política de acceso independiente de la política CRUD;
- precondiciones expresables con el vocabulario seguro existente;
- campos que puede modificar y origen de sus valores (entrada validada,
  constante permitida o valor generado por el motor);
- eventos de dominio que se agregan con la mutación;
- rate limit e idempotencia;
- efecto esperado ante una concesión: sólo validar, reservar o consumir al
  completar.

El comando debe seguir resolviéndose desde la declaración del recurso y quedar
expuesto en el schema público/admin según su audiencia. Un handler custom puede
seguir existiendo como escape hatch, pero no debe ser necesario para una
combinación común de validación + cambio de campos + evento.

#### 2. Concesiones temporales de capacidad

Una concesión (grant) es una credencial opaca que autoriza una capacidad
específica; no es una sesión admin ni un token genérico. El contrato común
debería permitir declarar:

- quién o qué mecanismo puede emitirla (por ejemplo, verificación de PIN);
- recurso, clave del registro y comando permitido;
- expiración, número de usos y límites de intentos;
- estado de la concesión y consumo/reserva;
- almacenamiento sólo del hash del secreto;
- vínculo de una carga a esa misma concesión cuando el flujo lo requiera.

La autenticación debe ser una política del comando. El handler no debería
implementar su propio formato de token ni consultar una hoja privada mediante
lógica copiada por cada recurso.

#### 3. Perfiles de carga reutilizables

Un perfil de carga declarativo debería fijar proveedor, tipos permitidos,
tamaño máximo, carpeta/namespace, duración y la capacidad requerida. Un
adaptador común emite la firma y valida después el resultado contra el
proveedor.

El cliente no elige la carpeta ni puede declarar como verdadero un `public_id`,
URL, MIME o tamaño. La referencia aceptada por el comando final debe ser
verificada por el backend y estar ligada al mismo registro y grant. El perfil
puede tener implementación específica del proveedor; la regla de autorización
y su contrato no deben quedar acoplados a `orders`.

#### 4. Persistencia recuperable, no promesas de transacción

El motor debe ofrecer una primitiva reusable para coordinar una mutación con
eventos, grants y referencias de carga. Con Sheets no se puede prometer una
transacción ACID entre varias hojas. El contrato debe elegir una estrategia:

- operación idempotente identificada por una clave estable;
- estados persistidos de preparación, finalización y fallo recuperable;
- lock sobre la entidad o alcance correspondiente;
- deduplicación de eventos y efectos;
- respuesta repetible después de perder la respuesta HTTP.

La concesión no debe quedar consumida sin que exista un resultado recuperable,
ni quedar reutilizable después de que el comando terminó. La secuencia concreta
y el tratamiento de fallos parciales son parte del diseño del runtime, no una
garantía que pueda resolver el schema por sí solo.

## DSL mínimo acordado para Fase 1

El DSL queda definido y validado al cargar el registro; **todavía no ejecuta
comandos ni crea rutas**. El dispatch y la persistencia se implementan en las
fases siguientes. El ejemplo usa `orders` para verificar que las primitivas
genéricas alcanzan el caso real, no para agregar una rama especial al motor:

```js
REGISTRY.grantProfiles.pickupGrant = {
  purpose: 'register-pickup-person',
  issuedBy: 'pinVerify',
  resource: 'orders',
  command: 'registerPickupPerson',
  keyParam: 'ref',
  ttlSeconds: 900,
  maxUses: 1,
  consume: 'on-success',
};

REGISTRY.uploadProfiles.pickupPhoto = {
  provider: 'cloudinary',
  resource: 'orders',
  grant: 'pickupGrant',
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxBytes: 10 * 1024 * 1024,
  ttlSeconds: 300,
  namespace: 'pickup-person',
};

REGISTRY.endpoints.pinVerify.issuesGrant = 'pickupGrant';

REGISTRY.resources.orders.commands = {
  registerPickupPerson: {
    input: {
      authorized_name: { type: 'text', required: true, maxLength: 80 },
      photo: { type: 'upload', profile: 'pickupPhoto', required: true },
    },
    output: { ok: { type: 'boolean', required: true } },
    access: 'public',
    grant: 'pickupGrant',
    limits: '5/min',
    preconditions: [
      { field: 'status', op: 'eq', value: 'PENDIENTE' },
      { field: 'auth_state', op: 'in', value: ['NINGUNO', 'REVOCADA'] },
    ],
    changes: {
      authorized_name: { from: 'input.authorized_name' },
      authorized_photo: { from: 'input.photo' },
      auth_state: { value: 'ACTIVA' },
      updated_at: { generated: 'now' },
    },
    events: [
      {
        appendTo: 'history',
        values: {
          action: { value: 'AUTORIZADO' },
          detail: { from: 'input.authorized_name' },
        },
      },
    ],
    errors: [
      { status: 409, code: 'ALREADY_AUTHORIZED', message: 'El pedido ya tiene autorización.' },
    ],
    idempotency: 'required',
  },
};
```

`pinVerify` debe declarar `issuesGrant`; el validador comprueba el enlace
bidireccional entre endpoint, perfil y comando, que `keyParam` sea un parámetro
requerido de la ruta y que el grant quede ligado a un solo recurso/comando.
`consume: 'on-success'` fija la política acordada en F0. El token del grant no
se persiste ni se proyecta como metadato de configuración.

Las referencias de cambio/evento sólo admiten `{ from: 'input.campo' }`,
`{ value: constante }` o `{ generated: 'now' | 'key' | 'actor' }`. El validador
rechaza rutas dinámicas, campos inexistentes, asignaciones incompatibles,
estados fuera de enum y claves desconocidas. Los perfiles de carga refieren un
adaptador registrado y el mismo grant/recurso que el comando.

La proyección de `/admin/schema` publica el contrato consumible (input, output,
errores y límites de carga), pero omite handler, grant/profile IDs, cambios,
precondiciones, eventos, provider, namespace y demás reglas internas. El
contrato no anuncia una ruta hasta que Fase 2 implemente el router.

El diseño final debe reutilizar tipos, validadores y mecanismos ya existentes
cuando cubran la necesidad; no crear un mini lenguaje alternativo para
expresiones arbitrarias. Toda forma declarativa nueva debe validarse al cargar
el registro y fallar cerrado ante operaciones, campos, grants o proveedores
desconocidos.

## Rutas y transporte del motor actual

El transporte existente manda todas las operaciones como HTTP `POST` a
`API_URL`, con `Content-Type: text/plain` y el método lógico en el envelope.
`path` es una ruta lógica del router.

El router actual sólo reconoce un parámetro de endpoint cuando está al final
(`.../:ref`). Por tanto, hasta que exista soporte declarativo para enrutar
comandos con otro patrón, las formas compatibles serían similares a:

| Operación conceptual             | Ruta compatible con el router actual                           |
| -------------------------------- | -------------------------------------------------------------- |
| Emitir grant al validar PIN      | `POST /p/pin/:ref` (endpoint existente que requiere extensión) |
| Solicitar firma                  | `POST /p/authorization-upload/:ref` (endpoint nuevo)           |
| Ejecutar comando de autorización | `POST /p/authorization/:ref` (endpoint nuevo)                  |

Estas rutas son ejemplos de transporte y no implican que el dominio deba
definirse por nombres de URL. Si el motor incorpora un router genérico de
comandos, su contrato debe resolver de forma inequívoca método, recurso,
comando y clave, y mantener compatibilidad o versionado de las rutas existentes.

No se debe reutilizar `POST /admin/orders/:ref/actions/...` como endpoint
público: hoy las acciones heredan la política de escritura admin del recurso.
Tampoco se debe habilitar `update` en la audiencia pública; una operación CRUD
genérica no expresa una escritura selectiva por propósito.

## Aplicación al recurso `orders`

Con las primitivas anteriores, el schema de pedidos podría declarar:

- un emisor de grant que valida el PIN vigente para `ref`, con límites de
  intentos y una concesión asociada al comando de registro;
- un perfil de carga que requiere ese grant y restringe la foto;
- un comando que sólo permite registrar a una persona cuando el pedido es
  elegible, actualiza campos de autorización y emite un evento;
- una audiencia pública de lectura que expone sólo lo necesario para consultar
  el pedido y confirmar el resultado.

`orders` ya declara `authorized_name`, `authorized_photo`, `auth_state` y
`history`; `ACTIVA`, `REVOCADA`, `NINGUNO`, `AUTORIZADO` y
`AUTORIZADO_CAMBIADO` existen en sus enums. El diseño debe decidir la regla de
negocio al existir una autorización previa, y si la foto es obligatoria; no
inferirlo del schema.

La superficie pública actual devuelve `history` además del estado y datos del
pedido. Antes de usarla para esta página, confirmar si cada evento y detalle
histórico debe ser público; excluir campos no necesarios mediante la whitelist
de `audiences.public`.

## Errores que debe declarar el contrato

Los errores de aplicación se reciben en `{ error: { status, message, code?,
errors? } }`; Apps Script responde HTTP 200. La especificación del comando y de
sus mecanismos debe distinguir al menos:

| Estado funcional | Caso genérico                                                                           |
| ---------------- | --------------------------------------------------------------------------------------- |
| 401              | PIN incorrecto o credencial inválida, sin filtrar información de otro registro.         |
| 403              | Una regla de negocio impide ejecutar el comando para este estado.                       |
| 404              | Recurso, registro o comando inexistente/no disponible.                                  |
| 409              | El estado cambió desde la lectura, operación ya completada o conflicto de idempotencia. |
| 410              | Grant o carga temporal vencida.                                                         |
| 422              | Entrada inválida o precondición declarativa corregible, con `errors[]` y paths.         |
| 429              | Rate limit o intentos excedidos.                                                        |
| 500/503          | Fallo interno o proveedor/almacenamiento no disponible.                                 |

El error específico y su `code` deben formar parte de la metadata declarativa o
del catálogo de errores del motor; no quedar sólo en el Markdown o duplicados
entre frontend y handler.

## Plan de diseño e implementación

1. **Definir el contrato conceptual:** vocabulario, alcance y compatibilidad de
   comandos, grants, cargas e idempotencia. No empezar por nombres de endpoint
   del caso PickPass.
2. **Diseñar la extensión mínima de schema:** formas tipadas y limitadas, con
   validación eager; separar transporte, autorización, mutación y eventos.
3. **Implementar primitivas compartidas:** resolver/validar comando, comprobar
   grant, lock, operación recuperable, evento, auditoría e invalidación.
4. **Implementar el adaptador de carga:** Cloudinary primero, manteniendo su
   protocolo real detrás de una interfaz reusable.
5. **Migrar el caso `orders`:** declarar el PIN como emisor de grant y la
   asignación del responsable como comando/configuración, evitando código de
   negocio exclusivo en el handler.
6. **Probar propiedades del motor:** autorización cruzada entre registros,
   replay, concurrencia, expiración, fallos parciales, validación de salida,
   permisos de CRUD y visibilidad pública.
7. **Generar contratos y documentar:** API docs desde schemas; frontend
   consume el contrato publicado y nunca necesita token admin.

## Criterios para considerar el diseño general

- [ ] Un segundo recurso puede declarar un comando equivalente sin agregar un
      handler específico por recurso.
- [ ] Los permisos de un grant no pueden ampliarse cambiando el `ref`, recurso
      o comando desde el cliente.
- [ ] El CRUD público conserva sus permisos actuales; el comando autoriza sólo
      los cambios declarados.
- [ ] Entrada, salida y errores se validan desde schemas y se exponen en la
      documentación generada.
- [ ] Los proveedores de carga se pueden intercambiar sin modificar el comando
      de dominio ni los contratos del frontend.
- [ ] Reintentos, requests concurrentes y fallos entre escrituras tienen
      resultados definidos y pruebas de regresión.
- [ ] La funcionalidad nueva no exige conocimiento específico de PickPass para
      arrancar el motor ni para construir otras APIs.

## Decisiones pendientes antes de fijar el DSL

- ¿Una concesión permite sólo un comando o varios pasos de un flujo? La propuesta
  favorece un propósito y comando concretos; la firma de carga debe estar dentro
  de ese mismo alcance.
- ¿Foto obligatoria u opcional? ¿Qué tamaño máximo y formatos acepta producto?
- ¿Qué hacer cuando ya existe una persona autorizada: reemplazo permitido,
  rechazo o revocación previa?
- ¿Cuánto dura el grant y cómo recuperar un PIN consumido si falla la emisión?
- ¿Qué garantía de idempotencia puede ofrecer el backend con su almacenamiento
  actual?
- ¿Qué campos y eventos del pedido deben ser visibles en la audiencia pública?

Estas decisiones afectan reglas de producto o garantías de almacenamiento; el
schema debe declararlas una vez acordadas, no elegirlas implícitamente.

## Referencias del motor actual

- [Recurso `orders`](../api/schema/resources/orders.js)
- [Verificación de PIN](../api/schema/endpoints/pin-verify.js)
- [Handler de verificación](../api/capabilities/handlers/pin-verify.js)
- [Lectura pública](../api/schema/endpoints/public-order.js)
- [Firma de carga admin](../api/schema/endpoints/upload-signature.js)
- [Handler de firma Cloudinary](../api/capabilities/handlers/upload-signature.js)
- [Resolución de rutas](../api/core/10-router.js)
- [Acciones declarativas y escape hatch](../api/engine/28-actions.js)
- [Eventos y hooks](../api/engine/30-events.js)
