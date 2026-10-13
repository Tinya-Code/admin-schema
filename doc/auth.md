# Inicio de sesión — diseño para Apps Script + Google Sheets

> Define cómo se autentica y autoriza a quien usa el **admin**, respetando que:
>
> - el backend corre en **Google Apps Script** (web app) y los datos viven en **Google Sheets**;
> - el backend tiene **su schema** y cada frontend tiene **el suyo**, y **nunca se unen**;
> - el backend alimenta **más de un frontend**: el admin (con sesión) y la web pública
>   (catálogos y similares, **sin sesión**).
>
> Todo se declara en schemas y registros; nada de `if` sueltos por pantalla.
> Complementa `doc/refactormotor.md` (B2 endpoints, B8 políticas, B12 meta-schema).

---

## 0. Reglas inviolables

1. **Dos schemas, jamás uno.** El schema del back (almacenamiento, reglas, acceso) y el del
   front (presentación) son independientes. Para auth: el back declara endpoints, niveles de
   acceso y la hoja de usuarios; el front declara la pantalla de login y qué rutas exige.
   Solo los une el `contract-check`.
2. **Hay dos audiencias con reglas distintas.** `admin` exige sesión; `public` nunca la
   necesita ni la recibe. Un token del admin **no** es válido en rutas públicas ni al revés.
3. **Fail-closed.** Una ruta sin `access` declarado exige rol `admin` (como hoy).
4. **Apps Script no autentica a nadie por nosotros.** Se despliega «ejecutar como yo,
   acceso: cualquiera» (necesario para la web pública). Cualquiera puede llamar a `/exec`;
   **toda** la seguridad es código nuestro.
5. **Los secretos nunca están en Sheets ni en el front.** Van en `PropertiesService`
   (Script Properties). En la hoja solo hashes.

---

## 1. Restricciones de Apps Script que condicionan el diseño

| Restricción                                                                                                           | Consecuencia en el diseño                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solo `doGet` / `doPost`                                                                                               | Nada de `Authorization` ni verbos REST; la **ruta lógica** viaja en el cuerpo/parámetro (`route`), como hoy                                                            |
| No se controla el status HTTP                                                                                         | Siempre responde 200: los errores van en el **sobre** `{ ok:false, error:{ code } }`                                                                                   |
| No se pueden responder cabeceras CORS ni el preflight `OPTIONS`                                                       | El front debe hacer peticiones «simples»: `POST` con `Content-Type: text/plain`, **sin cabeceras personalizadas**. El token va **en el cuerpo**, no en `Authorization` |
| No hay cookies útiles entre dominios                                                                                  | Sesión = **token explícito** que guarda el front; no cookie de sesión                                                                                                  |
| Cada ejecución arranca en frío; las variables globales no persisten                                                   | Verificar sesión debe ser **barato** → tokens firmados (solo cómputo), sin leer la hoja en cada request                                                                |
| Persistencia entre ejecuciones: `CacheService` (best-effort, TTL ≤ 6 h, ≤ 100 KB/valor), `PropertiesService`, la hoja | Cache para cosas que se pueden perder (rate-limit, snapshot de usuario); hoja para lo que no                                                                           |
| `Session.getActiveUser()` no sirve con acceso «cualquiera»                                                            | Identidad **solo** por nuestro token                                                                                                                                   |
| No hay IP del cliente                                                                                                 | Rate-limit por **cuenta** y global, no por IP                                                                                                                          |
| Sheets: lento, sin transacciones                                                                                      | Login lee `_users` una vez; el resto sale de cache; escrituras bajo `LockService`                                                                                      |
| Hash: no hay bcrypt/PBKDF2 nativos                                                                                    | Preferir **Google ID token** (sin contraseñas); si hay contraseñas, SHA-256 salado e iterado con costo medido (menos robusto)                                          |
| Cuotas de `UrlFetchApp`, ejecución ~6 min                                                                             | Verificar el ID token solo en el login; cuotas vigentes a confirmar en la documentación de Google                                                                      |

