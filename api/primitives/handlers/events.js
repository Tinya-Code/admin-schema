// primitives/handlers/events.js — Escritura de eventos de uso en `_events` (Fase 6).
//
// Resuelto desde `REGISTRY.endpoints.events` (POST /admin/events).
//
// Columnas de _events: [timestamp, event, ref, session_id, meta]
//   - `event`      : nombre del evento (requerido, string corto)
//   - `ref`        : referencia del pedido (opcional)
//   - `session_id` : identificador de sesión del navegador (opcional)
//   - `meta`       : JSON serializado con contexto adicional (opcional)
//
// Restricciones de seguridad:
//   - `meta` se serializa en el backend: nunca se escribe un objeto crudo de Sheets.
//   - El tamaño de `meta` está limitado (MAX_META_BYTES_) para prevenir abuso.
//   - `event` se valida contra una longitud máxima para evitar spam.
//
// ⚠️ Los eventos reportados por el cliente NUNCA son fuente de verdad de estado
// (A4.13). Son señal de _uso_; el _estado_ lo da `_audit_log`.
//
// Precedente de hoja auxiliar directa: `appendAuditRow_` (50-audit.js).

var EVENTS_MAX_EVENT_LENGTH_ = 64;
var EVENTS_MAX_META_BYTES_ = 512;

function handleEvents(payload) {
  var event =
    payload && payload.event !== undefined && payload.event !== null
      ? String(payload.event).trim()
      : '';
  if (!event) {
    throw apiError_(400, 'Falta el campo event en el cuerpo de la solicitud');
  }
  if (event.length > EVENTS_MAX_EVENT_LENGTH_) {
    throw apiError_(
      400,
      'El campo event supera el máximo de ' + EVENTS_MAX_EVENT_LENGTH_ + ' caracteres',
    );
  }

  var ref = payload && payload.ref ? String(payload.ref).trim() : '';
  var sessionId = payload && payload.session_id ? String(payload.session_id).trim() : '';

  var metaRaw = '';
  if (payload && payload.meta !== undefined && payload.meta !== null) {
    try {
      metaRaw = JSON.stringify(payload.meta);
    } catch (e) {
      metaRaw = String(payload.meta);
    }
    if (metaRaw.length > EVENTS_MAX_META_BYTES_) {
      metaRaw = metaRaw.slice(0, EVENTS_MAX_META_BYTES_);
    }
  }

  var ss = openSpreadsheet_();
  var sheet = ss.getSheetByName('_events');
  if (sheet === null) {
    throw apiError_(503, 'La hoja _events no está configurada');
  }

  sheet.appendRow([nowStamp_(), event, ref, sessionId, metaRaw]);

  return { ok: true };
}

REGISTRY.handlers.handleEvents = handleEvents;
