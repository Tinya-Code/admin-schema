// capabilities/computed — Generadores parametrizados (mejoras §6).
//
// Categoría `computed` de REGISTRY.capabilities: fn(value, params) → string.
// Su proyección legacy es REGISTRY.transforms, que es lo que sigue leyendo
// engine/24-crud (computeRules_).
// El motor (engine/24-crud, computeRules_) los invoca desde la declaración
//   resource.operations.create.computed = [{ field, transform, from, params? }]
// sólo al CREAR y sólo si el destino viene vacío (ver 24-crud).
// Transform no registrado o declaración mal formada = 500 (§16: el schema manda).
//
// slugify — réplica EXACTA de src/app/shared/utils/slugify.ts (baseapi §12:
// mismo vocabulario en los dos lados). 'Lomo Saltado Ñoño' → 'lomo-saltado-nono'.
// Params con defaults = comportamiento canónico:
//   lower  → minúsculas (default true)
//   sep    → separador (default '-')
//   keep   → regex de caracteres conservados (default 'a-z0-9')
//
// token — código de referencia corto para un pedido (PickPass viabilidad §B1.1).
//
// IGNORA su entrada. 24-crud:612-614 exige `from` no vacío, pero un token
// aleatorio no se deriva de ningún campo: `from` sólo dispara la generación.
// Si derivara del nombre del cliente, dos pedidos del mismo cliente
// compartirían código.
//
// El alfabeto tiene 32 símbolos SIN ambiguos (0/O, 1/I se confunden cuando
// el local lee el código en voz alta) y 32 = 2^5 hace que mapear un byte a un
// símbolo sea uniforme sin rechazo. 32^6 ≈ 1.070 M de combinaciones.
//
// La unicidad NO la garantiza este transform: la garantiza `unique` en
// 23-validate:65 contra la hoja, así que un choque devuelve 409 y no datos
// rotos.
//
// Params con defaults = comportamiento canónico:
//   length  → nº de símbolos (default 6, techo 64; sólo enteros > 0)
//   prefix  → prefijo literal sumado delante (default '')
//
// pin — PIN de autorización del retiro (PickPass Fase 5).
//
// TAMBIÉN IGNORA su entrada, igual que `token`: el PIN es aleatorio y no se
// deriva de ningún campo, por la misma razón — dos pedidos no pueden
// compartir PIN. `from` sólo dispara la generación (24-crud:637).
//
// A diferencia de `token` es SOLO DÍGITOS: el cliente lo teclea en el
// mostrador y el local lo lee en voz alta. Por eso NO se mapea el byte
// directo — 256 % 10 ≠ 0 pondría el 0 con más probabilidad — y se descartan
// los bytes ≥ 250 (rejection sampling: quedan 250 = 25 × 10 valores, así los
// 10 dígitos salen equiprobables).
//
// Entropía: `tokenBytes_` prueba Web Crypto y en Apps Script V8 cae a
// `Math.random`, que NO es criptográfico — suficiente para el `ref`, que no
// es una credencial, pero NO para el PIN, que sí lo es (nota de arriba). En
// GAS se prefiere `Utilities.getUuid()`, cuyo material sale del CSPRNG de la
// plataforma; en Node (tests) esa global no existe y se cae a `tokenBytes_`.
//
// Dónde vive: el PIN en claro se guarda SÓLO en la fila del pedido, que es lo
// que el operador copia en el mensaje. Su SHA-256 lo escribe el hook
// `pinHash` en `_pin`, y contra ese hash compara `pin-verify` — que además
// trae rate-limit, 5 intentos por ventana y el TTL de `pin_ttl_hours`.
//
// Params con defaults = comportamiento canónico:
//   length  → nº de dígitos (default 6, techo 12; sólo enteros > 0)
//
// Entropía: Web Crypto donde existe (Node, browsers). Apps Script V8 no la
// expone, así que cae a Math.random — el mismo criterio que 26-lock-cache:144.
// El `ref` no es una credencial: eso lo es el PIN (Etapa 2, fase 5).
var TOKEN_ALPHABET_ = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// 250 = 25 × 10: por encima se descarta el byte, por debajo `byte % 10` es
// uniforme sobre los 10 dígitos.
var PIN_ACCEPT_MAX_ = 250;
// Techo del bucle de rechazo: con ~20 % de rechazo esperado,8 vueltas de un
// PIN de 12 dígitos ya son un colapso estadístico imposible. Mejor un PIN
// corto que un bucle infinito en runtime.
var PIN_ATTEMPTS_ = 8;

