# Plan de implementación: flujos de dominio declarativos

> **Objetivo:** extender el motor para que un agente pueda declarar flujos de
> dominio seguros y completos en schemas, y demostrarlo con la autorización
> pública de una persona que recoge un pedido. El frontend externo consumirá
> contratos publicados por el backend; no recibirá lógica especial ni
> credenciales admin.
>
> **Estado:** Fase 0 y Fase 1 completas; el runtime aún no ejecuta comandos,
> grants ni cargas. Marcar una casilla sólo después de implementar y verificar
> su criterio de salida.
>
> **Documento de contexto:** [`otrorepopublico.md`](./otrorepopublico.md).

## Instrucciones para el agente ejecutor

- Ejecuta las fases en orden. No empieces a implementar endpoints de PickPass
  antes de cerrar las decisiones de contrato y persistencia de las fases 0–1.
- Una casilla puede cerrarse sólo si su **resultado** está presente en código,
  pruebas o documentación, y el gate indicado pasa.
- Mantén el motor genérico: ninguna condición `orders`, `pickpass` o
  `authorized_*` debe añadirse a `core/`, `engine/` ni a un dispatcher común.
- La lógica repetible debe declararse en schemas y ejecutarse mediante
  primitivas compartidas. Los handlers específicos sólo son aceptables como
  adaptadores de infraestructura o escape hatch documentado.
- Lee y respeta trabajo no relacionado que ya esté en el worktree; nunca
  reviertas cambios ajenos.
- Apps Script y Sheets no ofrecen transacciones ACID entre hojas. No afirmes
  atomicidad. Implementa estados recuperables, lock e idempotencia, y prueba
  fallos entre escrituras.
- No abras el CRUD público de un recurso para lograr una mutación acotada.
- No despliegues Apps Script ni publiques cambios remotos sin una petición
  explícita.
- Actualiza `doc/api-endpoints.md` mediante `npm run api:doc`; no lo edites a
  mano. Actualiza este plan sólo al completar tareas verificadas.

### Definición de terminado por tarea

Una tarea queda lista cuando:

1. su cambio está cubierto con pruebas focalizadas, incluyendo el caso negativo;
2. las declaraciones inválidas fallan al cargar/validar el registro;
3. los contratos y documentación generada reflejan el comportamiento real;
4. pasa el gate específico de la fase y no se introducen regresiones conocidas.

## Alcance

### Incluido

- Contrato schema-first para comandos de dominio con `input`, `output`,
  políticas, precondiciones, cambios permitidos, eventos y errores.
- Grants temporales y de alcance limitado para autorizar comandos públicos.
- Primitivas de idempotencia y recuperación adecuadas a Sheets.
- Perfiles de carga y adaptador Cloudinary que vinculen la carga con grant,
  recurso y registro.
- Migración del caso `orders`: verificación PIN, registro de responsable,
  lectura pública y carga de foto.
- Contrato de integración que el otro frontend pueda consumir y verificaciones
  de seguridad/paridad.

### Fuera de alcance

- Reescribir CRUD, autenticación admin o el transporte HTTP completo.
- Construir una interfaz pública en este repositorio si vive en otro repo.
- Añadir un sistema genérico de workflows arbitrarios, scripting en schemas o
  expresiones ejecutables.
- Crear una garantía ACID que el almacenamiento actual no puede proporcionar.
- Desplegar el backend a Apps Script.

## Contrato de trabajo esperado

El resultado final debe ser consumible por el frontend con el envelope que ya
usa el motor:

```json
{
  "token": "<sólo para rutas protegidas>",
  "method": "POST",
  "path": "<ruta lógica publicada>",
  "payload": {}
}
```

Todas las llamadas HTTP son `POST` a `API_URL` con `Content-Type: text/plain`.
Las rutas públicas omiten `token`. Las respuestas exitosas son JSON plano; los
errores funcionales se leen de `body.error.status`, incluso si HTTP responde 200. La forma y nombres definitivos de las rutas se congelan en la fase 0 y se
publican en la referencia generada.

El frontend externo debe recibir del agente un contrato verificable con:

- ruta lógica, método lógico, acceso y límites de cada operación;
- payload requerido y respuesta de éxito;
- errores funcionales, códigos estables y campos de validación;
- reglas de expiración, reintento e idempotencia;
- parámetros de carga Cloudinary y cómo confirmar una carga completada.

## Fases y tareas