---

## 2. Quién entra por dónde

| Superficie                                                       | Sesión                  | Qué ve                           | Rutas                                                                                      |
| ---------------------------------------------------------------- | ----------------------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| **Frontend admin**                                               | Sí (token)              | Todo lo permitido a su rol       | `/admin/*`, `/auth/*`                                                                      |
| **Frontend público** (web de catálogos)                          | **No**                  | Solo proyección pública, lectura | `/public/*`                                                                                |
| **Flujos con credencial de recurso** (ej. `pickpass`: ref + PIN) | No es sesión de usuario | Un solo pedido                   | `access: public` + validación por `check`; **se mantiene separado** de la sesión del admin |

Nota: la sesión de usuario y la «credencial de recurso» (PIN) **no se mezclan**. Un PIN no da
rol ni token; una sesión no abre pedidos ajenos al público.

---

## 3. Diseño de la sesión

### 3.1 Cómo se prueba la identidad (dos proveedores, elegir uno o ambos)

| Opción                                | Cómo                                                                                                                                                                                                                                                                                                                  | Pros                                  | Contras                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| **A · Google ID token** (recomendada) | El front obtiene un ID token con Google Identity Services y lo manda a `/auth/login`. El back lo verifica (`UrlFetchApp` contra el endpoint de verificación de Google), comprueba `aud` = tu client id (en Script Properties), emisor, expiración y `email_verified`, y busca el email en `_users` (**lista blanca**) | Sin contraseñas ni hashes; 2FA gratis | Depende de Google; una llamada externa por login                                   |
| **B · email + contraseña**            | `/auth/login` recibe `{ email, password }`, compara contra `pass_hash` + `pass_salt` en `_users`                                                                                                                                                                                                                      | Sin dependencia externa               | Hash menos robusto en Apps Script; hay que gestionar altas, cambios y recuperación |

En ambas, **estar autenticado no basta**: el usuario debe existir en `_users` y estar `active`.

### 3.2 Token de sesión: firmado y sin estado

```
token = base64url(payload) + '.' + base64url( HMAC-SHA256(AUTH_SECRET, base64url(payload)) )

payload = { sub: 'u_12', sid: 'ses_ab12', v: 3, iat: …, exp: …, aud: 'admin' }
```

- Se firma con `Utilities.computeHmacSha256Signature` y el secreto `AUTH_SECRET` (Script Properties).
- `aud: 'admin'` impide usar este token en otra audiencia.
- **TTL máximo 6 h** (alineado con el máximo de `CacheService`) con **renovación deslizante**:
  si queda menos de ~25 % de vida, la respuesta trae `meta.renewedToken` y el front lo reemplaza.
- El **rol no se confía al token**: se lee del snapshot del usuario (ver 3.4). Un cambio de rol
  o una baja rige en cuanto expire el snapshot (≈ 60 s).
- Comparación de firmas en **tiempo constante** (función propia; no `===`).

### 3.3 Transporte

```
POST {EXEC_URL}
Content-Type: text/plain;charset=utf-8          ← evita preflight CORS
{ "route": "/admin/orders", "op": "list", "token": "…", "payload": { … } }
```

- Todo lo autenticado va por **POST** (los `GET` quedan en URL e historial; nada de tokens ahí).
- En el front, un **interceptor** envuelve cada petición en este formato; **no** usa cabeceras
  personalizadas.

### 3.4 Qué hace el back en cada request autenticado

```
 1. Parsear token y verificar firma HMAC          (solo cómputo, sin Sheets)
 2. exp vigente y aud == 'admin'
 3. sid fuera de la lista de revocados            (CacheService)
 4. Snapshot del usuario sub                      (CacheService 60 s → hoja _users si falta)
       · active == true
       · v del token == token_version del usuario
 5. Resolver `access` de la ruta (11-auth) contra el rol del snapshot
 6. Ejecutar; ctx.user disponible para `computed: currentUser` y auditoría
 7. Si la vida restante es corta → meta.renewedToken
```

