// 50-audit — ÚNICA implementación de la traza en `_audit_log` (api.md §3.13).
//
// La comparten setup/03-setup-drift (cambios de SCHEMA_VERSION) y
// engine/24-crud (create | update | delete | reorder): UNA sola función,
// un solo formato de fila. Columnas: AUX_SHEETS._audit_log (schema/05) —
// [timestamp, actor, action, entity, entity_key, summary].
// Top-level: sólo declaraciones.

function appendAuditRow_(ss, action, entity, entityKey, summary) {
  var sheet = ss.getSheetByName('_audit_log');
  if (sheet === null) return false;
  var actor = 'setup';
  try {
    actor = Session.getActiveUser().getEmail() || 'setup';
  } catch (e) {
    /* sin sesión activa (corrida manual anónima) */
  }
  sheet.appendRow([nowStamp_(), actor, action, entity, entityKey, summary]);
  return true;
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