## Fase 0 — Contrato y decisiones de producto

**Objetivo:** evitar codificar reglas o rutas que el otro frontend no puede
consumir o que producto todavía no eligió.

- [x] **F0.1 — Confirmar el contrato de consumo con el frontend externo**
  - Revisado `/Users/alejandro/Desktop/Estudio/muestra`: `src/pages/p/[ref].astro`,
    `src/components/order/PinVerify.astro`, `src/utils/api.ts` y sus documentos
    de API.
  - La UI implementada consulta `GET /p/orders/:ref` y verifica PIN con
    `POST /p/pin/:ref`; todavía no implementa carga ni alta/cambio de la
    persona autorizada.
  - El documento `doc/public-pickup-authorization-api.md` del frontend propone
    grant + carga + guardado, pero exige foto y propone
    `/p/authorization/:ref/upload`, incompatible con el resolver actual. Este
    contrato se reemplaza por las decisiones de F0.2–F0.3; no se modificó el
    repo frontend ni sus cambios de worktree.
  - El cliente normaliza errores desde `body.error.status` y admite respuestas
    planas o `{ data }`; la API backend actual devuelve éxito plano y HTTP 200
    para errores de aplicación. Su rate limit local sólo es UX; la autoridad
    sigue siendo el límite backend.
  - **Resultado:** necesidades observadas y brecha de integración documentadas;
    la tarea de frontend queda fuera de este repositorio.
- [x] **F0.2 — Cerrar reglas del caso PickPass**
  - Foto opcional. Si se adjunta: `jpg`, `jpeg`, `png`, `webp`, máximo
    `10 * 1024 * 1024` bytes, validado por backend/proveedor.
  - Si ya hay autorización `ACTIVA`, sólo se permite reemplazarla con un nuevo
    PIN verificado y un grant nuevo; alta registra `AUTORIZADO`, reemplazo
    registra `AUTORIZADO_CAMBIADO`.
  - Cada grant autoriza una sola ejecución exitosa del comando. El grant puede
    solicitar las operaciones de carga necesarias hasta su expiración.
  - TTL declarativo/configurable, con `15 min` como valor inicial; incluir
    `expires_at` en la respuesta.
  - **Resultado:** reglas confirmadas por el usuario el 2026-10-11.
- [x] **F0.3 — Elegir el contrato de routing para comandos**
  - Decisión: ruta estándar por recurso
    `/<scope>/<resource>/:key/commands/<command>`. Para PickPass:
    `POST /p/orders/:ref/commands/register-pickup-person`.
  - Se debe ampliar el resolver genérico para resolver el parámetro intermedio
    y el comando desde declaraciones de schemas; no añadir una ruta/condición
    especial para `orders`.
  - El prefijo de comandos se declara opcionalmente como `commandsRoute` cuando
    difiere de la ruta CRUD del recurso; no cambia el montaje del CRUD.
  - Conservar `POST /p/pin/:ref` como emisor de grant. La solicitud de firma
    usa `POST /p/uploads/signature/:profile`; el grant vincula recurso y
    registro, por lo que éstos no se aceptan como autoridad desde el cliente.
  - La UI actual del frontend llama al PIN existente; se deberá acordar la
    transición al comando estándar antes de integrar el formulario nuevo.
  - **Resultado:** patrón elegido por el usuario el 2026-10-11. Las rutas nuevas
    son contratos objetivo, no rutas desplegadas.
- [x] **F0.4 — Elegir persistencia y estados recuperables**
  - Decisión: usar Google Sheets y declarar las hojas internas en
    `AUX_SHEETS`, migradas mediante `setupDrift`; no introducir un datastore
    externo en esta mejora.
  - Hojas genéricas objetivo: `_domain_grants` (hash del secreto, purpose,
    resource/key/command, estado, expiración/uso), `_domain_uploads` (grant,
    provider asset, estado/expiración) y `_domain_operations` (hash de clave
    idempotente/request, estado, resultado repetible y timestamps).
  - Estados mínimos: grant `issued/reserved/consumed/expired/revoked`;
    upload `issued/completed/accepted/expired/rejected`;
    operation `prepared/applying/completed/recoverable/failed`.
  - Cambios de estado y comandos se serializan con `LockService`; PIN/grant y
    clave idempotente se almacenan sólo como hashes. El fingerprint del request
    será HMAC con secreto de servidor (no hash simple, porque el PIN tiene baja
    entropía). El resultado de operación no guarda secretos en claro.
  - Para que un retry de emisión pueda recuperar el mismo grant sin persistir
    el bearer secret, el contrato de F1/F3 debe derivarlo de un id aleatorio
    persistido y un HMAC con secreto de servidor dedicado en Script Properties;
    almacenar y verificar también su hash ligado a purpose, resource, key,
    command y expiración. Reintentos con la misma clave/request devuelven el
    mismo resultado; misma clave con otro contenido da conflicto.
  - Definir retención/limpieza antes de producción; ninguna limpieza puede
    borrar operaciones todavía requeridas para recuperar retries.
  - **Límite:** Sheets no ofrece transacción ACID. El journal debe permitir
    detectar/reanudar operaciones parciales y deduplicar eventos; cada frontera
    de fallo se prueba. El mecanismo no se describirá como rollback.
  - **Resultado:** estrategia aceptada por el usuario el 2026-10-11.
