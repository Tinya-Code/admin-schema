// core/12-http — Envelope de respuesta (baseapi §8).
//
// GAS NO permite fijar el código de estado → TODAS las respuestas son HTTP
// 200 y el estado real viaja DENTRO del JSON:
//   éxito  → JSON plano
//   error  → { error: { status, message, errors?: [{ path, message }] } }
// Estados usados: 400 · 401 · 404 · 409 · 422 · 429 · 500.
// Los errores de validación llevan la lista COMPLETA con ruta (criterio 8).

// Respuesta de éxito: JSON plano, sin envoltorios.
function respond_(data) {
  return ContentService.createTextOutput(
    JSON.stringify(data === undefined ? null : data),
  ).setMimeType(ContentService.MimeType.JSON);
}

// Respuesta de error con el envelope canónico.
function respondError_(status, message, errors) {
  var error = { status: status, message: message };
  if (errors && errors.length > 0) error.errors = errors;
  return respond_({ error: error });
}

// Lanza un error con estado (y opcionalmente la lista de errores con ruta)
// para que el router lo capture y lo responda con respondError_.
function apiError_(status, message, errors) {
  var err = new Error(message);
  err.apiStatus = status;
  if (errors && errors.length > 0) err.apiErrors = errors;
  return err;
}

// Error de validación: TODOS los errores con ruta en un solo 422 (criterio 8).
function validationError_(errors) {
  return apiError_(422, 'Errores de validación', errors);
}

// Convierte cualquier excepción capturada en respuesta de error.
//   - Error con apiStatus → se responde con su estado y mensaje.
//   - Cualquier otra     → 500 genérico (el detalle va al LOG, jamás a la
//     respuesta: puede contener información interna).
function errorResponse_(err) {
  if (err && typeof err.apiStatus === 'number') {
    return respondError_(err.apiStatus, String(err.message || 'Error'), err.apiErrors);
  }
  Logger.log('✗ ' + (err && err.stack ? err.stack : String(err)));
  return respondError_(500, 'Error interno del servidor');
}
