// primitives/transforms — Derivados parametrizados (mejoras §6).
//
// REGISTRY.transforms: fn(value, params) → string.
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

REGISTRY.transforms = {
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