- [x] **F0.5 — Registrar decisiones de arquitectura**
  - Las decisiones, compatibilidad frontend/backend y rutas objetivo quedan
    registradas arriba. Los errores se conservan como
    `{ error: { status, message, code?, errors? } }`, con status funcional en
    el JSON aunque HTTP sea 200; los contratos finales se completarán desde
    schemas.
  - **Gate F0:** decisiones de producto y arquitectura cerradas. F0 completo;
    empezar F1 usando estas decisiones y reabrirlas sólo si la inspección de
    implementación demuestra una incompatibilidad concreta.

## Fase 1 — Modelo declarativo y validación de schemas

**Objetivo:** especificar el DSL mínimo que compone capacidades existentes,
sin crear un lenguaje general de ejecución.

### Contrato cerrado en F1

- `commands` es una declaración separada de `actions`, anidada por recurso y
  validada al cargar. Cada comando declara input/output planos, access, grant
  opcional, límites, precondiciones, cambios, eventos, errores, idempotencia
  (`required | optional | none`) y, sólo como escape hatch, un handler
  registrado incompatible con cambios/eventos/precondiciones DSL.
- Las únicas referencias de valor son `{ from: 'input.campo' }`,
  `{ value: constante }` y `{ generated: 'now' | 'key' | 'actor' }`.
  El validador comprueba campos, tipos, enums y que no se muten claves,
  secretos o campos inmutables.
- `REGISTRY.grantProfiles` liga un endpoint emisor, propósito, recurso, comando,
  parámetro de clave, TTL, máximo de usos y `consume: 'on-success'`. El
  endpoint también declara `issuesGrant`; ambas direcciones deben coincidir.
  Los límites de emisión viven en el endpoint y los del comando en `limits`.
- `REGISTRY.uploadProfiles` declara adaptador registrado, recurso, grant, MIME
  types, máximo de bytes, TTL y namespace seguro. El provider, namespace y
  vínculo al grant son configuración interna, no parte de la proyección.
- `/admin/schema` publica sólo el contrato consumible del comando y expone
  `grantRequired: boolean`; no filtra IDs/configuración de grants, handlers,
  cambios, precondiciones, eventos ni detalles de storage. La ruta del comando
  se documenta en `doc/api-endpoints.md` a partir de `commandsRoute` y de la
  resolución implementada en Fase 2; no se incluye configuración interna en la
  proyección de schema.
- El token opaco, su hash, reserva, consumo efectivo e idempotencia persistida
  se implementan en Fase 3, por separado de la validación declarativa de F1.

- [x] **F1.1 — Definir `commands` (o extensión compatible de `actions`)**
  - Declarar id, `input`, `output`, audiencia/acceso, límites, precondiciones,
    cambios permitidos, eventos, errores e idempotencia.
  - Separar el contrato del comando de su transporte/router.
  - Mantener handler custom como escape hatch tipado y explícito.
- [x] **F1.2 — Definir referencias de valor permitidas**
  - Especificar un conjunto cerrado, como campo validado de input, constante
    declarada y valor generado por el motor (`now`, key, actor si aplica).
  - Rechazar rutas de propiedad desconocidas, evaluación dinámica y valores
    procedentes de campos no autorizados.
- [x] **F1.3 — Definir grants declarativos**
  - Contrato para emisor, propósito, recurso, key, comando permitido, TTL,
    usos, reserva/consumo y rate limits.
  - Definir formato opaco en tránsito y almacenamiento de hash, nunca secreto
    en Sheets ni en logs.
