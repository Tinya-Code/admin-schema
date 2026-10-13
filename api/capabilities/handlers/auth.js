// capabilities/handlers/auth — Endpoints de sesión (R2.5 — auth.md §4.3).
//
// Sobre de respuesta (§4.5 / D10-5): se CONSERVA el formato existente —
// JSON plano en éxito, { error: { status, message, code?, errors? } } en
// fallo — y sólo se AÑADEN los códigos AUTH_* / FORBIDDEN / RATE_LIMITED.
// Nunca `{ ok: false }`.
//
//   authLogin  — público. Email + contraseña (§9.1: opción B) → token.
//   authMe     — sesión. Devuelve el usuario YA resuelto por la cadena de
//                verificación (§3.4, R2.6 → `request.user`).
//   authLogout — sesión. Cierra la sesión en el cliente; la revocación del
//                `sid` llega en R2.16 (best-effort, D10-7).
//   authLogoutAll — sesión. Invalida todas las sesiones al incrementar
//                   token_version en _users.
//
// `authMe` y `authLogout` NO verifican nada por su cuenta: esa verificación
// es la cadena de §3.4, que vive en UN solo sitio (R2.6) y pone
// `request.user`. Duplicarla acá sería una segunda regla que se le
// contradice en cuanto cambie una de las siete etapas.
//
// Sin identidad resuelta ⇒ 401: no es un «stub», es el contrato correcto de
// un endpoint de sesión. Se enciende en cuanto R2.6 resuelva la identidad.

// Campos que SÍ salen al cliente. Whitelist, no `delete`: R2.17 exige que
// NINGUNA respuesta lleve pass_hash, pass_salt ni token_version — si alguien
// añade una columna a `_users`, ésta no sale sola.
var AUTH_PUBLIC_USER_FIELDS = [
  'id',
  'email',
  'name',
  'role',
  'active',
  'last_login_at',
  'created_at',
];

function publicUser_(user) {
  var out = {};
  for (var i = 0; i < AUTH_PUBLIC_USER_FIELDS.length; i++) {
    var key = AUTH_PUBLIC_USER_FIELDS[i];
    if (user[key] !== undefined && user[key] !== null) out[key] = user[key];
  }
  return out;
}

// Fila de `_users` por email → `findUserByEmail_` vive en core/11-auth.js:
// la comparten el login (acá) y el snapshot de la cadena de §3.4 (R2.6).

// POST /auth/login — auth.md §4.3.
function authLogin(payload, request) {
  var email =
    payload && payload.email !== undefined && payload.email !== null
      ? String(payload.email).trim().toLowerCase()
      : '';
  var password =
    payload && payload.password !== undefined && payload.password !== null
      ? String(payload.password)
      : '';

  var errors = [];
  if (email === '') errors.push({ path: 'email', message: 'Requerido' });
  if (password === '') errors.push({ path: 'password', message: 'Requerido' });
  if (errors.length > 0) throw validationError_(errors);

  // UN solo estado y UN solo mensaje para todo lo que pueda ser una
  // credencial mala: email inexistente, contraseña errónea, cuenta
  // desactivada o hash corrupto. No se distingue «no existe ese email»
  // de «la contraseña no es»: el endpoint no puede ser un comprobador de
  // direcciones de correo (§4.5).
  var credencialesInvalidas = function () {
    throw apiError_(401, 'Credenciales inválidas', null, 'AUTH_INVALID');
  };

  // R2.13 — recorte por cuenta ANTES de todo lo caro: si esta dirección ya
  // agotó su ventana, ni se busca ni se quema KDF. El alcance es la ruta ya
  // resuelta (`request.path`), que es lo mismo que usa el límite global.
  var limits = (request && request.limits) || {};
  var accountSpec =
    typeof limits.account === 'string' && limits.account !== '' ? limits.account : null;
  var scope = request && typeof request.path === 'string' ? request.path : 'login';
  enforceAccountLimit_(scope, email, accountSpec);

  var user = findUserByEmail_(email);
  // §4.6: el coste es el MISMO haya o no usuario. La rama de email
  // inexistente solía saltar el KDF y contestar en microsegundos — eso es
  // un comprobador de direcciones de correo con cronómetro, y se ve desde
  // fuera sin dejar rastro.
  var valido =
    user !== null ? kdfVerify_(password, user.pass_salt, user.pass_hash) : kdfBurn_(password);
  if (user === null || !valido || user.active !== true) {
    // El fallo se registra SIEMPRE, exista o no el email: si el contador
    // sólo subiera para usuarios reales, el propio 429 diría «este email
    // está dado de alta».
    registerAccountFailure_(scope, email, accountSpec);
    // R2.14 — un intento recortado por rate-limit NO llega acá (corta antes
    // `enforceAccountLimit_`), así que `login_fail` cuenta los intentos que
    // de verdad llegaron a mirar credenciales: 1..5 por cuenta.
    authAudit_(
      'login_fail',
      user === null ? 'anon' : String(user.id || ''),
      email,
      'credenciales inválidas',
    );
    credencialesInvalidas();
  }

  var token = issueToken_({
    sub: String(user.id || ''),
    sid: 'ses_' + Utilities.getUuid(),
    v: user.token_version,
  });

  authAudit_('login_ok', String(user.id || ''), email, 'login correcto');
  return { token: token, user: publicUser_(user) };
}

