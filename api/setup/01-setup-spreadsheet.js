// setup/01-setup-spreadsheet — Crea o reutiliza el libro (idempotente).
//
// Regla (baseapi §13): el ID del libro vive SOLO en Script Properties
// (SPREADSHEET_ID, generada por este setup). Si ya existe y abre bien →
// se reutiliza; si no existe (o el ID quedó inválido) → se crea uno nuevo
// y se guarda. Ejecución manual desde el editor o `clasp run-function`.

// Punto de entrada: garantiza un libro accesible y su SPREADSHEET_ID.
function setupSpreadsheet() {
  var existing = Props.get('SPREADSHEET_ID');
  if (existing !== null) {
    try {
      var reused = SpreadsheetApp.openById(existing);
      Logger.log('✓ Libro existente reutilizado: ' + reused.getUrl());
      return { ok: true, reused: true, url: reused.getUrl() };
    } catch (e) {
      Logger.log('⚠ SPREADSHEET_ID inválido (' + e.message + '); se crea uno nuevo.');
    }
  }

  var env = Props.get('ENV') || 'dev';
  var ss = SpreadsheetApp.create('admin-schema (' + env + ')');
  Props.setAll({ SPREADSHEET_ID: ss.getId() });
  Logger.log('✓ Libro creado: ' + ss.getUrl());
  return { ok: true, reused: false, url: ss.getUrl() };
}
