// capabilities/fieldTypes — Catálogo de tipos de campo (idéntico al front:
// base.md §5; baseapi §5) + metadatos de almacenamiento que consume
// engine/20-storage-map.
//
// Mismo vocabulario en los dos lados (baseapi §12): el front añade lo visual,
// acá vive lo estructural. 20 tipos = la unión FieldSchema del front.
// Top-level: sólo declaraciones (cero referencias a otros archivos al cargar).

var FIELD_TYPES_DECL_ = {
  // ── Escalares → una columna ────────────────────────────────────────────
  text: { storage: 'column', sheetFormat: 'text' },
  textarea: { storage: 'column', sheetFormat: 'text' },
  slug: { storage: 'column', sheetFormat: 'text' }, // minúsculas, URL-friendly
  number: { storage: 'column' },
  currency: { storage: 'column' }, // número puro, sin símbolo (api.md §3.2)
  boolean: { storage: 'column', sheetFormat: 'checkbox' }, // TRUE/FALSE
  select: { storage: 'column', sheetFormat: 'text' },
  multiselect: { storage: 'column', sheetFormat: 'text' }, // CSV: 'mon,tue'
  url: { storage: 'column', sheetFormat: 'text' },
  email: { storage: 'column', sheetFormat: 'text' },
  phone: { storage: 'column', sheetFormat: 'text' }, // +51… no vuelve número
  date: { storage: 'column', sheetFormat: 'text' }, // ISO YYYY-MM-DD
  time: { storage: 'column', sheetFormat: 'text' }, // HH:mm texto plano
  'readonly-text': { storage: 'column', sheetFormat: 'text' }, // calculado por el backend

  // ── Sólo presencia (R7.6 · B2 · auth.md §4.2) ──────────────────────────
  // NO es un tipo visual: es la marca de «esta columna existe en la hoja
  // pero JAMÁS viaja en una respuesta». `readable: false` la excluye del
  // /admin/schema (projectFields_), del filtrado de acceso (siempre se
  // quita, incluso para admin) y de listProjection (validate-registry).
  // `writeOnly: true` permite escribirla (p. ej. setear pass_hash) sin
  // que ninguna identidad pueda leerla de vuelta.
  secret: { storage: 'column', sheetFormat: 'text', readable: false, writeOnly: true },

  // ── Referencias e imagen ───────────────────────────────────────────────
  relation: { storage: 'column', fk: true, sheetFormat: 'text' }, // FK: <entidad>_slug
  image: { storage: 'column', sheetFormat: 'text', validate: 'cloudinary-origin' },
  //   ^ sólo https + prefijo de CLOUDINARY_CLOUD_NAME (baseapi §11.4);
  //     la clave SIEMPRE es image_url (api.md §1)

  // ── Compuestos ─────────────────────────────────────────────────────────
  // group: colección → columnas con prefijo (address_street);
  //        singleton → una fila KV por campo con clave aplanada (baseapi §5)
  group: { storage: 'group' },
  list: { storage: 'child-sheet' }, // 1:N hoja hija con position
  'string-list': { storage: 'child-sheet', valueColumn: true }, // 1:N, una columna de valor
  'key-value': { storage: 'child-sheet', kv: true }, // 1:N pares clave/valor
};

// Auto-registro por la puerta única (R3.14): la proyección legacy llena el
// FIELD_TYPES que siguen leyendo storage-map, validate, setup y rules —
// misma referencia, sin cambios en ningún consumidor.
Object.keys(FIELD_TYPES_DECL_).forEach(function (id) {
  var meta = FIELD_TYPES_DECL_[id];
  var descriptor = { id: id, since: '1.0', argsSchema: null, run: null };
  Object.keys(meta).forEach(function (key) {
    descriptor[key] = meta[key];
  });
  registerCapability('fieldTypes', descriptor);
});
