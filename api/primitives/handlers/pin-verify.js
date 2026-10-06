// primitives/handlers/pin-verify — Verificación pública de PIN de autorización (Fase 5).
//
// Resuelto desde `REGISTRY.endpoints.pinVerify` (POST /p/orders/:ref/pin).
// Flujo:
//   1. Lee la hoja auxiliar `_pin` buscando filas para el `ref`.
//   2. Si no hay PIN configurado → 404 (el pedido no requiere PIN).
//   3. Verifica el hash SHA-256 del PIN recibido contra `pin_hash` almacenado.
//   4. Si el PIN ya fue usado → 409 (ya consumido).
//   5. Si el PIN no coincide → 401.
//   6. Marca `used_at` en la fila correspondiente → 200 { ok: true }.
//
// Seguridad:
//   - NUNCA comparación en texto plano: sólo SHA-256 (Props.hashText).
//   - El PIN recibido no se registra ni se loguea.
//   - Rate-limit declarado en el endpoint (5/min) — defensa en profundidad.
//
// Precedente de acceso a hoja auxiliar: `appendAuditRow_` (50-audit.js).

// Intentos fallidos que bloquean el pedido DENTRO de la ventana. La ventana
// es la MISMA que declara el endpoint (`limits: '5/min'`): antes el contador
// era para siempre, así que 5 errores — del cliente o de un tercero que
// conociera el ref — mataban el PIN del pedido de forma irreversible y había
// que borrar filas de `_pin` a mano.
var PIN_MAX_ATTEMPTS_ = 5;
var PIN_ATTEMPT_WINDOW_MS_ = 60 * 1000;

// Sello 'YYYY-MM-DD HH:mm:ss' (formato fijo de nowStamp_) → ms.
// Date.UTC sobre AMBOS sellos: se comparan dos marcas del mismo reloj
// local, así el timezone del runtime no entra en la resta. Sello ilegible ⇒
// NaN, que el llamador trata como fail-closed (se cuenta el intento).
function pinStampMs_(stamp) {
  var match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(String(stamp || ''));
  if (!match) return NaN;
  return Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]);
}

