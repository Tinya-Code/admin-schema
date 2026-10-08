// setup/05-setup-auth — Altas de autenticación, SOLO desde el editor de
// Apps Script (R2.2 / auth.md §4.7).
//
// «Nunca por endpoint» lo garantiza la estructura, no la suerte:
//   · core/10-router.js resuelve handlers con `globalThis[route.handler]`,
//     así que basta con que un endpoint DECLARE un nombre para exponerlo —
//     por eso existe EDITOR_ONLY_FNS y el guard de dispatchRoute_;
//   · schema/validate-registry.js comprueba AL CARGAR que ningún endpoint
//     declare una función de esta lista ⇒ el error sale en el arranque,
//     no en producción.
//
// Top-level: sólo declaraciones. Cero llamadas a APIs de Google al cargar.

// ── Coste del KDF (R2.1b / D19) ──────────────────────────────────────────
//
// auth.md §4.6 sólo dice «iteraciones ajustadas a lo que tolere el tiempo de
// ejecución»: ése es exactamente el ajuste. Cada iteración es una llamada a
// la interop Java de `Utilities.computeDigest`, así que el coste real SÓLO
// se conoce en el despliegue real — nunca en un spec (donde está stubbeado).
//
// Devuelve un entero dentro de [KDF_ITERATIONS_MIN, KDF_ITERATIONS_MAX] que
// cabe en `budgetMs`. No se fía del modelo lineal: calibra con un puñado de
// iteraciones, y luego EJECUTA el candidato de verdad y baja proporcional-
// mente hasta que entre en el presupuesto (máx. 4 pasadas).
function medirKdf_(budgetMs) {
  var budget = typeof budgetMs === 'number' && budgetMs > 0 ? budgetMs : CONFIG.KDF_BUDGET_MS;
  var min = CONFIG.KDF_ITERATIONS_MIN;
  var max = CONFIG.KDF_ITERATIONS_MAX;
  var salt = kdfNewSalt_();

  // 1) calibración barata
  var probe = 50;
  var msProbe = cronometrarKdf_(probe, salt);
  var porIteracion = msProbe / probe;
  if (!(porIteracion > 0)) {
    // Reloj demasiado grueso para medir: no se puede bajar con garantías,
    // así que se va al TECHO. Preferible un login lento a un hash débil.
    return max;
  }

  var candidato = Math.round(budget / porIteracion);

  // 2) verificación real + ajuste decreciente
  for (var intento = 0; intento < 4 && candidato > min; intento++) {
    candidato = Math.max(min, Math.min(max, candidato));
    var real = cronometrarKdf_(candidato, salt);
    if (real <= budget || real <= 0) break;
    var siguiente = Math.floor(candidato * (budget / real));
    // Nunca sube al ajustar: si la medida es rara, converge a la baja.
    if (siguiente >= candidato) siguiente = candidato - 1;
    candidato = siguiente;
  }

  return Math.max(min, Math.min(max, candidato));
}

// ms que tarda `iterations` iteraciones reales del KDF.
function cronometrarKdf_(iterations, salt) {
  var t0 = new Date().getTime();
  kdfHash_('sonda-de-coste', salt, iterations);
  return new Date().getTime() - t0;
}

