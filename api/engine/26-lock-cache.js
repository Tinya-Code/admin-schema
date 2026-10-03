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
// (p. ej. '<n>/min'). Ventana fija con reinicio en cada intento, en la
// caché del script y SIN lock: es control de uso, no barrera de seguridad.
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
function parseLimitSpec_(spec) {
  var match = /^(\d+)\/(min|sec|hour)$/.exec(String(spec));
  var limit = match ? Number(match[1]) : 0;
  var windows = { min: 60, sec: 1, hour: 3600 };
  var humans = { min: 'un minuto', sec: 'un segundo', hour: 'una hora' };
  if (!match || limit < 1) {
    throw apiError_(500, 'Límite inválido: ' + truncate_(String(spec)));
  }
  return { limit: limit, windowSeconds: windows[match[2]], human: humans[match[2]] };
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
    throw apiError_(429, 'Demasiadas solicitudes; espera ' + parsed.human);
  }
  cache.put(key, String(used + 1), parsed.windowSeconds);
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