Costo típico: 0 lecturas de hoja por request (salvo el snapshot, una vez por minuto).

### 3.5 Ciclo de vida

```
 LOGIN                          REQUEST                         LOGOUT / REVOCACIÓN
 front ─ idToken|credenciales ─►  back
        ◄─ { token, user } ──────  (verifica, lee _users, emite token, audita)

 front ─ { route, token, … } ──►  back (pasos 1-7)
        ◄─ { ok, data, meta? } ──

 front ─ /auth/logout ─────────►  back añade sid a revocados (cache, TTL 6 h)
 admin baja/cambia rol ────────►  back sube token_version del usuario (invalida TODO lo emitido)
```

Garantías honestas:

- Logout individual: **mejor esfuerzo** (el cache puede perder entradas).
- Baja de usuario / «cerrar todas las sesiones»: **firme** (`token_version` persiste en la hoja);
  efectiva en ≤ 60 s (TTL del snapshot).

---

## 4. Backend — lo que se declara

### 4.1 Hojas internas

`_users` (hoja interna; **nunca** expuesta ni en admin ni en público):

| Columna                       | Notas                                                   |
| ----------------------------- | ------------------------------------------------------- |
| `id`, `email` (único), `name` |                                                         |
| `role`                        | `admin` (único asignado — ver §9.4)                     |
| `active`                      | baja lógica                                             |
| `token_version`               | entero; subirlo invalida todas las sesiones del usuario |
| `pass_hash`, `pass_salt`      | solo si se usa la opción B; tipo `secret`               |
| `last_login_at`, `created_at` |                                                         |

`_audit` (ya existe `auditWrite_`): se reutiliza para eventos de auth.

### 4.2 Recurso `users` y tipo `secret`

El mantenimiento de usuarios se declara como un recurso más, sin código especial:

```js
REGISTRY.resources.users = {
  id: 'users',
  kind: 'collection',
  sheet: '_users',
  keyField: 'id',
  titleField: 'name',
  scope: 'admin',
  policies: {
    list: 'role:admin',
    create: 'role:admin',
    update: 'role:admin',
    delete: 'role:admin',
  },
  exposeToFront: true, // solo audiencia admin
  fields: [
    { key: 'email', type: 'email', required: true, unique: true },
    { key: 'name', type: 'text', required: true },
    { key: 'role', type: 'select', options: ['admin'], required: true },
    { key: 'active', type: 'boolean', default: true },
    { key: 'pass_hash', type: 'secret' }, // nunca se lee ni viaja
    { key: 'token_version', type: 'number', default: 1, access: { write: 'system' } },
  ],
};
```

Tipo nuevo `secret` en el catálogo de tipos (`FIELD_TYPES`):
`{ storage: 'column', sheetFormat: 'text', readable: false, writeOnly: true }`.

- Excluido de `listProjection`, de `/admin/schema` y de cualquier respuesta, siempre.
- Las respuestas jamás incluyen `pass_hash`, `pass_salt` ni `token_version`.

### 4.3 Endpoints de auth (declarativos, ver B2)

```js
REGISTRY.endpoints['/auth/login'] = {
  handler: 'authLogin',
  access: 'public',
  limits: { perMinute: 10 },
  input: { idToken: { type: 'text' }, email: { type: 'email' }, password: { type: 'secret' } },
};
REGISTRY.endpoints['/auth/logout'] = { handler: 'authLogout', access: 'session' };
REGISTRY.endpoints['/auth/me'] = { handler: 'authMe', access: 'session' };
// /auth/refresh no hace falta con renovación deslizante (3.2)
```

### 4.4 Niveles de `access` (aditivo; los valores actuales siguen valiendo)

