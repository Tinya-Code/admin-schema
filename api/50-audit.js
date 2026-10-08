// 50-audit — ÚNICA implementación de la traza en `_audit_log` (api.md §3.13).
//
// La comparten setup/03-setup-drift (cambios de SCHEMA_VERSION) y
// engine/24-crud (create | update | delete | reorder): UNA sola función,
// un solo formato de fila. Columnas: AUX_SHEETS._audit_log (schema/05) —
// [timestamp, actor, action, entity, entity_key, summary].
// Top-level: sólo declaraciones.

// `optActor` sólo lo usa la traza de AUTH (R2.14). En una web app de Apps
// Script `Session.getActiveUser()` devuelve al que DESPLIEGA, no a quien
// hizo login, así que ahí el actor real tiene que venir de fuera. El resto
// de llamadas sigue resolviéndolo como siempre.
function appendAuditRow_(ss, action, entity, entityKey, summary, optActor) {
  var sheet = ss.getSheetByName('_audit_log');
  if (sheet === null) return false;
  var actor = 'setup';
  if (typeof optActor === 'string' && optActor !== '') {
    actor = optActor;
  } else {
    try {
      actor = Session.getActiveUser().getEmail() || 'setup';
    } catch (e) {
      /* sin sesión activa (corrida manual anónima) */
    }
  }
  sheet.appendRow([nowStamp_(), actor, action, entity, entityKey, summary]);
  return true;
}

// ── R2.14 · traza de AUTENTICACIÓN (auth.md §4.6) ─────────────────────────
//
// Misma hoja (`_audit_log`), misma función y MISMO formato de fila que el
// trazo de CRUD: una sola implementación, como exige el encabezado de este
// archivo. `entity` siempre es `'auth'` y la acción nombra el evento:
//
//   login_ok | login_fail | logout | forbidden
//
//   actor      → id del usuario (o 'anon' si no hay)
//   entity_key → email de la cuenta: es el único identificador que existe
//                en los CUATRO casos (un login fallido no tiene id), y en
//                CRUD `entity_key` ya es la llave natural del sujeto.
//   summary    → descripción corta, SIEMPRE sin credenciales.
//
// Dos reglas que no se negocian:
//   1. **Nunca** recibe tokens, contraseñas ni hashes. Sólo identificadores
//      públicos (id, email): el resumen lo arma el llamador.
//   2. **Nunca** tira abajo el flujo. Si falta la hoja o el append falla,
//      el login sigue igual. Perder una traza no es un error de usuario, y//      convertirlo en 500 le regalaría a cualquiera una forma de cortar//      el login a distancia.
function authAudit_(action, actor, entityKey, summary) {
  try {
    return appendAuditRow_(openSpreadsheet_(), action, 'auth', entityKey, summary, actor) === true;
  } catch (e) {
    console.error('[audit] ' + action + ': ' + (e && e.message ? e.message : e));
    return false;
  }
}

// Marca de tiempo local 'YYYY-MM-DD HH:mm:ss' (sin Utilities.formatDate:
// la zona la fija appsscript.json → America/Lima).
function nowStamp_() {
  var d = new Date();
  function pad(n) {
    return String(n).padStart(2, '0');
  }
  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    ' ' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes()) +
    ':' +
    pad(d.getSeconds())
  );
}