function handlePinVerify(payload, request) {
  var ref =
    request && request.params && request.params.ref
      ? String(request.params.ref).trim()
      : payload && payload.ref
        ? String(payload.ref).trim()
        : '';
  if (!ref) {
    throw apiError_(400, 'Falta la referencia del pedido en la ruta');
  }

  var pin =
    payload && payload.pin !== undefined && payload.pin !== null ? String(payload.pin).trim() : '';
  if (!pin) {
    throw apiError_(400, 'Falta el campo pin en el cuerpo de la solicitud');
  }

  var ss = openSpreadsheet_();
  var sheet = ss.getSheetByName('_pin');
  if (sheet === null) {
    throw apiError_(503, 'El sistema de PIN no está configurado');
  }

  // Lee todas las filas de _pin para este ref.
  var data = readSheetData_(ss, '_pin');
  var headers = data.headers;
  var allRows = data.rows;

  var refIdx = headers.indexOf('ref');
  var hashIdx = headers.indexOf('pin_hash');
  var createdIdx = headers.indexOf('created_at');
  var usedIdx = headers.indexOf('used_at');

  if (refIdx === -1 || hashIdx === -1) {
    throw apiError_(500, 'La hoja _pin no tiene las columnas esperadas');
  }

  // Filtra las filas de este pedido.
  var pinRows = allRows.filter(function (row) {
    return String(row.values[refIdx]) === ref;
  });

  if (pinRows.length === 0) {
    // No hay PIN configurado para este pedido.
    throw apiError_(404, 'No hay PIN configurado para este pedido');
  }

  // Toma el PIN activo: el más reciente NO usado (mayor created_at).
  var activeRow = null;
  for (var i = pinRows.length - 1; i >= 0; i--) {
    var usedAt = usedIdx !== -1 ? String(pinRows[i].values[usedIdx]) : '';
    if (!usedAt || usedAt.trim() === '') {
      activeRow = pinRows[i];
      break;
    }
  }

  if (activeRow === null) {
    // Todos los PINes de este pedido ya fueron consumidos.
    throw apiError_(409, 'El PIN de este pedido ya fue utilizado');
  }

  // Cuenta intentos fallidos RECIENTES: filas `__failed__` de este ref dentro
  // de la ventana declarada (`limits: '5/min'`), no las de toda la vida.
  var nowMs = pinStampMs_(nowStamp_());
  var failedAttempts = pinRows.filter(function (row) {
    // `__failed__` lleva used_at para no confundirse con el PIN activo.
    var usedAt = usedIdx !== -1 ? String(row.values[usedIdx]) : '';
    if (!usedAt || usedAt.trim() === '') return false;
    if (String(row.values[hashIdx]) !== '__failed__') return false;
    var atMs = pinStampMs_(createdIdx !== -1 ? String(row.values[createdIdx]) : '');
    if (isNaN(atMs)) return true; // sello ilegible ⇒ no regalar intentos
    return nowMs - atMs <= PIN_ATTEMPT_WINDOW_MS_;
  }).length;

  if (failedAttempts >= PIN_MAX_ATTEMPTS_) {
    throw apiError_(429, 'Demasiados intentos fallidos para este pedido');
  }

  // Verifica el hash — NUNCA comparación en texto plano.
  var expectedHash = String(activeRow.values[hashIdx]);
  var receivedHash = Props.hashText(pin);

  if (receivedHash !== expectedHash) {
    // Registra intento fallido en _pin como fila separada con hash '__failed__'.
    sheet.appendRow([ref, '__failed__', nowStamp_(), nowStamp_()]);
    throw apiError_(401, 'PIN incorrecto');
  }

  // PIN correcto: marca used_at en la fila activa.
  if (usedIdx !== -1) {
    var physicalRow = activeRow.at; // fila física 1-based en la hoja
    var usedColPhysical = usedIdx + 1; // columna física 1-based
    sheet.getRange(physicalRow, usedColPhysical).setValue(nowStamp_());
  }

  return { ok: true, ref: ref };
}

REGISTRY.handlers.handlePinVerify = handlePinVerify;

// Fase 5 — hook `pinHash`: el lado generador, par de `handlePinVerify`.
//
// Hasta ahora nadie escribía en `_pin`, así que la verificación respondía
// siempre 404 "el pedido no requiere PIN": sistema huérfano. Acá se cierra
// el circuito — el PIN en claro ya quedó en la fila del pedido (transform
// `pin` declarado en `operations.create.computed`) y acá se registra su
// SHA-256, que es lo único que consulta `pin-verify`. Texto plano NUNCA en
// `_pin`, salvo la marca `__failed__` de los intentos.
//
// Post-escritura y aislado por diseño: si falla, la escritura del pedido ya
// se hizo y `emitHook_` sólo lo deja en consola. El pedido queda sin
// verificación y `pin-verify` responde 404, que es exactamente el
// comportamiento seguro ante la ausencia de PIN.
REGISTRY.hooks.pinHash = function (ctx) {
  var key = ctx && ctx.key !== undefined ? String(ctx.key) : '';
  var pin = ctx && ctx.payload ? ctx.payload.pin : undefined;
  if (pin === undefined || pin === null || String(pin) === '') {
    // El computed no corrió (sin origen no se deriva): mejor un error en
    // consola que un 404 mudo en producción.
    throw new Error('orders/' + key + ': sin PIN generado, el computed no corrió');
  }
  var sheet = ctx.ss.getSheetByName('_pin');
  if (sheet === null) {
    throw new Error('_pin no existe: correr setupDrift desde el editor de Apps Script');
  }
  // [ref, pin_hash, created_at, used_at] — `used_at` vacío marca el PIN
  // activo: pin-verify toma el más reciente NO usado.
  sheet.appendRow([key, Props.hashText(String(pin)), nowStamp_(), '']);
};