// POST /auth/me — auth.md §4.3. Sólo devuelve lo que la cadena ya validó.
function authMe(payload, request) {
  var user = request && request.user;
  if (!user || user.active !== true) {
    throw apiError_(401, 'No autorizado', null, 'AUTH_REQUIRED');
  }
  return { user: publicUser_(user) };
}

// POST /auth/logout — auth.md §4.3.
function authLogout(payload, request) {
  var user = request && request.user;
  if (!user || user.active !== true) {
    throw apiError_(401, 'No autorizado', null, 'AUTH_REQUIRED');
  }
  // Primero se revoca y DESPUÉS se audita: si la traza falla, la sesión ya
  // quedó cortada. `revokeSid_` es best-effort y no tira nada abajo.
  revokeSid_(request && request.sid);
  authAudit_('logout', String(user.id || ''), String(user.email || ''), 'sesión cerrada');
  return { loggedOut: true };
}

// POST /auth/logout-all — cierre persistente de todas las sesiones del usuario.
// La caché de snapshots puede conservar el token_version anterior hasta 60 s;
// por eso la respuesta expone ese límite en lugar de prometer inmediatez.
function authLogoutAll(payload, request) {
  var user = request && request.user;
  var userId = user && user.active === true ? String(user.id || '') : '';
  if (userId === '') {
    throw apiError_(401, 'No autorizado', null, 'AUTH_REQUIRED');
  }

  return withLock_('_users', function () {
    var data = readSheetData_(openSpreadsheet_(), '_users');
    var idColumn = data.headers.indexOf('id');
    var versionColumn = data.headers.indexOf('token_version');
    if (idColumn === -1 || versionColumn === -1) {
      throw apiError_(500, 'La hoja _users no tiene id y token_version');
    }

    var row = null;
    for (var i = 0; i < data.rows.length; i++) {
      if (String(data.rows[i].values[idColumn]) === userId) {
        row = data.rows[i];
        break;
      }
    }
    if (row === null) {
      throw apiError_(401, 'No autorizado', null, 'AUTH_REQUIRED');
    }

    var rawVersion = row.values[versionColumn];
    if (rawVersion === null || rawVersion === undefined || String(rawVersion).trim() === '') {
      throw apiError_(500, 'token_version inválido para el usuario');
    }
    var version = Number(rawVersion);
    if (
      !isFinite(version) ||
      version < 0 ||
      Math.floor(version) !== version ||
      version >= 9007199254740991
    ) {
      throw apiError_(500, 'token_version inválido para el usuario');
    }
    row.values[versionColumn] = version + 1;
    writeRowsBlock_(
      data.sheet,
      data.headers,
      data.rows.map(function (entry) {
        return entry.values;
      }),
    );

    authAudit_('logout_all', userId, String(user.email || ''), 'todas las sesiones revocadas');
    return { sessionsRevoked: true, effectiveWithinSeconds: SESSION_SNAPSHOT_TTL_S };
  });
}

// Auto-registro, igual que el resto de handlers del repo: el router los
// resuelve por `REGISTRY.handlers[name]` (con fallback a `globalThis[name]`).
registerCapability('handlers', {
  id: 'handleAuthLogin',
  since: '1.0',
  argsSchema: null,
  run: authLogin,
});
registerCapability('handlers', { id: 'handleAuthMe', since: '1.0', argsSchema: null, run: authMe });
registerCapability('handlers', {
  id: 'handleAuthLogout',
  since: '1.0',
  argsSchema: null,
  run: authLogout,
});
registerCapability('handlers', {
  id: 'handleAuthLogoutAll',
  since: '1.0',
  argsSchema: null,
  run: authLogoutAll,
});
