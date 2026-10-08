// core/11-auth — Autenticación por política de ruta (baseapi §2.1 #1, §10.3).
//
// El token viaja en el CUERPO (los `doGet/doPost` de GAS no exponen
// cabeceras) y NUNCA en la URL ni en logs.
//
// Desde R2.6 existe UN SOLO sistema de credenciales: el token de sesión de
// auth.md §3.2, verificado por la cadena de §3.4 (`verifySession_`). El
// token admin antiguo (`ADMIN_TOKEN_HASH`) se retiró — D21-C: no tenía
// `sub`, `sid` ni fila en `_users`, así que la cadena no podía describirlo.
//
// F6 (§8): el NIVEL de acceso lo decide la política de la ruta resuelta
// (endpoint.access / resource.policies.access), nunca el prefijo del path.
// El router llama a requireAccess_ con ese nivel; sin política ⇒ 'admin'
// (fail-closed).

// Aplica el nivel declarado para el grupo de operación (F6-2).
//
// `identity` es SIEMPRE una identidad ya verificada por `verifySession_`
// (`{ role, active, ... }` — la fila de `_users`) o `null`. Ya no admite
// la forma `string`: ver cabecera (D21-C).
function requireAccess_(identity, level) {
  var canonical = normalizeAccessLevel_(level);
  if (canonical === 'public') return true;

  // D21-C: ya NO existe la forma `string`. El token admin antiguo se retiró
  // en R2.6 y aquí sólo llega una identidad que la cadena de §3.4 verificó.
  var role = '';
  if (identity !== null && typeof identity === 'object') {
    // `active` tiene que ser explícitamente true: una identidad sin él no
    // está establecida (AUTH_INVALID ⇒ 401), no es «falta de rol».
    if (identity.active !== true) throw apiError_(401, 'No autorizado', null, 'AUTH_INVALID');
    role = typeof identity.role === 'string' ? identity.role : '';
  } else {
    throw apiError_(401, 'No autorizado', null, 'AUTH_REQUIRED');
  }

  // Autenticado y activo basta: el rol no se mira.
  if (canonical === 'session') return true;

  var requiredRole = canonical.slice('role:'.length);
  if (!roleAllowed_(role, requiredRole)) {
    // Autenticado pero sin rol suficiente ⇒ FORBIDDEN (§4.5), NO 401: el
    // front debe mostrar «sin permiso» sin cerrar la sesión.
    authAudit_(
      'forbidden',
      String(identity.id || ''),
      String(identity.email || ''),
      'rol insuficiente (requerido: ' + canonical + ')',
    );
    throw apiError_(403, 'Prohibido', null, 'FORBIDDEN');
  }
  return true;
}

// ── Vocabulario de niveles (R2.4 — auth.md §4.4) ──────────────────────────
//
//   public         → cualquiera, sin token
//   session        → cualquier usuario autenticado y activo
//   role:staff     → valor reservado, nadie lo tiene (§9.4)
//   role:admin     → sólo admin (alias declarado: 'admin')
//   sin declarar   → role:admin   (fail-closed)
//
// Coincidencia EXACTA y sin ignorar mayúsculas: el vocabulario lo escribe
// quien declara el schema, y ante cualquier ruido lo correcto es caer al
// nivel más restrictivo, no adivinar.
function normalizeAccessLevel_(level) {
  if (typeof level !== 'string') return 'role:admin';
  var value = level.trim();
  if (value === 'public' || value === 'session') return value;
  if (value === 'admin' || value === 'role:admin') return 'role:admin';
  if (value === 'role:staff') return 'role:staff';
  return 'role:admin'; // vacío, ausente o desconocido ⇒ fail-closed
}

// Rango de los roles: los niveles `role:*` son un MÍNIMO, admin ≥ staff.
// Por eso el token admin antiguo pasa también por `role:staff` y por qué
// ningún nivel del schema actual cambia de comportamiento.
var ACCESS_ROLE_RANK = { staff: 10, admin: 20 };

function roleAllowed_(role, requiredRole) {
  var need = ACCESS_ROLE_RANK[requiredRole];
  var have = ACCESS_ROLE_RANK[role];
  return typeof need === 'number' && typeof have === 'number' && have >= need;
}

// D21-C (R2.6): `requireAdmin_` ya no existe. El token admin antiguo
// (`ADMIN_TOKEN_HASH`) no tenía `sub`, `sid` ni fila en `_users`, así que
// la cadena de §3.4 no podía describirlo; desde R2.6 todo pasa por
// `verifySession_`. Queda UN solo sistema de credenciales — y por tanto
// ninguna que exista sin `sid` que revocar (R2.16).

