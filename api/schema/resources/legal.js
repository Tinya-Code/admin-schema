// schema/resources/legal — Singleton legal (libro de reclamaciones, IGV).
// Columnas: api.md §3.9 · Front: src/app/schemas/legal.schema.ts
// Hoja principal clave/valor (mismo formato que site_config).
// Top-level: sólo declaraciones (auto-registro en REGISTRY, mejoras §3).

REGISTRY.resources.legal = {
  id: 'legal',
  kind: 'singleton',
  sheet: 'legal_config',
  kvColumns: ['key', 'value', 'type', 'note'],
  keyField: 'key',
  titleField: 'legal_name',
  ordering: 'none',
  activeField: null,
  onDelete: 'none',
  dependents: [],
  listProjection: null,
  imageFolder: null,
  checks: [
    { check: 'not-in-sheet', sheet: '_placeholders' },
    {
      check: 'pattern',
      field: 'ruc',
      pattern: '^(\\d)\\1{10}$',
      negate: true,
      message: 'RUC inválido: dígitos repetidos',
    },
  ], // R8 + anti-uniformes (el pattern del campo cubre el formato)
  views: {},
  policies: {
    // §8: 11-auth lee `access` (no el prefijo de ruta); TTL de caché y
    // flags de audit/lock salen de acá (fail-closed: sin política ⇒ admin).
    access: { read: 'admin', write: 'admin' },
    cache: { ttl: 300 },
    audit: true,
    lock: true,
  },
  exposeToFront: true,
  fields: [
    { key: 'legal_name', type: 'text', required: true },
    { key: 'trade_name', type: 'text', required: true },
    { key: 'ruc', type: 'text', required: true, pattern: '^\\d{11}$' }, // formato declarativo + checks abajo
    { key: 'fiscal_address', type: 'text', required: true },
    {
      key: 'last_updated',
      type: 'readonly-text',
      required: true,
      system: true,
      computed: 'now',
      format: 'date',
    },
    { key: 'email', type: 'email', required: true },
    { key: 'phone', type: 'phone', required: true, format: 'e164' },
    { key: 'reclamos_email', type: 'email', required: true },
    { key: 'reclamos_response_days', type: 'number', required: true, min: 0 },
    { key: 'prices_include_igv', type: 'boolean', required: true, default: true },
    { key: 'currency', type: 'text', required: true, pattern: '^[A-Z]{3}$' },
  ],
};