- [x] **F1.4 — Definir perfiles de carga**
  - Declarar provider, formatos, tamaño, carpeta/namespace derivada, TTL,
    vínculo a grant y condiciones de aceptación.
  - Separar metadata declarativa del adaptador Cloudinary.
- [x] **F1.5 — Añadir validación eager y fail-closed**
  - Extender [validate-registry.js](../api/schema/validate-registry.js) para
    claves permitidas, referencias a campos/handlers/profiles/providers,
    enums, rutas, políticas y conflictos.
  - Agregar pruebas para cada error de forma y referencias inexistentes.
  - Ninguna declaración inválida debe degradarse a permiso por defecto o
    ignorarse silenciosamente.
- [x] **F1.6 — Añadir pruebas de paridad del schema**
  - Probar la proyección de `/admin/schema` para un comando público y evitar
    filtrar grants, secretos, reglas internas o campos no autorizados.
  - Pruebas focalizadas verdes: 75 tests de registry/schema.
  - **Gate F1:** cerrado; no implica ejecución runtime ni despliegue.

## Fase 2 — Runtime de comandos

**Objetivo:** ejecutar cualquier comando declarado con el mismo pipeline y
garantías, sin ramas por recurso.

- [x] **F2.1 — Implementar resolución genérica**
  - Resolver recurso, registro y comando sólo desde declaraciones validadas.
  - Aplicar el contrato de routing elegido en F0.3.
  - `commandsRoute` permite separar el prefijo de commands de la ruta CRUD.
  - Rechazar comando ausente/no declarado, método no permitido y key inválida
    con códigos funcionales consistentes.
- [x] **F2.2 — Aplicar autorización y validación**
  - Ejecutar autenticación del endpoint antes de tocar datos según la política.
  - Validar input y params antes de ejecutar cualquier efecto.
  - Evaluar precondiciones sobre el registro actual bajo lock y distinguir
    entrada inválida (422) de estado concurrente (409) o acceso (401/403).
- [x] **F2.3 — Ejecutar cambios permitidos**
  - Construir el delta sólo desde referencias declaradas.
  - Prohibir que payload suministre campos fuera de la lista de cambios.
  - Actualizar `updated_at` y otros valores generados por la primitiva adecuada.
- [x] **F2.4 — Persistir eventos, auditoría y caché**
  - Añadir eventos declarados sin mutar historial previo.
  - Reutilizar los helpers de storage, audit, lock y cache del motor cuando
    apliquen.
  - Fijar qué es parte del comando y qué es reacción post-escritura; no usar
    hooks como mecanismo de autorización o rollback.
- [x] **F2.5 — Validar output y emitir errores**
  - Validar output con el contrato declarado y seguir la convención actual de
    validación de salida en dev.
  - Exponer `status`, `message`, `code` y `errors[]` con paths estables.
  - Pruebas unitarias focalizadas y suite API completa verdes.
  - **Gate F2:** cerrado; la ruta pública de `orders` conserva CRUD
    administrativo en `/admin/orders`.

## Fase 3 — Grants e idempotencia recuperable

**Objetivo:** emitir autorizaciones limitadas y ejecutar un comando una sola
vez incluso frente a concurrencia y reintentos.

- [x] **F3.1 — Implementar almacén reusable de grants**
  - Persistir hash del secreto, propósito, resource id, key, comando, estado,
    vencimiento, usos y timestamps.
  - Validar asociación exacta entre grant y operación; usar comparación segura
    para hashes cuando el runtime lo permita.
  - Evitar que un grant válido para un registro o comando funcione en otro.
- [x] **F3.2 — Implementar ciclo de vida**
  - Crear, validar, reservar, consumir, expirar y recuperar grants.
  - Definir respuesta ante replay: resultado idempotente si la operación
    completó; conflicto controlado si está en curso o se consumió sin resultado
    recuperable.
- [x] **F3.3 — Implementar clave idempotente**
  - Definir si la genera cliente o servidor y cómo se liga a grant + comando.
  - Mismo key y mismo contenido: devolver resultado persistido sin duplicar
    eventos.
  - Mismo key y contenido distinto: error de conflicto.
  - La ausencia de key cuando es requerida debe fallar antes de escribir.