// Comparación en tiempo constante de dos textos (mismo hash ⇒ mismos bytes).
function constantTimeEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ── KDF de contraseñas (Opción B — R2.1b / D19, auth.md §9.1 y §4.6) ──────
//
// GAS no tiene bcrypt ni PBKDF2 ⇒ SHA-256 iterado con sal. §9.1 es tajante:
// «KDF real obligatorio (…) nunca SHA-256 plano».
//
// pass_hash es AUTOCONTENIDO: `s256$<iteraciones>$<hex>`.
//   · la verificación reutiliza el recuento que se EMITIÓ, no el global ⇒
//     subir el coste mañana no invalida ningún hash ya emitido;
//   · la sal vive aparte en pass_salt ⇒ se puede rotar sin tocar el coste.
//
// El coste NO está fijado en el código: lo mide setupAuth_() en el
// despliegue real (Utilities.computeDigest es interop a Java, así que el
// coste real sólo se conoce ahí) y lo guarda en la propiedad
// KDF_ITERATIONS. Sin esa propiedad no se emite ni se valida ningún hash.
var KDF_ALGO = 's256';

// Iteraciones con las que se EMITEN los hashes nuevos (fallos ⇒ 500 claro).
// Se valida con regex y no con parseInt: `parseInt('3.5')` devuelve 3 y se
// tragaba un valor mal editado en silencio. Aquí manda fail-closed.
function kdfIterations_() {
  var raw = String(Props.require('KDF_ITERATIONS')).trim();
  if (!/^[0-9]+$/.test(raw)) {
    var err = new Error('Falta configurar la propiedad: KDF_ITERATIONS');
    err.apiStatus = 500;
    throw err;
  }
  var n = parseInt(raw, 10);
  if (n < 1) {
    var err2 = new Error('Falta configurar la propiedad: KDF_ITERATIONS');
    err2.apiStatus = 500;
    throw err2;
  }
  return n;
}

// Sal nueva: 128 bits en hex (UUID sin guiones = 32 caracteres hex).
function kdfNewSalt_() {
  return String(Utilities.getUuid()).replace(/-/g, '');
}

// hash → `s256$<iteraciones>$<hex>`. Cada ronda mezcla el digest anterior
// con el material original (password|salt), de modo que cortar el bucle en
// la ronda N no acerca el atacante a un hash de N-1 iteraciones.
function kdfHash_(password, salt, iterations) {
  var material = String(password) + '|' + String(salt);
  var digest = material;
  for (var i = 0; i < iterations; i++) {
    digest = Props.hashText(digest + '|' + material);
  }
  return KDF_ALGO + '$' + iterations + '$' + digest;
}

// ¿Es un pass_hash con forma de KDF? Sólo estructura: no calcula nada.
function kdfParse_(stored) {
  if (typeof stored !== 'string') return null;
  var parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== KDF_ALGO) return null;
  var iterations = parseInt(parts[1], 10);
  if (!isFinite(iterations) || iterations < 1) return null;
  return { iterations: iterations, digest: parts[2] };
}

// Verificación: usa el recuento guardado EN EL PROPIO hash (autocontenido)
// y compara en tiempo constante. Estructura inesperada ⇒ false, nunca lanza:
// el login responde siempre el mismo mensaje genérico (auth.md §4.5).
function kdfVerify_(password, salt, stored) {
  var parsed = kdfParse_(stored);
  if (parsed === null || typeof salt !== 'string') return false;
  return constantTimeEqual_(kdfHash_(password, salt, parsed.iterations), stored);
}

// §4.6 — «Si el login falla, se responde igual de rápido haya o no usuario».
//
// Un email inexistente salía antes del KDF y contestaba en microsegundos,
// mientras uno real tardaba lo que cuesta `kdfIterations_()` rondas: eso es
// un comprobador de direcciones de correo con cronómetro. Éste quema el
// MISMO coste que `kdfVerify_` de un usuario real.
//
// El digest del string-armadura ('0') da igual: `kdfVerify_` recalcula el
// hash COMPLETO antes de comparar, y la comparación nunca puede acertar.
// Lo único que manda es el recuento de iteraciones, y sale de la MISMA
// propiedad que emite los hashes de verdad ⇒ si alguien sube el coste,
// las dos ramas se mueven juntas.
//
// Si la propiedad no estuviera (o estuviera mal editada), `kdfVerify_` de un
// usuario real tampoco la necesita — su hash es autocontenido —, así que
// aquí sólo importa no romper el 401 ni dejar la rama muerta: se quema el
// suelo del rango, que es el número que de todos modos no se baja.
// Sal fija de la rama de abajo: no protege nada (el hash armadura jamás se
// guarda ni se compara contra nada real), sólo tiene que existir para que
// `kdfVerify_` recorra el mismo camino de código.
var AUTH_TIMING_SALT = 'timing-equalizer';