function tokenBytes_(n) {
  var out = new Uint8Array(n);
  var webCrypto =
    typeof crypto === 'object' && crypto !== null && typeof crypto.getRandomValues === 'function';
  if (webCrypto) {
    crypto.getRandomValues(out);
    return out;
  }
  for (var i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

// Bytes aleatorios para el PIN: CSPRNG de la plataforma en GAS, `tokenBytes_`
// en Node (tests).
//
// El formato se VALIDA: `_harness.js` stubbea `Utilities` con un Proxy y
// `typeof Utilities.getUuid` devuelve 'function', así que sin esta guarda el
// `while` de abajo nunca avanzaría (un llenado de 0 bytes con `filled > 0`
// daría además bytes 0 ⇒ sesgo hacia el dígito cero).
function pinBytes_(n) {
  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.getUuid === 'function') {
    var out = new Uint8Array(n);
    var filled = 0;
    var intentos = 0;
    while (filled < n && intentos++ < 64) {
      var uuid = Utilities.getUuid();
      if (typeof uuid !== 'string') break; // proxy del harness de tests
      var hex = uuid.replace(/-/g, '');
      if (hex.length !== 32) break; // formato inesperado
      for (var i = 0; i + 1 < hex.length && filled < n; i += 2) {
        out[filled++] = parseInt(hex.substr(i, 2), 16);
      }
    }
    if (filled === n) return out;
  }
  return tokenBytes_(n);
}

var COMPUTED_ = {
  slugify: function (value, params) {
    var p = params || {};
    var lower = p.lower !== false;
    var sep = p.sep === undefined ? '-' : String(p.sep);
    var keep = p.keep === undefined || p.keep === null ? 'a-z0-9' : String(p.keep);
    var text = String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (lower) text = text.toLowerCase();
    text = text.trim();
    text = text.replace(new RegExp('[^' + keep + ']+', 'g'), sep);
    if (sep !== '') {
      var esc = sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp('^' + esc + '+|' + esc + '+$', 'g'), '');
    }
    return text;
  },

  // value no se usa: ver la nota «IGNORA su entrada» arriba.
  token: function (value, params) {
    var p = params || {};
    var length = parseInt(p.length, 10);
    if (!(length > 0)) length = 6;
    else if (length > 64) length = 64;
    var prefix = p.prefix === undefined || p.prefix === null ? '' : String(p.prefix);
    var base = TOKEN_ALPHABET_.length; // 32 ⇒ 256 % 32 === 0, mapeo uniforme
    var bytes = tokenBytes_(length);
    var out = prefix;
    for (var i = 0; i < length; i++) out += TOKEN_ALPHABET_[bytes[i] % base];
    return out;
  },

  // value se IGNORA (ver la nota «TAMBIÉN IGNORA su entrada» arriba).
  pin: function (value, params) {
    var p = params || {};
    var length = parseInt(p.length, 10);
    if (!(length > 0)) length = 6;
    else if (length > 12) length = 12;
    var out = '';
    var attempt = 0;
    while (out.length < length && attempt < PIN_ATTEMPTS_) {
      attempt++;
      var bytes = pinBytes_(length);
      for (var i = 0; i < bytes.length && out.length < length; i++) {
        if (bytes[i] >= PIN_ACCEPT_MAX_) continue; // rejection sampling
        out += String(bytes[i] % 10);
      }
    }
    return out;
  },
};

