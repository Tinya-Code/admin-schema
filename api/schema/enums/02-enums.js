// schema/enums/02-enums — Catálogos de valores (api.md §3.10, §3.11).
// Alimenta los desplegables de las hojas (setup/02-setup-sheets) y la
// validación declarativa de engine/23-validate. Seed en setup/04-setup-seed.
// Top-level: sólo declaraciones.

// Listas de valores permitidos (una columna por lista en la hoja `_enums`).
var SHEET_ENUMS = {
  availability: ['InStock', 'PreOrder', 'OutOfStock'],
  risk_class: ['I', 'IIa', 'IIb', 'III'],
  days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
};

// Valores o patrones PROHIBIDOS al guardar site/legal (R8, api.md §3.11);
// se pueblan en la hoja `_placeholders`.
var PLACEHOLDER_PATTERNS = [
  'example.com',
  '000 000 000',
  'TODO',
  'lorem',
  '00000000000',
  '12345678901',
];

// Auto-registro (mejoras §3). Las consumidoras siguen leyendo las vars
// originales: misma referencia, sin cambios.
REGISTRY.enums.sheetEnums = SHEET_ENUMS;
REGISTRY.enums.placeholderPatterns = PLACEHOLDER_PATTERNS;