function kdfBurn_(password) {
  var iterations;
  try {
    iterations = kdfIterations_();
  } catch (configError) {
    iterations = Number(CONFIG.KDF_ITERATIONS_MIN);
    if (!isFinite(iterations) || iterations < 1) return false;
  }
  return kdfVerify_(password, AUTH_TIMING_SALT, KDF_ALGO + '$' + iterations + '$0');
}

// ── Token de sesión firmado y sin estado (R2.3 — auth.md §3.2) ────────────
//
//   token = b64url(json) + '.' + b64url( HMAC-SHA256(AUTH_SECRET, b64url(json)) )
//
// Se firma el BLOQUE b64url, no el JSON crudo: la comparación se hace sobre
// exactamente los bytes que viajan y no puede haber ambigüedad de
// serialización entre quien firma y quien verifica.
//
// El payload es una WHITELIST, no un spread de lo que llegue. Ése es el
// mecanismo que impide que el rol se colarse: auth.md §3.2 dice «el rol no
// se confía al token, se lee del snapshot», y aquí no hace falta confiar en
// que nadie se acuerde de no meterlo — simplemente no está en la lista.
var TOKEN_AUD = 'admin';

function tokenTtlMs_() {
  return (CONFIG.TOKEN_TTL_HOURS || 6) * 60 * 60 * 1000;
}

function sessionMaxMs_() {
  return (CONFIG.SESSION_MAX_DAYS || 7) * 24 * 60 * 60 * 1000;
}

function tokenRenewRatio_() {
  var r = Number(CONFIG.TOKEN_RENEW_RATIO);
  return isFinite(r) && r > 0 && r < 1 ? r : 0.25;
}

// Secreto de firma. Exigido Y con longitud mínima: sin él `Props.require`
// ya lanza 500, y uno demasiado corto firmaría «igual de bien» un secreto
// adivinable — mejor detenerse que dar una falsa sensación de seguridad.
function authSecret_() {
  var secret = String(Props.require('AUTH_SECRET'));
  if (secret.length < 16) throw apiError_(500, 'La propiedad AUTH_SECRET es demasiado corta');
  return secret;
}

// bytes ↔ texto vía la API de GAS. En los tests se reemplaza Utilities
// COMPLETO: el stub inerte del harness devuelve el proxy ante cualquier
// propiedad, así que parchear un método suelto no funciona.
function textToBytes_(text) {
  return Utilities.newBlob(String(text)).getBytes();
}

function bytesToText_(bytes) {
  return Utilities.newBlob(bytes).getDataAsString();
}

// base64url sin relleno: el token viaja en cuerpo de petición y en `meta`,
// y sin `=` es URL-seguro sin ambigüedad.
function bytesToB64Url_(bytes) {
  return String(Utilities.base64EncodeWebSafe(bytes)).replace(/=+$/, '');
}

function b64UrlToBytes_(text) {
  var padded = String(text);
  while (padded.length % 4 !== 0) padded += '=';
  return Utilities.base64DecodeWebSafe(padded);
}

function textToB64Url_(text) {
  return bytesToB64Url_(textToBytes_(text));
}

function hmac_(message) {
  return Utilities.computeHmacSha256Signature(textToBytes_(message), textToBytes_(authSecret_()));
}