- [ ] **F3.4 — Cubrir recuperación y concurrencia**
  - [x] Inyectar un fallo durante la actualización del journal y comprobar que
        el retry recupera la operación y no duplica el evento.
  - [x] Probar replay con la misma clave/contenido, conflicto de fingerprint,
        grant usado y scope/expiración/revocación.
  - [ ] Probar doble emisión concurrente del mismo PIN y doble ejecución
        concurrente de un comando.
  - [ ] Probar expiración mientras la operación está en curso y fallos después
        de cada frontera de escritura.
  - **Parcial:** la recuperación está probada para un punto de fallo; faltan
    carreras concurrentes y cobertura de todas las fronteras.
  - **Gate F3:** demostrar no duplicación/no autorización cruzada; documentar
    límites de consistencia real del storage.

## Fase 4 — Perfiles de carga y Cloudinary

**Objetivo:** firmar y aceptar cargas ligadas a una operación, sin exponer
credenciales admin ni confiar en metadata del cliente.

- [x] **F4.1 — Extraer interfaz de proveedor**
  - Definir contrato común de `signUpload` y `verifyUpload`.
  - Mantener credenciales exclusivamente en `PropertiesService`.
  - Adaptar el flujo Cloudinary actual sin cambiar el endpoint admin existente.
- [x] **F4.2 — Emitir firma limitada**
  - Derivar provider, folder, formato, tamaño, nombre/identificador y TTL desde
    profile + grant; nunca desde valores libres del payload.
  - Publicar sólo parámetros que el proveedor requiere para upload directo.
  - Firmar identificador único ligado al grant y recurso.
- [x] **F4.3 — Verificar carga terminada**
  - Validar firma/respuesta del provider, `public_id`, formato, tamaño,
    timestamp y asociación a grant.
  - Rechazar URL/metadata inventadas, carga incompleta, reuso o carga de otro
    grant.
  - No persistir como foto final antes de la verificación del comando.
- [ ] **F4.4 — Probar límites del proveedor**
  - [ ] Confirmar con evidencia del proveedor qué parámetros Cloudinary firma
        realmente, incluido el tamaño, y si limita bytes antes de recibir el archivo.
  - [x] Probar en el adaptador fake formato, tamaño, firma, URL e identidad;
        la suite API queda verde.
  - [ ] Completar fixtures verificables del proveedor para firma expirada y
        respuesta manipulada.
  - **Parcial:** las comprobaciones del motor están probadas con fake. No se
    afirma que Cloudinary limite el tamaño antes de recibir/almacenar el archivo.
  - **Gate F4:** pruebas del adaptador con fixture/fake; sin credenciales reales
    ni llamadas externas en tests.

## Fase 5 — Endpoints backend declarados para el frontend

**Objetivo:** entregar un API consumible sin credenciales admin, con contratos
generados desde schemas. Las rutas definitivas deben coincidir con F0.3.

- [x] **F5.1 — Adaptar verificación PIN como emisor de grant**
  - Modificar declaración de `pinVerify` para el contrato extendido y errores.
  - Integrar el handler existente con la primitiva grant bajo lock.
  - Mantener hash SHA-256 del PIN y su TTL/límites actuales; no devolver PIN.
  - [ ] Prueba concurrente explícita de dos verificaciones del mismo PIN:
        pendiente junto con F3.4/F5.6.
- [x] **F5.2 — Declarar endpoint público de firma**
  - Añadir endpoint con `access: 'public'`, input/output completos y rate limit.
  - Requerir grant de propósito correcto y delegar a perfil/provider.
  - No reutilizar ni rebajar acceso de `/admin/upload-signature`.
- [x] **F5.3 — Declarar endpoint público de comando**
  - Añadir ruta de transporte elegida y ligarla a comando `orders` en schema.
  - Validar grant, key de ruta, idempotency key, nombre e identificador de
    carga.
  - Escribir sólo `authorized_name`, `authorized_photo`, `auth_state` y
    `updated_at`; agregar historial/auditoría una sola vez.
- [x] **F5.4 — Mantener política pública de mínimo privilegio**
  - `audiences.public.operations` sigue sólo lectura; no habilitar update,
    create o delete público en `orders`.
  - Auditar `listProjection`: exponer lo que el frontend requiere, no `history`
    completa por defecto si la UI no la necesita.
