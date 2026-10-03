// schema/05-aux-sheets — Hojas auxiliares: fuente única de SUS columnas
// (api.md §3.10, §3.11, §3.13). Así `setup/` y `50-audit.js` no
// hardcodean cabeceras en ningún lado. `_media` NO existe: con subida
// directa a Cloudinary el backend no se entera de cada archivo (baseapi §11.7).
// Top-level: sólo declaraciones.

var AUX_SHEETS = {
  // columnas = Object.keys(SHEET_ENUMS) → ver auxSheetColumns() (runtime)
  _enums: { columns: null, note: 'una columna por lista de valores permitidos' },
  _placeholders: { columns: ['pattern'], note: 'valores o patrones prohibidos (R8)' },
  _audit_log: {
    columns: ['timestamp', 'actor', 'action', 'entity', 'entity_key', 'summary'],
    note: 'action ∈ create | update | delete | reorder (api.md §3.13)',
  },
};

var AUX_SHEET_ORDER = ['_enums', '_placeholders', '_audit_log'];

// Columnas efectivas de una hoja auxiliar (resolución en runtime: evita
// referencias a otros archivos en tiempo de carga).
function auxSheetColumns(name) {
  if (name === '_enums') return Object.keys(SHEET_ENUMS);
  return AUX_SHEETS[name].columns;
}