// Emite un token. `claims` se recorta a la whitelist del diseño: lo que no
// esté declarado acá NO viaja.
function issueToken_(claims) {
  claims = claims || {};
  var sub = claims.sub === undefined || claims.sub === null ? '' : String(claims.sub);
  var sid = claims.sid === undefined || claims.sid === null ? '' : String(claims.sid);
  if (sub === '' || sid === '') {
    throw apiError_(500, 'issueToken_ necesita claims.sub y claims.sid');
  }

  var now = Date.now();
  // `orig` es el instante en que nació la SESIÓN, no el token: se arrastra
  // de un token a otro en cada renovación. Es lo que permite el tope
  // absoluto de 7 días (D10-2) SIN guardar estado en el servidor — el token
  // sigue siendo autocontenido, como manda el título del §3.2.
  var orig = Number(claims.orig);
  if (!isFinite(orig) || orig <= 0 || orig > now) orig = now;

  var exp = now + tokenTtlMs_();
  // El tope también se aplica AL EMITIR: nunca sale un token que sobreviva
  // a la sesión, aunque renovMeta_ se salte (defensa en profundidad).
  var sessionEnd = orig + sessionMaxMs_();
  if (exp > sessionEnd) exp = sessionEnd;

  var payload = {
    sub: sub,
    sid: sid,
    v: Number(claims.v) || 0,
    iat: now,
    exp: exp,
    aud: TOKEN_AUD,
    orig: orig,
  };

  var body = textToB64Url_(JSON.stringify(payload));
  return body + '.' + bytesToB64Url_(hmac_(body));
}

// Verifica firma, audiencia y vigencia. Devuelve un motivo estructurado para
// que R2.5/R2.6 lo traduzcan a AUTH_INVALID / AUTH_EXPIRED sin adivinar.
//
// Orden importante: la FIRMA se comprueba ANTES de parsear. Nunca se
// interpreta JSON que todavía no está autenticado.
function verifyToken_(token) {
  if (typeof token !== 'string' || token === '') return { ok: false, reason: 'malformed' };
  var dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed' };
  var body = token.slice(0, dot);
  var sig = token.slice(dot + 1);
  if (body.indexOf('.') !== -1 || sig.indexOf('.') !== -1) {
    return { ok: false, reason: 'malformed' };
  }

  if (!constantTimeEqual_(sig, bytesToB64Url_(hmac_(body)))) {
    return { ok: false, reason: 'bad_signature' };
  }

  var payload;
  try {
    payload = JSON.parse(bytesToText_(b64UrlToBytes_(body)));
  } catch (e) {
    return { ok: false, reason: 'malformed' };
  }
  if (payload === null || typeof payload !== 'object') return { ok: false, reason: 'malformed' };
  if (typeof payload.sub !== 'string' || payload.sub === '') {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
    return { ok: false, reason: 'malformed' };
  }

  // Audiencia: este token no vale en otra (§3.2).
  if (payload.aud !== TOKEN_AUD) return { ok: false, reason: 'bad_aud' };

  // Vigencia. Un token con MÁS de TTL de vida no se acepta aunque aún no
  // haya expirado: el TTL lo pone el back, así que un payload más largo es
  // señal de manipulación.
  if (payload.exp <= payload.iat || payload.exp - payload.iat > tokenTtlMs_()) {
    return { ok: false, reason: 'malformed' };
  }
  if (Date.now() >= payload.exp) return { ok: false, reason: 'expired' };

  return { ok: true, payload: payload };
}

// Motivo de verifyToken_ → código de §4.5. El front decide con el CÓDIGO,
// no con el mensaje: AUTH_INVALID borra token+usuario y va a login;
// AUTH_EXPIRED va a login conservando la ruta previa (§4.5 / R2.9).
var TOKEN_REASON_CODES = {
  malformed: 'AUTH_INVALID',
  bad_signature: 'AUTH_INVALID',
  bad_aud: 'AUTH_INVALID',
  expired: 'AUTH_EXPIRED',
};

// Código de sesión para un motivo de verifyToken_ (desconocido ⇒ inválido).
function authCodeFor_(reason) {
  return TOKEN_REASON_CODES[reason] || 'AUTH_INVALID';
}

// Lanza el 401 correspondiente a un fallo de token. Mensaje SIEMPRE el mismo
// ('No autorizado'): la distinción vive en el `code` y ningún mensaje suma
// información que un atacante no tenga ya.
function throwTokenError_(reason) {
  throw apiError_(401, 'No autorizado', null, authCodeFor_(reason));
}

// ── Cadena de verificación por request (R2.6 — auth.md §3.4) ──────────────
//
//  1. firma HMAC y estructura       → verifyToken_  (sólo cómputo)
//  2. exp vigente y aud == 'admin'  → verifyToken_
//  3. sid fuera de la lista          → sidRevoked_   (CacheService)
//  4. snapshot de `sub`             → sessionSnapshot_ (CacheService 60 s →
//                                     el cache de 60 s lo pone R2.15)
//  5. resolver `access` con el rol  → requireAccess_ (lo llama el router)
//  6. ejecutar con `request.user`   → dispatchRoute_
//  7. renovación deslizante          → renewMeta_    (lo adjunta el router)
//
// Coste fuera del cache: una lectura de `_users`. Con R2.15, típicamente 0.
//
// Devuelve `{ payload, user }`. Cualquier fallo lanza 401 con el `code` de
// §4.5 y SIEMPRE el mismo mensaje: el motivo exacto vive en el código, y
// un mensaje más preciso sólo le regalaría información a quien prueba
// tokens ajenos.