- [x] **F5.5 — Publicar contratos y ejemplos**
  - Ejecutar `npm run api:doc`; confirmar rutas, inputs, outputs, ejemplos,
    límites, errores y comportamiento HTTP 200.
  - Añadir regresiones a `api/__tests__/api-doc.spec.js` y checks de contract.
- [ ] **F5.6 — Probar handlers y rutas reales**
  - [x] Probar handler PIN para PIN incorrecto/usado/expirado, pedido no
        elegible y configuración deshabilitada.
  - [x] Probar grants expirados/ajenos/revocación/replay, y aceptación/rechazo
        de cargas con adaptador fake.
  - [x] Probar resolución de ruta de comando y escritura declarativa en fixtures.
  - [ ] Probar desde `doPost` el recorrido integrado PIN → firma → carga →
        comando, reemplazo de autorización previa y cambios concurrentes.
  - **Parcial:** suite API verde (47 archivos/772 pruebas); falta el recorrido
    integrado a través del router y la cobertura concurrente.
  - **Gate F5:** `npm run test:api` y `npm run api:check` verdes.

## Fase 6 — Contrato de integración del frontend externo

**Objetivo:** que el otro frontend integre el flujo sin inferir contratos del
código backend.

- [x] **F6.1 — Producir secuencia end-to-end**
  - Documentar consulta pública, verificación PIN/grant, solicitud de firma,
    upload directo, comando final y lectura de confirmación.
  - Incluir envelope real y respuesta de cada paso con campos finales.
- [x] **F6.2 — Documentar errores y UX de reintento**
  - Indicar `error.status`, `error.code`, `errors[].path`, expiración y cuándo
    reiniciar el flujo.
  - Diferenciar errores recuperables, expiración, conflicto y rate-limit; no
    recomendar reintento automático inseguro.
- [x] **F6.3 — Entregar contrato consumible**
  - Actualizar `doc/api-endpoints.md` como fuente backend generada.
  - Añadir un bloque/guía de integración del flujo con referencias desde el
    endpoint y nombres versionados.
  - Enviar al otro frontend rutas, ejemplos, formatos de imagen, límites y
    política de idempotencia.
- [ ] **F6.4 — Verificar compatibilidad del cliente**
  - [x] Conectar el cliente de muestra al contrato: grant sólo en memoria,
        carga opcional directa a Cloudinary, comando e idempotencia/reintento.
  - [x] El build de Astro del cliente finaliza correctamente.
  - [ ] Ejecutar pruebas de navegador/extremo a extremo contra un backend
        desplegado con estos schemas.
  - **Parcial:** implementación y build local comprobados; no se probó el
    deployment Apps Script ni el upload real del proveedor.
- [ ] **F6.5 — Confirmar que ningún secreto admin llega al browser**
  - [x] El cliente usa rutas `public` y no suministra token admin en las
        llamadas del flujo; el grant queda sólo en memoria y fuera de URL/storage.
  - [x] La proyección pública y el payload del comando son allowlists; el
        historial completo no se solicita ni se muestra.
  - [ ] Verificar requests/responses con captura de navegador en backend
        desplegado y revisar logs/analytics reales.
  - **Parcial:** revisado estáticamente y cubierto por contratos/proyecciones;
    falta evidencia de tráfico y observabilidad de producción.
  - **Gate F6:** frontend puede completar el flujo siguiendo sólo el contrato
    publicado.

## Fase 7 — Pruebas transversales, revisión y cierre

- [x] **F7.1 — Probar reutilización en un segundo recurso de prueba**
  - Declarar un recurso fixture independiente de `orders` con comando, grant y
    perfil de carga.
  - Ejecutar el flujo completo sin editar dispatchers ni agregar handler
    específico del recurso.
- [ ] **F7.2 — Probar fronteras de seguridad**
  - Grant de otra key/recurso/comando; token admin en ruta pública; cambio de
    payload; path traversal; campos extra; replays y rate-limit.
  - Confirmar fail-closed y ausencia de secretos en mensajes/logs.
- **Parcial:** hay cobertura de scope, firma, expiración, replay, payload
  conflictivo, rate limit y proyección sin secretos; faltan casos explícitos
  de path traversal, token admin en rutas públicas y una matriz completa de
  logs/mensajes.
- [x] **F7.3 — Ejecutar gates relevantes**
  - `npm run test:api`
  - `npm run api:check`
  - `npm test` si se tocaron consumidores Angular/tests compartidos.
  - `npm run build` si se tocaron tipos/código frontend.
  - `npx prettier --check <archivos tocados>`
  - `git diff --check`