| Valor                        | Quién entra                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `public`                     | cualquiera, sin token                                                                           |
| `session`                    | cualquier usuario autenticado y activo                                                          |
| `role:staff` (reservado)     | valor válido, **nadie lo tiene hoy** (§9.4) — se conserva sólo para la prueba `FORBIDDEN` de §8 |
| `role:admin` (alias `admin`) | solo `admin`                                                                                    |
| _(sin declarar)_             | **`role:admin`** (fail-closed)                                                                  |

`11-auth` resuelve estos niveles; el router sigue limitándose a **normalizar** lo declarado.
Las políticas por operación (`policies: { list, create, … }`) usan los mismos valores.

### 4.5 Sobre de respuesta y códigos de error

```
{ ok: true,  data: …, meta?: { renewedToken? } }
{ ok: false, error: { code, message, fields? } }
```

Si hoy ya existe un formato de respuesta, **se conserva** y solo se añaden estos códigos:

| `code`          | Cuándo                                                                   | Qué hace el front                                   |
| --------------- | ------------------------------------------------------------------------ | --------------------------------------------------- |
| `AUTH_REQUIRED` | no hay token en ruta protegida                                           | ir a login                                          |
| `AUTH_INVALID`  | firma/estructura incorrecta, usuario inactivo o `token_version` distinto | limpiar sesión, ir a login                          |
| `AUTH_EXPIRED`  | `exp` vencido                                                            | limpiar sesión, ir a login, volver a la ruta previa |
| `FORBIDDEN`     | autenticado pero sin rol suficiente                                      | mostrar «sin permiso»; no cerrar sesión             |
| `RATE_LIMITED`  | demasiados intentos                                                      | mostrar espera                                      |
| `VALIDATION_*`  | como hoy                                                                 | como hoy                                            |

El mensaje de login fallido es **siempre genérico** («credenciales inválidas»): no revela si
el email existe.

### 4.6 Protección del login

- **Rate-limit por cuenta + global** con `CacheService` (p. ej. 5 fallos / 15 min por email,
  umbral global más alto). Contador bajo `LockService` (el incremento no es atómico).
  Declarado en `limits` del endpoint, ejecutado por `26-lock-cache`.
- Opción B: hash con sal por usuario, **comparación en tiempo constante**, iteraciones
  ajustadas a lo que tolere el tiempo de ejecución.
- Opción A: verificar siempre `aud`, `exp`, `email_verified` y que el email esté en `_users`.
- **Auditoría** en `_audit`: `login_ok`, `login_fail`, `logout`, `forbidden`, con id de
  usuario y marca de tiempo. **Nunca** tokens ni contraseñas.
- Si el login falla, se responde igual de rápido haya o no usuario (sin pistas por tiempos).

### 4.7 Alta del primer administrador

Nunca por endpoint. Funciones **solo ejecutables desde el editor de Apps Script**:

```
setupAuth_()      genera AUTH_SECRET (y guarda GOOGLE_CLIENT_ID si aplica) en Script Properties
rotateAuthSecret_ rota AUTH_SECRET e invalida todas las sesiones existentes
bootstrapAdmin_() crea la fila inicial en _users (email del dueño, role admin)
setupAll()        encadena el setup completo y aplica las credenciales de arriba
```

La acción autenticada `POST /auth/logout-all` incrementa el `token_version`
del usuario y cierra sus sesiones en todos los dispositivos. Los snapshots de
sesión tienen un TTL máximo de 60 segundos; la respuesta declara ese límite.
La rotación de `AUTH_SECRET` es una operación de emergencia desde el editor
(`rotateAuthSecret_`), no un endpoint, y también invalida todas las sesiones.

**Contraseña explícita = fuente de verdad.** Si `ADMIN_PASSWORD` (o el segundo
argumento) trae valor y el email **ya existe** en `_users`, la fila se
**actualiza** con esa contraseña en vez de devolver `409`. Cambiar la propiedad
y volver a correr `setupAll()` la aplica; si ya era esa contraseña no se
re-hashea (idempotente).