// ¿Está el `sid` en la lista de revocados? Best-effort (D10-7): la escribe
// `/auth/logout` en R2.16. Mientras no haya nadie escribiéndola, es una
// lectura de cache que casi siempre devuelve nada — que es lo que toca.
// ── Revocación de sesión por `sid` (R2.16 — auth.md §4.3 / D10-7) ─────────
//
// `/auth/logout` ESCRIBE acá; `verifySession_` ya leía desde R2.6.
//
// **Mejor esfuerzo**, como dice §4.3 — y la letra chica importa:
//   · `CacheService` puede perder entradas (§2 la lista como caché de lo
//     que se pueda perder), y
//   · su tope son 6 h, que es exactamente la vida de un token emitido
//     (`TOKEN_TTL_HOURS`). Un sid revocado cubre UN token; una sesión que
//     ya se renovó en deslizante puede durar hasta `SESSION_MAX_DAYS`.
//
// Por eso «cerrar todas las sesiones» NO es esto: eso es `token_version`
// (R2.15), que persiste en la hoja y por eso sí es FIRME (§4.3).
var REVOKED_SID_TTL_S = 21600; // 6 h — máximo de CacheService

function revokeSid_(sid) {
  if (typeof sid !== 'string' || sid === '') return false;
  try {
    CacheService.getScriptCache().put('revoked:' + sid, '1', REVOKED_SID_TTL_S);
    return true;
  } catch (e) {
    // Best-effort: el logout NO puede fallar por esto (D10-7). Si la
    // caché está caída, la sesión sigue viva hasta que expire sola.
    return false;
  }
}

function sidRevoked_(sid) {
  if (typeof sid !== 'string' || sid === '') return false;
  var value = CacheService.getScriptCache().get('revoked:' + sid);
  return value !== null && value !== undefined && String(value) !== '';
}

// Filas de `_users` como objetos con nombre de columna.
// Un fallo acá es de CONFIGURACIÓN (500), nunca de credencial: una hoja mal
// formada no puede parecerse a «contraseña incorrecta».
function readUsers_() {
  var ss = openSpreadsheet_();
  if (ss.getSheetByName('_users') === null) {
    throw apiError_(500, 'El sistema de usuarios no está configurado');
  }
  var data = readSheetData_(ss, '_users');
  var headers = data.headers;
  if (headers.indexOf('id') === -1 || headers.indexOf('email') === -1) {
    throw apiError_(500, 'La hoja _users no tiene las columnas esperadas');
  }
  var rows = [];
  for (var r = 0; r < data.rows.length; r++) {
    var values = data.rows[r].values;
    var row = {};
    for (var c = 0; c < headers.length; c++) row[headers[c]] = values[c];
    rows.push(row);
  }
  return rows;
}

// ── Snapshot de sesión CACHEADO (R2.15 — auth.md §3.4 paso 4) ─────────────
//
// Antes CADA request abría `_users`. §3.4 pide «coste típico: 0 lecturas
// de hoja por request (salvo el snapshot, una vez por minuto)», y ese TTL
// de 60 s es también lo que hace que bajar a alguien o subirle
// `token_version` sea *firme ya, efectivo en ≤ 60 s* (§4.6): la caché ES
// el semáforo, no una optimización que haya que invalidar a mano.
//
// Tres cuidados:
//   · **No cachea `pass_hash`/`pass_salt`.** `CacheService` sólo tiene que
//     ser fiable para lo que se pueda perder (§2) y una credencial no lo
//     es. Tampoco hace falta: `verifySession_` no los mira y `publicUser_`
//     es una whitelist que tampoco.
//   · **Sólo se fía de un JSON legible.** `typeof raw === 'string'` deja
//     fuera el proxy inerte del harness, y `hit` tiene que ser un objeto
//     no nulo — `JSON.parse('null')` devuelve `null`, no un acierto.
//   · **La caché acelera, nunca decide.** Todo lo que falle (sin caché,
//     caché caída, JSON roto) cae a la hoja y se reescribe.
var SESSION_SNAPSHOT_TTL_S = 60;
var SESSION_SNAPSHOT_SKIP_FIELDS = ['pass_hash', 'pass_salt'];

