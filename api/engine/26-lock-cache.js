// engine/26-lock-cache — LockService + caché por recurso + rate-limit (baseapi §2.2 #9).
//
// Lock: TODA escritura corre bajo un lock exclusivo del script; dos
// reorders simultáneos se serializan y no corrompen position (criterio 9).
// Si nadie lo libera a tiempo → 409 y el cliente reintenta. La política
// `policies.lock === false` lo desactiva (F6-1); sin política ⇒ con lock.
//
// Caché: CacheService limita ≈100 KB por valor y 6 h, y NO permite listar
// claves → los valores grandes se trocean y la invalidación es por
// "generación" del recurso (timestamp nuevo al escribir): las lecturas
// buscan siempre bajo la generación vigente, así las entradas viejas quedan
// huérfanas y expiran solas. TTL corto: policies.cache.ttl (F6-1).
//
// Rate-limit (F6-3, §8): UNA sola implementación para todos los caminos.
// El router la llama con la política de la ruta ya resuelta ({ scope,
// limits: { read, write } }); el spec declarativo es '<n>/<min|sec|hour>'
// (p. ej. '<n>/min') y desde R2.13 admite ventana con multiplicador
// '<n>/<m><unidad>' (p. ej. '5/15min'). Ventana fija con reinicio en cada
// intento, en la caché del script y SIN lock: es control de uso, no
// barrera de seguridad.
//
// EXCEPCIÓN — el rate-limit del login (R2.13, auth.md §4.6): va BAJO
// LockService y cuenta fallos por cuenta, no intentos por ruta. No es un
// capricho: perder un conteo allí es abrir la ventana de fuerza bruta.
// Top-level: sólo declaraciones.

var CACHE_CHUNK_CHARS = 60000; // holgado bajo el límite de ~100 KB/valor
var CACHE_GEN_TTL_SECONDS = 21600; // la generación vive lo máximo permitido