Sin contraseña explícita la fila **no se toca**: `409`, como siempre. Una cuenta
desactivada tampoco se reactiva desde acá — reactivar es una acción de admin,
nunca de setup.

Rotar `AUTH_SECRET` invalida todas las sesiones (es un «cerrar sesión global» de emergencia).

`rotateAuthSecret_()` es la única ruta soportada para hacerlo desde el editor:
genera un valor nuevo, no lo muestra ni lo registra y devuelve sólo un resultado
sin datos sensibles.

El segundo proveedor y las cuentas `customer` no se habilitan: la decisión de
`auth.md` §9 mantiene el login con contraseña y prohíbe cuentas públicas de
cliente. Añadir cualquiera de ellos requiere reabrir esa decisión y definir su
propio contrato antes de implementarlo.

### 4.8 Qué viaja a cada frontend (audiencias)

El back sirve a dos frontends distintos, así que `exposeToFront` (booleano) se queda corto.
Cambio **aditivo**: lo actual equivale a `audiences.admin` (declararla exige
`exposeToFront: true`; si no la declaras, la audiencia admin es el recurso completo).

```js
REGISTRY.resources.products = {
  …
  audiences: {
    admin:  { listProjection: ['id','name','price','active','stock','cost'], operations: ['list','get','create','update','remove'] },
    public: { listProjection: ['id','name','price','image'], views: ['publishable'], operations: ['list','get'] },
  },
};
```

- **Lo público es lista blanca estricta**: solo lectura (`list`/`get`), vistas filtradas
  (`publishable`), sin campos internos (`cost`, `stock`, notas, ids de gestión).
- Una ruta `public` nunca acepta ni devuelve el token del admin
  (probado de punta a punta en `public-audience.spec.js`: con control de que
  el token es real, el cuerpo de `/p/orders/:ref` sale idéntico con y sin él).
- Ningún recurso `_users`/`_audit`/internos tiene audiencia `public`.

**Implementado (F7 · R7.2)**: `validate-registry.js` valida todo esto al arranque
(ROJO), y los endpoints `/p/*` **leen la declaración** — `handlePublicOrder` proyecta
`audiences.public.listProjection` en vez de portar una lista propia; recurso sin
audiencia pública ⇒ **500**, no campos sueltos.

---

## 5. Frontend — lo que se declara (schema del front, independiente)

### 5.1 Pantalla de login declarada

El login es una pantalla más, construida con el motor (campos del registro de render), y vive
**solo** en el schema del front:

```ts
export const authSchema: AuthSchema = {
  providers: ['google', 'password'], // o solo uno
  loginFields: [
    { key: 'email', type: 'email', required: true },
    { key: 'password', type: 'password', required: true }, // tipo nuevo vía descriptor (F1)
  ],
  redirectAfterLogin: '/dashboard',
  rememberMe: true,
};
```

El back no conoce estas etiquetas ni este layout: solo declara el `input` de `/auth/login`.
El `contract-check` verifica que las claves de `loginFields` existan en ese `input`.

### 5.2 Piezas del front

| Pieza                    | Responsabilidad                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `AuthService` (signals)  | `user`, `token`, `isAuthenticated`, `login()`, `logout()`, `applyRenewedToken()`                                                      |
| **Interceptor**          | Envuelve cada petición en `{ route, op, token, payload }`, `Content-Type: text/plain`, sin cabeceras propias; lee `meta.renewedToken` |
| **Manejo de errores**    | Un solo lugar interpreta `AUTH_*` / `FORBIDDEN` (tabla 4.5)                                                                           |
| `authGuard`, `roleGuard` | Protegen rutas generadas desde `registry.ts` (`shell.routes.ts`)                                                                      |
| Menú                     | Se filtra por rol (solo comodidad; **la seguridad real es del back**)                                                                 |