// Argumentos declarables por generador (lo que puede traer `params` en
// operations.<op>.computed). validate-registry los juzga al cargar (R3.15).
var COMPUTED_ARGS_ = {
  slugify: { lower: { type: 'boolean' }, sep: { type: 'text' }, keep: { type: 'text' } },
  token: { length: { type: 'number' }, prefix: { type: 'text' } },
  pin: { length: { type: 'number' } },
};
Object.keys(COMPUTED_).forEach(function (id) {
  registerCapability('computed', {
    id: id,
    since: '1.0',
    argsSchema: COMPUTED_ARGS_[id] || {},
    run: COMPUTED_[id],
  });
});

// ── R5.7 (B10) — el set del plan, con argsSchema ──────────────────────────
//
// `slug(from)` del plan = el `slugify` de arriba (mismo transform, otro
// nombre: no se duplica el id — D58). `now` ya existía. Los NUEVOS son
// sequence · uuid · hash · copy · currentUser · lookup, y todos reciben un
// tercer argumento `ctx` que el motor arma en computeRules_:
//
//   ctx = { ss, resource, payload, current, user, isNew, field }
//
// `ctx.field` es el CAMPO DESTINO de la declaración — sequence escanea esa
// misma columna para saber el próximo número. `ctx.user` es la identidad
// YA autenticada del request (router: request.user), no el usuario de
// Apps Script (que en GAS siempre es el dueño del despliegue).

// SHA-256 en GAS vía la plataforma; en Node (tests) Utilities está stubbeado
// con un Proxy — computeDigest devuelve un proxy SIN .length numérico, y
// pasarlo por .map produciría basura determinista con cara de hash. Ese
// proxy se detecta y se cae al fallback FNV-1a (NO criptográfico: sólo
// prueba el transform; en GAS corre el SHA-256 real).
function hashHex_(text) {
  if (
    typeof Utilities !== 'undefined' &&
    Utilities &&
    typeof Utilities.computeDigest === 'function'
  ) {
    var bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(text),
      Utilities.Charset.UTF_8,
    );
    if (bytes && typeof bytes.length === 'number' && bytes.length > 0) {
      return Array.prototype.map
        .call(bytes, function (b) {
          return ((b + 256) % 256).toString(16).slice(-2);
        })
        .join('');
    }
  }
  var h1 = 0x811c9dc5;
  var h2 = 0x9e3779b9;
  var s = String(text);
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    h1 = ((h1 ^ c) * 0x01000193) >>> 0;
    h2 = (h2 + c * (i + 1)) >>> 0;
    h2 = (h2 ^ (h2 << 13)) >>> 0;
  }
  return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
}

registerCapability('computed', {
  id: 'sequence',
  since: '1.1',
  argsSchema: { prefix: { type: 'text' }, pad: { type: 'number' } },
  // Próximo número sobre la MISMA columna destino (ctx.field): escanea los
  // valores existentes con el prefijo declarado y toma el máximo + 1.
  // La unicidad NO la garantiza este transform (dos creates concurrentes
  // leen el mismo max): la garantiza `unique` en 23-validate, como token.
  run: function (value, params, ctx) {
    var p = params || {};
    var prefix = p.prefix === undefined || p.prefix === null ? '' : String(p.prefix);
    var pad = parseInt(p.pad, 10);
    if (!(pad > 0)) pad = 4;
    else if (pad > 12) pad = 12;
    if (!ctx || !ctx.ss || !ctx.resource || !ctx.field) return '';
    var data = readSheetData_(ctx.ss, ctx.resource.sheet);
    var idx = data.headers.indexOf(ctx.field);
    var max = 0;
    if (idx !== -1) {
      data.rows.forEach(function (row) {
        var raw =
          row.values[idx] === undefined || row.values[idx] === null ? '' : String(row.values[idx]);
        if (raw.indexOf(prefix) !== 0) return;
        var n = parseInt(raw.slice(prefix.length), 10);
        if (isFinite(n) && n > max) max = n;
      });
    }
    var digits = String(max + 1);
    while (digits.length < pad) digits = '0' + digits;
    return prefix + digits;
  },
});