// ── setupAuth_ (editor only) ─────────────────────────────────────────────
//
// Genera AUTH_SECRET y MIDE el coste del KDF en este despliegue. Idempotente:
// no pisa nada que ya exista (rotar AUTH_SECRET cierra TODAS las sesiones,
// así que eso es una operación aparte, no este setup).
//   setupAuth_()            → usa CONFIG.KDF_BUDGET_MS
//   setupAuth_(1000)        → fuerza otro presupuesto (p. ej. para re-medir)
function setupAuth_(budgetMs) {
  var creado = [];

  if (!Props.has('AUTH_SECRET')) {
    // Nunca se muestra: sólo firma y verifica HMAC (R2.3).
    Props.setAll({ AUTH_SECRET: Props.generateToken() });
    creado.push('AUTH_SECRET');
  }

  if (!Props.has('KDF_ITERATIONS')) {
    // Sólo se mide si falta: re-medir no cambia hashes ya emitidos (son
    // autocontenidos), pero sí los próximos, así que conviene medir una vez.
    Props.setAll({ KDF_ITERATIONS: String(medirKdf_(budgetMs)) });
    creado.push('KDF_ITERATIONS');
  }

  if (creado.length === 0) {
    Logger.log('✓ setupAuth_: AUTH_SECRET y KDF_ITERATIONS ya existían — nada que hacer.');
  } else {
    Logger.log('✓ setupAuth_ generó: ' + creado.join(', '));
    Logger.log('  AUTH_SECRET no se muestra nunca: sólo firma HMAC.');
  }
  return { ok: true, creado: creado };
}