### 5.3 Declarar el acceso por recurso (solo UX)

```ts
// en el schema front de un recurso
access: { requires: 'session', roles: ['admin'] }
```

Oculta rutas, botones y acciones. Aunque el front se manipule, el back vuelve a verificar.

### 5.4 Dónde se guarda el token

- Por defecto, **`sessionStorage`** (muere con la pestaña).
- Con «recordarme», `localStorage` (más cómodo, más expuesto a XSS; documentar la decisión).
- Nunca en la URL ni en el cuerpo de los `GET`.
- Al recibir `AUTH_INVALID`/`AUTH_EXPIRED`: borrar token y usuario antes de redirigir.

### 5.5 Frontend público

- Sin `AuthService`, sin guards, sin token.
- Solo llama a `/public/*`; si una ruta devuelve `AUTH_REQUIRED`, es un error de configuración
  que debe verse en desarrollo, no un flujo de login.
- Tiene **su propio schema**, vigilado por su propio `contract-check` contra la audiencia `public`.
- Si algún día hay «cuenta de cliente», será otra audiencia (`customer`) con su propia hoja
  (`_customers`) y su propio `aud` en el token; **no** se reutiliza `_users`.

---

## 6. Nomenclatura

| Elemento                    | Convención                                                                        |
| --------------------------- | --------------------------------------------------------------------------------- |
| Hojas internas              | prefijo `_` + `snake_case`: `_users`, `_audit`                                    |
| Script Properties           | `MAYUS_SNAKE`: `AUTH_SECRET`, `GOOGLE_CLIENT_ID`                                  |
| Códigos de error            | `MAYUS_SNAKE` con prefijo de dominio: `AUTH_*`, `VALIDATION_*`                    |
| Niveles de acceso           | `public`, `session`, `role:<nombre>`                                              |
| Audiencias                  | minúsculas: `admin`, `public` (futuro `customer`)                                 |
| Funciones privadas del back | sufijo `_` (como hoy): `verifyToken_`, `issueToken_`, `setupAuth_`                |
| Handlers de auth            | `authLogin`, `authLogout`, `authMe`                                               |
| Claim del token             | `sub`, `sid`, `v`, `iat`, `exp`, `aud` (estándar JWT, aunque no sea JWT estricto) |

---

## 7. Fases de implementación

| Fase               | Entrega                                                                                                                                                       | Criterio de «hecho»                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **1 · Núcleo**     | `_users`, `setupAuth_`, `bootstrapAdmin_`, `issueToken_`/`verifyToken_`, `/auth/login` (una opción), `/auth/me`, niveles `public/session/role:*` en `11-auth` | Una ruta `admin` responde `AUTH_REQUIRED` sin token y funciona con token                               |
| **2 · Front**      | `AuthService`, interceptor (cuerpo, `text/plain`), guards, login declarado, manejo de `AUTH_*`                                                                | Login/logout completo desde el admin, redirección al expirar                                           |
| **3 · Robustez**   | Rate-limit, auditoría, snapshot cacheado, `token_version`, renovación deslizante, `/auth/logout` con revocación                                               | Baja de usuario efectiva en ≤ 60 s; intentos fallidos bloqueados                                       |
| **4 · Audiencias** | `audiences` en recursos, proyección pública estricta, `contract-check` por frontend                                                                           | La web pública no puede obtener un campo interno                                                       |
| **5 · Gestión**    | Recurso `users` en el admin, tipo `secret`, cambio de rol / baja                                                                                              | Alta y baja de usuarios sin tocar la hoja a mano                                                       |
| **6 · Extras**     | «Cerrar todas las sesiones» y rotación de `AUTH_SECRET`                                                                                                       | El `token_version` invalida sesiones en ≤ 60 s; `rotateAuthSecret_()` invalida todas al rotar la firma |

---

## 8. Pruebas mínimas