registerCapability('computed', {
  id: 'uuid',
  since: '1.1',
  argsSchema: {},
  // En GAS, el CSPRNG de la plataforma (Utilities.getUuid). En Node (tests)
  // esa global no da strings reales y se cae a 32 hex de tokenBytes_ — el
  // mismo criterio que pinBytes_.
  run: function () {
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.getUuid === 'function') {
      var u = Utilities.getUuid();
      if (typeof u === 'string' && u.length >= 32) return u;
    }
    var out = '';
    var bytes = tokenBytes_(16);
    for (var i = 0; i < bytes.length; i++) out += ('0' + bytes[i].toString(16)).slice(-2);
    return out;
  },
});

registerCapability('computed', {
  id: 'hash',
  since: '1.1',
  argsSchema: { field: { type: 'text' } },
  // SHA-256 del campo declarado en params.field, o del `from` si no hay
  // params. Útil para no guardar en claro lo que sólo se compara (ver
  // pinHash en capabilities/hooks: mismo criterio).
  run: function (value, params, ctx) {
    var p = params || {};
    var source = value;
    if (p.field && ctx && ctx.payload && ctx.payload[p.field] !== undefined) {
      source = ctx.payload[p.field];
    }
    if (source === undefined || source === null) return '';
    return hashHex_(String(source));
  },
});

registerCapability('computed', {
  id: 'copy',
  since: '1.1',
  argsSchema: { field: { type: 'text' } },
  // Copia VERBATIM otro campo del payload — sin slugify ni formato. Es el
  // `from` clásico pero apuntando a un campo que NO es el trigger.
  run: function (value, params, ctx) {
    var p = params || {};
    if (!p.field || !ctx || !ctx.payload) return '';
    var v = ctx.payload[p.field];
    if (v === undefined || v === null) return '';
    return String(v);
  },
});

registerCapability('computed', {
  id: 'currentUser',
  since: '1.1',
  argsSchema: {},
  // La identidad autenticada del request (ctx.user), nunca Session de Apps
  // Script — en GAS eso siempre es el dueño del despliegue. Sin identidad
  // ⇒ '' ⇒ el valor no se escribe (mismo criterio que el resto: vacío no
  // llena destino).
  run: function (value, params, ctx) {
    var user = ctx && ctx.user;
    if (!user) return '';
    if (user.email !== undefined && user.email !== null && String(user.email) !== '') {
      return String(user.email);
    }
    return user.id === undefined || user.id === null ? '' : String(user.id);
  },
});

registerCapability('computed', {
  id: 'lookup',
  since: '1.1',
  argsSchema: {
    resource: { type: 'text', required: true },
    field: { type: 'text', required: true },
  },
  // El `from` es la CLAVE del registro destino (keyField del otro recurso)
  // y params.field la columna a traer. Sin coincidencia ⇒ '' ⇒ el destino
  // queda vacío y `required` lo dice en el 422. Recurso inexistente ⇒ 500
  // (§16: el schema manda, y una referencia rota es desajuste de almacén).
  run: function (value, params, ctx) {
    var p = params || {};
    if (typeof p.resource !== 'string' || typeof p.field !== 'string') return '';
    if (!ctx || !ctx.ss) return '';
    var target = getResourceSchema(p.resource);
    if (!target) throw apiError_(500, 'lookup: recurso inexistente "' + p.resource + '"');
    var map = storageMap_(target);
    var entries = flatEntries_(map, readSheetData_(ctx.ss, map.sheet));
    for (var i = 0; i < entries.length; i++) {
      var contract = flatToContract_(map, entries[i].flat);
      if (String(contract[map.keyField]) !== String(value)) continue;
      var out = contract[p.field];
      return out === undefined || out === null ? '' : String(out);
    }
    return '';
  },
});

// now — sello de fecha de las columnas con `field.computed: 'now'`.
// El sello lo genera nowStamp_() (50-audit.js, raíz): se declara acá para que
// la validación de carga (validate-registry, R3.15) pueda verificar la
// referencia. El motor sigue distinguiendo 'now' en 24-crud — §B1 pide
// «nada nuevo se añade tocando engine/».
registerCapability('computed', {
  id: 'now',
  since: '1.0',
  argsSchema: {},
  run: function () {
    return nowStamp_();
  },
});