- [x] **F7.4 — Revisar diff y actualizar referencias**
  - [x] Revisar que no haya ramas por nombre de recurso en router/engine.
  - [x] Confirmar que los docs API están sincronizados y que no hay cambios
        staged ni secretos staged en ninguno de los dos repositorios.
  - [x] Documentar el orden de despliegue y reversión funcional; no se desplegó.
- [ ] **F7.5 — Cerrar este plan**
  - Marcar sólo tareas validadas y dejar pendientes bloqueados con evidencia.
  - Registrar resumen: capacidades genéricas, contrato final del frontend,
    límites conocidos y despliegue requerido.
  - **No cerrado:** depende de F3.4, F4.4, F5.6, F6.4/F6.5 y F7.2.

### Resultado de ejecución hasta ahora

- Completado en backend: F0–F2, F3.1–F3.3, F4.1–F4.3 y F5.2–F5.5; la
  secuencia contractual F6.1–F6.3 está documentada.
- Cliente de muestra: flujo público conectado y `npm run build` verde; F6.4
  permanece parcial hasta probar contra el deployment compatible.
- Validación local: `npm run test:api` (47 archivos, 772 pruebas),
  `npm run api:check`, Prettier y `git diff --check`.
- Pendientes no simulables honestamente con este repo: carreras concurrentes
  completas de F3.4/F5.6, límites de ingress Cloudinary de F4.4, pruebas del
  navegador del otro repo (F6.4/F6.5) y cierre transversal F7.2/F7.4.
- No se ha desplegado ni creado un commit.

## Orden y dependencias

```text
F0 decisiones
  └─ F1 contratos/schema
       └─ F2 runtime comandos
            ├─ F3 grants/idempotencia ─┐
            └─ F4 profiles/upload ─────┤
                                       └─ F5 endpoints orders
                                            └─ F6 integración frontend
                                                 └─ F7 verificación/cierre
```

F3 y F4 pueden desarrollarse en paralelo sólo después de acordar sus interfaces
en F1. F5 depende de ambas. No se debe iniciar la UI final con contratos
provisionales.

## Mapa de áreas probables

Confirmar los paths exactos al comenzar cada fase; no crear subsistemas
duplicados si ya hay un helper equivalente.

| Área                     | Paths a inspeccionar/modificar según diseño                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Contratos y validación   | `api/schema/validate-registry.js`, `api/__tests__/validate-registry.spec.js`, `api/schema/resources/*.js`                     |
| Routing/runtime          | `api/core/10-router.js`, `api/engine/24-crud.js`, `api/engine/28-actions.js`, nuevos módulos engine si el registro lo permite |
| Storage/lock/audit/cache | `api/engine/26-lock-cache.js`, `api/50-audit.js`, helpers de storage; localizar fuentes reales antes de modificar             |
| Grants y perfiles        | Nuevos schemas/capabilities registrados mediante la puerta existente; fixtures en `api/__tests__/`                            |
| Endpoints actuales       | `api/schema/endpoints/pin-verify.js`, `api/capabilities/handlers/pin-verify.js`, endpoint/handler Cloudinary                  |
| Caso PickPass            | `api/schema/resources/orders.js`, `api/__tests__/pin-verify.spec.js`, pruebas nuevas del comando/uploads                      |
| Contrato generado        | `scripts/api-doc.mjs`, `api/__tests__/api-doc.spec.js`, `doc/api-endpoints.md`                                                |
| Integración cliente      | Repo del frontend público; no asumir que coincide con este repo o con el admin Angular                                        |

## Criterios globales de aceptación

- [x] Añadir un flujo común nuevo se hace por schemas, sin `if` por recurso en
      router/engine.
- [x] El agente puede añadir un segundo recurso de prueba sin duplicar
      handlers de dominio.
- [ ] PIN/grants/uploads/comandos tienen alcance, expiración, rate limit y
      estados recuperables claramente definidos en todos los escenarios.
- [ ] Un fallo parcial o retry no duplica la autorización ni su historial.
- [x] El browser nunca usa credenciales admin ni puede cambiar campos no
      declarados.
- [x] Los schemas generan documentación suficiente para integrar el otro
      frontend sin leer handlers.
- [x] Toda afirmación de atomicidad, seguridad de carga o compatibilidad está
      respaldada por una prueba o explícitamente limitada.
