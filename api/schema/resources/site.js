// schema/resources/site — Singleton de configuración (baseapi §15).
// Columnas: api.md §3.6–§3.8 · Front: src/app/schemas/site.schema.ts
// Hoja principal clave/valor; los grupos (address, geo) se aplanan con '_'
// en filas KV (address_street…). Hijas: hours (list) y social (string-list).
// Top-level: sólo declaraciones (auto-registro en REGISTRY, mejoras §3).

REGISTRY.resources.site = {
  id: 'site',
  kind: 'singleton',
  sheet: 'site_config',
  kvColumns: ['key', 'value', 'type', 'note'], // value SIEMPRE Texto plano (§3.6)
  keyField: 'key',
  titleField: 'name',
  ordering: 'none',
  activeField: null,
  onDelete: 'none', // un singleton no se borra
  dependents: [],
  listProjection: null, // sin listado
  imageFolder: null, // este recurso no tiene campos image
  checks: [{ check: 'not-in-sheet', sheet: '_placeholders' }], // R8 (mejoras §6)
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
    // ── Negocio / contacto ──────────────────────────────────────────────
    { key: 'name', type: 'text', required: true },
    { key: 'url', type: 'url', required: true },
    { key: 'description', type: 'textarea', required: true },
    { key: 'currency', type: 'text', required: true, default: 'PEN', pattern: '^[A-Z]{3}$' },
    { key: 'phone', type: 'phone', required: true, format: 'e164' },
    { key: 'whatsapp', type: 'phone', required: true, format: 'digits' },
    { key: 'email', type: 'email', required: true },

    // ── Grupos → en singleton: filas KV con clave aplanada (baseapi §5) ──
    {
      key: 'address',
      type: 'group',
      required: true,
      fields: [
        { key: 'street', type: 'text', required: true },
        { key: 'city', type: 'text', required: true },
        { key: 'region', type: 'text', required: true },
        { key: 'postal_code', type: 'text', required: true },
        { key: 'country', type: 'text', required: true, pattern: '^[A-Z]{2}$' },
      ],
    },
    {
      key: 'geo',
      type: 'group',
      required: true,
      fields: [
        { key: 'lat', type: 'number', required: true, min: -90, max: 90 },
        { key: 'lng', type: 'number', required: true, min: -180, max: 180 },
      ],
    },

    // ── Hoja hija: horarios (days = CSV, ensambla a days[]) ──────────────
    {
      key: 'hours',
      type: 'list',
      sheet: 'site_hours',
      positionField: 'position',
      itemFields: [
        { key: 'days', type: 'multiselect', required: true, enum: 'days' },
        { key: 'opens', type: 'time', required: true },
        { key: 'closes', type: 'time', required: true },
      ],
    },
    // ── Hoja hija: redes sociales (una URL por fila) ─────────────────────
    {
      key: 'social',
      type: 'string-list',
      sheet: 'site_social',
      positionField: 'position',
      valueColumn: 'url',
      itemType: 'url',
      extraColumns: [{ key: 'network', type: 'text', required: false }],
    },
  ],
};
