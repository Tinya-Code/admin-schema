// setup/00-check-properties — Verifica/genera propiedades según el manifiesto.
//
// Orden (baseapi §10.6): 1) leer manifiesto → 2) verificar 'manual' (si faltan,
// lista cuáles y SE DETIENE) → 3) generar 'generated' faltantes (idempotente:
// nunca regenera si ya existen) → 4) resumen sin mostrar valores.
// Ejecución manual desde el editor de Apps Script o `clasp run-function`.

// Punto de entrada: verificación + generación + resumen.
function checkProperties() {
  // ── 1–2) Manifiesto: verificar propiedades manuales ────────────────────────
  var missing = [];
  var invalid = [];

  PROP_MANIFEST.forEach(function (entry) {
    if (entry.source !== 'manual') return;

    var value = Props.get(entry.name);
    if (value === null) {
      missing.push(entry.name);
      return;
    }
    if (entry.name === 'ENV' && CONFIG.ENVIRONMENTS.indexOf(String(value).trim()) === -1) {
      invalid.push(entry.name + ' (esperado: ' + CONFIG.ENVIRONMENTS.join(' | ') + ')');
    }
  });

  if (missing.length > 0 || invalid.length > 0) {
    if (missing.length > 0) {
      Logger.log('✗ Faltan propiedades manuales: ' + missing.join(', '));
      Logger.log('  Córgalas en: Configuración del proyecto → Propiedades de la secuencia');
      Logger.log('  de comandos, y vuelve a ejecutar checkProperties.');
    }
    if (invalid.length > 0) {
      Logger.log('✗ Propiedades con valor inválido: ' + invalid.join(', '));
    }
    return { ok: false, missing: missing, invalid: invalid };
  }
  Logger.log('✓ Propiedades manuales completas y válidas.');

  // ── 3) Generar 'generated' faltantes (idempotente) ─────────────────────────
  var generated = [];
  var pending = [];

  PROP_MANIFEST.forEach(function (entry) {
    if (entry.source !== 'generated' || Props.has(entry.name)) return;

    if (entry.generator === 'token') {
      var token = Props.generateToken();
      Props.setAll({ ADMIN_TOKEN_HASH: Props.hashToken(token) });
      generated.push(entry.name);
      Logger.log('✓ ' + entry.name + ' generada.');
      // El token se muestra UNA sola vez; no se guarda en claro.
      Logger.log('  Token admin (cópialo ahora, no se volverá a mostrar): ' + token);
    } else {
      pending.push(entry.name + ' → ' + entry.note);
    }
  });

  // ── 4) Resumen (sólo nombres y estados, NUNCA valores) ─────────────────────
  var state = PROP_MANIFEST.map(function (entry) {
    var status;
    if (generated.indexOf(entry.name) !== -1) status = 'generada';
    else if (
      pending.some(function (p) {
        return p.indexOf(entry.name) === 0;
      })
    )
      status = 'pendiente';
    else status = 'ok';
    return { name: entry.name, source: entry.source, status: status };
  });
  pending.forEach(function (p) {
    Logger.log('… pendiente: ' + p);
  });

  var summary = { ok: true, generated: generated, pending: pending, state: state };
  Logger.log('Resumen: ' + JSON.stringify(summary, null, 2));
  return summary;
}

// Rotación manual del token admin (baseapi §10.7): genera uno nuevo, muestra
// UNA vez y actualiza sólo el hash.
function rotarToken() {
  var token = Props.generateToken();
  Props.setAll({ ADMIN_TOKEN_HASH: Props.hashToken(token) });
  Logger.log('✓ Token rotado. Nuevo token (cópialo ahora, no se volverá a mostrar): ' + token);
  return { ok: true, token: token };
}
