// setup/00-check-properties — Verifica/genera propiedades según el manifiesto.
//
// Orden (baseapi §10.6 + D24): 1) leer manifiesto → 2) CREAR con `''` las
// 'manual' que falten (el operador sólo cambia el valor) → 3) verificar valor
// de las 'manual' (si siguen vacías o inválidas, SE DETIENE) → 4) anotar
// 'generated' pendientes (idempotente: nunca regenera si ya existen) →
// 5) resumen sin mostrar valores.
// Ejecución manual desde el editor de Apps Script o `clasp run-function`.

// Punto de entrada: creación de claves + verificación + resumen.
//
// D24: las propiedades MANUALES también se CREAN (vacías) acá. Antes sólo
// se listaban como «faltan» y había que poner clave Y valor a mano en el
// editor; ahora la clave ya existe y sólo cambia el valor. Un `''` sigue
// contando como «pendiente de valor», y `Props.require` trata `''` como no
// configurada — así el placeholder no degrada el error en runtime.
function checkProperties() {
  // ── 1) Crear con placeholder las manuales que falten ──────────────────────
  var creadas = [];
  var faltantes = [];
  PROP_MANIFEST.forEach(function (entry) {
    if (entry.source === 'manual' && Props.get(entry.name) === null) {
      faltantes.push(entry.name);
    }
  });
  if (faltantes.length > 0) {
    var placeholder = {};
    faltantes.forEach(function (name) {
      placeholder[name] = '';
    });
    Props.setAll(placeholder); // una sola escritura, y ya invalida la caché
    creadas = faltantes;
    Logger.log('✓ Claves creadas vacías — sólo falta cambiarles el valor: ' + creadas.join(', '));
  }

  // ── 2) Verificar valor de las manuales ───────────────────────────────────
  var pendientes = [];
  var invalid = [];

  PROP_MANIFEST.forEach(function (entry) {
    if (entry.source !== 'manual') return;

    var value = Props.get(entry.name);
    if (value === null || String(value).trim() === '') {
      pendientes.push(entry.name);
      return;
    }
    if (entry.name === 'ENV' && CONFIG.ENVIRONMENTS.indexOf(String(value).trim()) === -1) {
      invalid.push(entry.name + ' (esperado: ' + CONFIG.ENVIRONMENTS.join(' | ') + ')');
    }
  });

  if (pendientes.length > 0 || invalid.length > 0) {
    if (pendientes.length > 0) {
      Logger.log('✗ Pendientes de valor: ' + pendientes.join(', '));
      Logger.log('  Córgalas en: Configuración del proyecto → Propiedades de la secuencia');
      Logger.log('  de comandos, y vuelve a ejecutar checkProperties.');
    }
    if (invalid.length > 0) {
      Logger.log('✗ Propiedades con valor inválido: ' + invalid.join(', '));
    }
    return { ok: false, creadas: creadas, pendientes: pendientes, invalid: invalid };
  }
  Logger.log('✓ Propiedades manuales completas y válidas.');

  // ── 3) Generar 'generated' faltantes (idempotente) ─────────────────────────
  var generated = [];
  var pending = [];

  PROP_MANIFEST.forEach(function (entry) {
    if (entry.source !== 'generated' || Props.has(entry.name)) return;

    // D21-C: el generador `token` existía sólo para ADMIN_TOKEN_HASH y se
    // retiró con él en R2.6. AUTH_SECRET lo genera setupAuth_ (R2.2).
    pending.push(entry.name + ' → ' + entry.note);
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

  var summary = {
    ok: true,
    creadas: creadas,
    generated: generated,
    pending: pending,
    state: state,
  };
  Logger.log('Resumen: ' + JSON.stringify(summary, null, 2));
  return summary;
}

// D21-C (R2.6): `rotarToken` ya no existe — rotaba el hash del token admin
// antiguo, que se retiró junto con él. Las sesiones se cierran subiendo
// `token_version` (R2.15) o rotando `AUTH_SECRET`, que cierra TODAS.