- Ruta `admin` sin token → `AUTH_REQUIRED`; con token alterado → `AUTH_INVALID`.
- Token vencido → `AUTH_EXPIRED`; token con `aud` distinto → rechazado.
- Usuario con `active = false` → rechazado en ≤ 60 s.
- Subir `token_version` → todas las sesiones de ese usuario caen.
- Rol `staff` (valor reservado de §4.4, nadie lo tiene) en ruta `role:admin`
  → `FORBIDDEN` (y no se cierra la sesión).
- Logout → ese `sid` rechazado.
- 6.º intento fallido → `RATE_LIMITED`; el mensaje de fallo es idéntico exista o no el email.
- `/public/*` no devuelve campos fuera de la audiencia `public`; un token de admin no cambia el resultado.
- Ninguna respuesta contiene `pass_hash`, `pass_salt` ni `token_version`.
- `contract-check`: claves de login del front ⊆ `input` de `/auth/login`; rutas de recursos del
  front existen en la audiencia correspondiente del back.

---

## 9. Decisiones — ✅ resueltas (2026-10-06)

> Veredicto completo, con la evidencia de cada uno, en
> **`doc/plan-limpieza.md` §5.1 (D10)**. Éstas **mandan sobre las de
> `refactormotor.md` §9** (cabecera de ese plan).

1. ✅ **¿Opción A (Google), B (contraseña) o ambas?** → **B — contraseña.**
   `_users` con `pass_hash`/`pass_salt` (tipo `secret`, §4.1). Sin Google
   Cloud ni pantalla de consentimiento. **KDF real obligatorio:** GAS no tiene
   bcrypt → SHA-256 iterado con salt, nunca SHA-256 plano.
2. ✅ **¿Cuánto dura una sesión?** → **6 h con renovación deslizante + tope
   absoluto de 7 días.**
3. ✅ **¿«Recordarme» en `localStorage`?** → **No — `sessionStorage`.** Muere
   al cerrar la pestaña ⇒ cero token legible por un XSS futuro.
4. ✅ **¿Cuántos roles?** → **Sólo `admin` asignado.** `staff` queda como
   **valor reservado** del vocabulario §4.4 (nadie lo usa) para que la prueba
   `FORBIDDEN` de §8 siga ejecutable. Ver **D12**.
5. ✅ **¿Qué formato de respuesta existe hoy?** → **Se conserva el actual**
   (O7): `{ error: { status, message, errors? } }` de `api/core/12-http.js`.
   Sólo se añaden códigos `AUTH_*`; **no** se cambia a `{ ok: false }`.
6. ✅ **¿Habrá cuentas de cliente en la web pública?** → **No.**
   `public-order` y `pin-verify` siguen `access: 'public'` por PIN; la
   audiencia `customer` queda declarada pero sin usar.
7. ✅ **¿Se acepta la revocación de logout individual «de mejor esfuerzo»?** →
   **Aceptado.** `token_version` ya invalida **todas** las sesiones de un
   usuario (el caso importante). Revocar _una_ sesión exigiría tabla de
   sesiones activas + chequeo por request ⇒ latencia y cuota GAS (**O5**).

---

## 10. Lo que este documento cambia en `refactormotor.md`

- Se añade una sección **A · Entorno y reglas inviolables** (Apps Script, Sheets y los tres
  componentes independientes).
- El §5 deja de proponer unir `data` y `ui` o generar un schema desde el otro: pasa a
  **dos schemas independientes + contrato vigilado por consumidor** y audiencias.
- B2 y B3: rutas lógicas (sin verbos ni `:id` en el path HTTP).
- B4 y B12: los chequeos pesados se hacen en despliegue (Node) o a demanda, no en cada ejecución.
- B9: sin «rollback» real en Sheets (se usa compensación).
- B14: jobs, notificaciones y webhooks sujetos a triggers y cuotas de Apps Script.