// Ejecuta fn bajo lock exclusivo; 409 si otro proceso lo retiene mucho.
function withLock_(name, fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (lockError) {
    throw apiError_(409, 'Otra operación está en curso sobre ' + name + '; inténtalo de nuevo');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Lock condicional por política (F6-1/F6-5): policies.lock === false ⇒ sin
// lock; ausencia o true ⇒ lock — toda escritura queda protegida por defecto.
function withPolicyLock_(resource, fn) {
  if (resource.policies && resource.policies.lock === false) return fn();
  return withLock_(resource.id, fn);
}

// ── Rate-limit genérico (F6-3) ─────────────────────────────────────────────

// '<n>/<unidad>' → { limit, windowSeconds, human }; spec roto ⇒ 500 visible
// (una declaración ilegible NO debe degradarse en "sin límite").
//
// Desde R2.13 acepta además '<n>/<m><unidad>': '5/15min' abre la ventana a
// 15 minutos sin tocar el contador (auth.md §4.6: «5 fallos / 15 min por
// email»). El multiplicador va en la VENTANA, nunca en el límite — '5/15min'
// es 5 en 900 s, no 75 en 60 s. Sin multiplicador el spec sigue significando
// exactamente lo mismo que antes: '10/min' no cambia de ningún recurso.
function parseLimitSpec_(spec) {
  var match = /^(\d+)\/(\d+)?(min|sec|hour)$/.exec(String(spec));
  var limit = match ? Number(match[1]) : 0;
  var windows = { min: 60, sec: 1, hour: 3600 };
  var humans1 = { min: 'un minuto', sec: 'un segundo', hour: 'una hora' };
  var humansN = { min: 'minutos', sec: 'segundos', hour: 'horas' };
  if (!match || limit < 1) {
    throw apiError_(500, 'Límite inválido: ' + truncate_(String(spec)));
  }
  var mult = match[2] ? Number(match[2]) : 1;
  if (!isFinite(mult) || mult < 1) {
    throw apiError_(500, 'Límite inválido: ' + truncate_(String(spec)));
  }
  return {
    limit: limit,
    windowSeconds: windows[match[3]] * mult,
    human: mult === 1 ? humans1[match[3]] : mult + ' ' + humansN[match[3]],
  };
}

// Aplica el límite del grupo (read/write) para la política de la ruta.
// Sin límite declarado ⇒ no hace nada. 11ª llamada en ventana ⇒ 429.
function enforceRateLimit_(policy, group) {
  if (!policy || !policy.limits) return;
  var spec = policy.limits[group];
  if (!spec) return;
  var parsed = parseLimitSpec_(spec);
  var cache = CacheService.getScriptCache();
  var key = 'rl:' + policy.scope + ':' + group + ':' + spec;
  var used = Number(cache.get(key));
  if (!isFinite(used)) used = 0;
  if (used >= parsed.limit) {
    throw apiError_(429, 'Demasiadas solicitudes; espera ' + parsed.human, null, 'RATE_LIMITED');
  }
  cache.put(key, String(used + 1), parsed.windowSeconds);
}

// ── R2.13 — Ventana de FALLOS por cuenta (auth.md §4.6) ──────────────────
//
// Tres diferencias con el genérico de arriba, cada una por una razón:
//
//  1. Cuenta FALLOS, no intentos: sólo sube cuando las credenciales no
//     pasan. Un cliente que acierta no gasta presupuesto, y la ventana no
//     se consume por simplemente pisar el formulario.
//  2. El INCREMENTO va bajo LockService: `cache.get` + `cache.put` en dos
//     ejecuciones simultáneas pierde un conteo, y perder un conteo en login
//     es abrir la ventana. §4.6 lo pide a mano — el genérico de arriba es
//     control de uso y se queda sin lock a propósito.
//  3. La clave lleva la CUENTA: un email inexistente se bloquea igual que
//     uno real. Si no, el propio 429 diría «este email existe» — el rate
//     limit sería un comprobador de direcciones con cronómetro.
//
// Se declara en `limits.account` del endpoint ('<n>/<m><unidad>'), junto al
// límite global que sigue usando read/write. La clave se compone con el
// alcance que pase el caller (la ruta ya resuelta), no con un id crudo.
function accountLimitKey_(scope, account) {
  return 'rlf:' + scope + ':' + account;
}

// ¿La cuenta ya agotó su ventana? Sólo LEE — no necesita lock: un valor
// viejo retrasa el corte como mucho un intento, nunca lo salta.
function enforceAccountLimit_(scope, account, spec) {
  if (!spec) return;
  var parsed = parseLimitSpec_(spec);
  var used = Number(CacheService.getScriptCache().get(accountLimitKey_(scope, account)));
  if (isFinite(used) && used >= parsed.limit) {
    throw apiError_(429, 'Demasiados intentos; espera ' + parsed.human, null, 'RATE_LIMITED');
  }
}

// Registra un fallo BAJO LOCK. La ventana se reescribe entera en cada
// fallo, así que se desliza hacia atrás: con 5 fallos / 15 min, un ataque
// sostenido no desbloquea antes reintentando mucho.
function registerAccountFailure_(scope, account, spec) {
  if (!spec) return;
  var parsed = parseLimitSpec_(spec);
  var cache = CacheService.getScriptCache();
  var key = accountLimitKey_(scope, account);
  withLock_(scope, function () {
    var used = Number(cache.get(key));
    if (!isFinite(used)) used = 0;
    cache.put(key, String(used + 1), parsed.windowSeconds);
  });
}

function cacheGenKey_(resourceId) {
  return 'admgen:' + resourceId;
}

function cacheKey_(resourceId, kind, gen) {
  return 'adm:' + resourceId + ':' + gen + ':' + kind;
}

// Valor cacheado (JSON ya parseado) o null si no está / no parsea.
function cacheGet_(resourceId, kind) {
  var cache = CacheService.getScriptCache();
  var gen = cache.get(cacheGenKey_(resourceId)) || '0';
  var key = cacheKey_(resourceId, kind, gen);
  var head = cache.get(key);
  if (head === null || head === undefined) return null;

  var json = head;
  if (head.indexOf('__chunks__') === 0) {
    var count = Number(head.slice('__chunks__'.length));
    if (!isFinite(count) || count < 1) return null;
    var keys = [];
    for (var i = 0; i < count; i++) keys.push(key + '#' + i);
    var parts = cache.getAll(keys);
    json = '';
    for (var j = 0; j < keys.length; j++) {
      var part = parts[keys[j]];
      if (part === undefined || part === null) return null; // trozo perdido
      json += part;
    }
    if (json === '') return null;
  }
  try {
    return JSON.parse(json);
  } catch (parseError) {
    return null;
  }
}

// Guarda valor bajo la generación vigente; trocea si supera el límite.
function cachePut_(resourceId, kind, value, ttlSeconds) {
  var cache = CacheService.getScriptCache();
  var gen = cache.get(cacheGenKey_(resourceId)) || '0';
  var key = cacheKey_(resourceId, kind, gen);
  var json = JSON.stringify(value);
  var ttl = ttlSeconds > 0 ? ttlSeconds : CONFIG.CACHE_TTL_SECONDS;

  if (json.length <= CACHE_CHUNK_CHARS) {
    cache.put(key, json, ttl);
    return;
  }
  var count = Math.ceil(json.length / CACHE_CHUNK_CHARS);
  var batch = {};
  for (var i = 0; i < count; i++) {
    batch[key + '#' + i] = json.slice(i * CACHE_CHUNK_CHARS, (i + 1) * CACHE_CHUNK_CHARS);
  }
  batch[key] = '__chunks__' + count; // cabecera: indica troceado
  cache.putAll(batch, ttl);
}

// Invalida TODA la caché del recurso: nueva generación = nuevas claves.
// La generación es ÚNICA por invalidación (timestamp + sufijo aleatorio):
// dos escrituras en el MISMO milisegundo no deben reusarla, o la lectura
// posterior volvería con datos ya obsoletos. Las entradas viejas quedan
// huérfanas bajo generaciones anteriores y expiran solas (no hay listado
// de claves en CacheService).
function cacheInvalidate_(resourceId) {
  var gen = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10);
  CacheService.getScriptCache().put(cacheGenKey_(resourceId), gen, CACHE_GEN_TTL_SECONDS);
}