function sessionSnapshot_(sub) {
  var key = 'usnap:' + String(sub);
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
  } catch (e) {
    cache = null;
  }

  if (cache !== null && cache !== undefined) {
    var raw = null;
    try {
      raw = cache.get(key);
    } catch (e) {
      raw = null;
    }
    if (typeof raw === 'string' && raw !== '') {
      try {
        var hit = JSON.parse(raw);
        if (hit !== null && typeof hit === 'object') return hit;
      } catch (e) {
        /* JSON roto: se va a la hoja y se vuelve a escribir */
      }
    }
  }

  var user = snapshotUser_(sub);
  if (user === null) return null; // sin caché negativa: una baja se nota YA

  var snap = {};
  for (var name in user) {
    if (!Object.prototype.hasOwnProperty.call(user, name)) continue;
    if (SESSION_SNAPSHOT_SKIP_FIELDS.indexOf(name) === -1) snap[name] = user[name];
  }
  if (cache !== null && cache !== undefined) {
    try {
      cache.put(key, JSON.stringify(snap), SESSION_SNAPSHOT_TTL_S);
    } catch (e) {
      /* caché no disponible: se sigue sin ella */
    }
  }
  return snap;
}

// Fila de `_users` por id, o null si esa cuenta ya no existe.
function snapshotUser_(sub) {
  var wanted = String(sub);
  var rows = readUsers_();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === wanted) return rows[i];
  }
  return null;
}

// Fila de `_users` por email (case-insensitive), o null si no existe.
function findUserByEmail_(email) {
  var rows = readUsers_();
  for (var i = 0; i < rows.length; i++) {
    if (
      String(rows[i].email || '')
        .trim()
        .toLowerCase() === email
    )
      return rows[i];
  }
  return null;
}

// Pasos 1 a 4 de §3.4. El paso 5 (rol) lo resuelve requireAccess_ y el 6 y
// 7 los aporta el router.
function verifySession_(token) {
  if (typeof token !== 'string' || token.trim() === '') {
    throw apiError_(401, 'No autorizado', null, 'AUTH_REQUIRED');
  }

  var res = verifyToken_(token); // pasos 1 y 2
  if (!res.ok) throwTokenError_(res.reason);
  var payload = res.payload;

  if (sidRevoked_(payload.sid)) {
    // Revocado = la sesión terminó: misma salida que un token inválido.
    throw apiError_(401, 'No autorizado', null, 'AUTH_INVALID');
  }

  var user = sessionSnapshot_(payload.sub);
  if (user === null) {
    throw apiError_(401, 'No autorizado', null, 'AUTH_INVALID');
  }
  if (user.active !== true) {
    throw apiError_(401, 'No autorizado', null, 'AUTH_INVALID');
  }

  // `token_version` distinto ⇒ se subió la versión (R2.15) o la fila está
  // mal formada. En AMBOS casos lo correcto es no confiar: una fila sin
  // versión no puede validarse contra un token que tampoco la trae.
  var version =
    user.token_version === null || user.token_version === undefined
      ? ''
      : String(user.token_version).trim();
  if (!/^[0-9]+$/.test(version) || Number(version) !== Number(payload.v)) {
    throw apiError_(401, 'No autorizado', null, 'AUTH_INVALID');
  }

  return { payload: payload, user: user };
}

// Renovación deslizante (§3.2): si queda menos del TOKEN_RENEW_RATIO de
// vida, la respuesta trae `meta.renewedToken` y el front lo reemplaza.
// El tope de 7 días corta la cadena: la sesión se acabó ⇒ re-login (D10-2).
function renewMeta_(payload) {
  if (!payload || typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
    return null;
  }
  var now = Date.now();
  var total = payload.exp - payload.iat;
  if (!(total > 0)) return null;
  var remaining = payload.exp - now;
  if (remaining <= 0) return null; // ya vencido: no se renueva, se vuelve a entrar
  if (remaining > total * tokenRenewRatio_()) return null; // aún queda vida de sobra

  var orig = Number(payload.orig);
  if (!isFinite(orig) || orig <= 0) orig = payload.iat;
  if (now >= orig + sessionMaxMs_()) return null; // tope absoluto alcanzado

  return { renewedToken: issueToken_(payload) };
}