// ── bootstrapAdmin_ (editor only) ────────────────────────────────────────
//
// Alta del administrador inicial en `_users` (auth.md §4.7): «el email del
// dueño, role admin». Nunca por endpoint.
//
// Fuentes, en orden (D24): argumento explícito > Script Properties
// (`ADMIN_EMAIL` / `ADMIN_PASSWORD`) > dueño de la sesión + contraseña
// generada. La capa de props es la que permite que el setup sea declarativo:
// `checkProperties()` crea las claves vacías y el operador sólo cambia el
// valor, sin pegar nada en el editor.
//
//   bootstrapAdmin_()                          → props, o en su defecto el
//                                                dueño + contraseña generada
//   bootstrapAdmin_('ana@x.com', 'secreta')    → contraseña explícita
//   bootstrapAdmin_(email, pass, 'Ana')        → nombre explícito
//
// Si no hay contraseña en ninguna fuente se genera una y se muestra UNA sola
// vez (mismo criterio que `rotarToken`): no se guarda nunca en claro.
//
// D25 — RECONCILIACIÓN de una fila existente: si hay contraseña EXPLÍCITA
// (argumento o `ADMIN_PASSWORD`) y el email ya existe, la fila se ACTUALIZA
// con esa contraseña en vez de devolver 409. Así `ADMIN_PASSWORD` es de
// verdad la fuente de verdad: cambiarla en Script Properties y volver a
// correr `setupAll()` la aplica.
//   · Sin contraseña explícita ⇒ 409 como siempre: la fila NO se toca.
//   · Si ya era esa contraseña ⇒ no se re-hashea (idempotente).
// Sigue siendo editor-only (auth.md §4.7): ninguna ruta HTTP llega acá.
function bootstrapAdmin_(email, password, name) {
  if (!Props.has('AUTH_SECRET') || !Props.has('KDF_ITERATIONS')) {
    throw new Error('Falta la configuración de auth — ejecuta setupAuth_() primero');
  }

  var ss = openSpreadsheet_();
  var sheet = ss.getSheetByName('_users');
  if (sheet === null) {
    throw new Error('No existe la hoja _users — ejecuta setupSheets() primero');
  }

  var propEmail = String(Props.get('ADMIN_EMAIL') || '').trim();
  var propPassword = String(Props.get('ADMIN_PASSWORD') || '');
  var userEmail = String(email || propEmail || Session.getActiveUser().getEmail() || '')
    .trim()
    .toLowerCase();
  if (!userEmail) {
    throw new Error(
      'No hay email: pásalo como primer argumento o fija ADMIN_EMAIL en Script Properties',
    );
  }

  var data = readSheetData_(ss, '_users');
  var headers = data.headers;
  if (
    headers.indexOf('email') === -1 ||
    headers.indexOf('id') === -1 ||
    headers.indexOf('pass_hash') === -1 ||
    headers.indexOf('pass_salt') === -1
  ) {
    throw apiError_(500, 'La hoja _users no tiene las columnas esperadas');
  }

  var emailIdx = headers.indexOf('email');
  var idIdx = headers.indexOf('id');
  var saltIdx = headers.indexOf('pass_salt');
  var hashIdx = headers.indexOf('pass_hash');

  // Contraseña: argumento > ADMIN_PASSWORD en props, o generada y mostrada
  // UNA vez. La de props se usa SÓLO para hashearla acá: el hash queda en
  // `_users` y esta propiedad no se vuelve a leer.
  //
  // `explicita` es la clave de D25: distingue «me pasaron una contraseña»
  // de «no hay ninguna fuente». Sólo en el primer caso una fila existente
  // se reconcilia; sin contraseña explícita la fila no se toca.
  var passwd = password || (propPassword !== '' ? propPassword : null);
  var explicita = passwd !== null;
  var generada = false;
  if (!passwd) {
    passwd = Props.generateToken();
    generada = true;
  }

  var existente = null;
  for (var i = 0; i < data.rows.length; i++) {
    if (
      String(data.rows[i].values[emailIdx] || '')
        .trim()
        .toLowerCase() === userEmail
    ) {
      existente = data.rows[i];
      break;
    }
  }

  // ── Fila existente: reconciliar o negarse (D25) ──────────────────────────
  if (existente !== null) {
    if (!explicita) {
      throw apiError_(409, 'Ya existe un usuario con ese email: ' + userEmail);
    }

    var idExistente = String(existente.values[idIdx] || '');

    // Idempotencia: si ya era esa contraseña no se re-hashea. Re-correr
    // setupAll() no debe cambiar lo que ya está bien (ni gastar un salt).
    if (kdfVerify_(passwd, existente.values[saltIdx], existente.values[hashIdx])) {
      Logger.log('✓ bootstrapAdmin_: ' + userEmail + ' ya tenía esa contraseña — nada que hacer.');
      return {
        ok: true,
        email: userEmail,
        id: idExistente,
        passwordGenerada: false,
        actualizada: false,
      };
    }

    // Salt y hash se calculan JUNTOS: cada `kdfNewSalt_()` es distinto, así
    // que separarlos dejaría la fila con un hash de otro salt.
    var saltNuevo = kdfNewSalt_();
    var hashNuevo = kdfHash_(passwd, saltNuevo, kdfIterations_());
    // Escritura por índice derivado de la cabecera (mismo criterio que el
    // resto del motor): el orden de las columnas de la hoja es irrelevante.
    sheet.getRange(existente.at, saltIdx + 1).setValue(saltNuevo);
    sheet.getRange(existente.at, hashIdx + 1).setValue(hashNuevo);

    Logger.log(
      '✓ bootstrapAdmin_: contraseña ACTUALIZADA para ' +
        userEmail +
        ' (D25: la contraseña explícita manda sobre la fila existente).',
    );
    return {
      ok: true,
      email: userEmail,
      id: idExistente,
      passwordGenerada: false,
      actualizada: true,
    };
  }

  // ── Alta nueva ────────────────────────────────────────────────────────────
  var salt = kdfNewSalt_();
  var hash = kdfHash_(passwd, salt, kdfIterations_());

  var fila = {};
  fila.id = Utilities.getUuid();
  fila.email = userEmail;
  fila.name = String(name || '').trim() || userEmail.split('@')[0];
  fila.role = 'admin';
  fila.active = true;
  fila.token_version = 1;
  fila.pass_hash = hash;
  fila.pass_salt = salt;
  fila.last_login_at = '';
  fila.created_at = nowStamp_();

  // Se escribe SIEMPRE por nombre de columna: si la hoja cambia de orden,
  // no se colaría ningún valor en una columna equivocada.
  sheet.appendRow(
    headers.map(function (h) {
      return fila[h] === undefined ? '' : fila[h];
    }),
  );

  Logger.log('✓ bootstrapAdmin_: ' + userEmail + ' (role admin).');
  if (generada) {
    Logger.log('  Contraseña (cópiala ahora, NO se volverá a mostrar): ' + passwd);
  } else {
    Logger.log('  Contraseña: la que pasaste — no se registró.');
  }
  return { ok: true, email: userEmail, id: fila.id, passwordGenerada: generada };
}
