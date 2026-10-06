// schema/resources/pickpass — Singleton de configuración PickPass.
// Front: src/app/schemas/pickpass.schema.ts

REGISTRY.resources.pickpass = {
  id: 'pickpass',
  kind: 'singleton',
  sheet: 'pickpass_config',
  kvColumns: ['key', 'value', 'type', 'note'],
  keyField: 'key',
  titleField: 'public_base_url',
  ordering: 'none',
  activeField: null,
  onDelete: 'none',
  dependents: [],
  listProjection: null,
  imageFolder: null,
  checks: [{ check: 'not-in-sheet', sheet: '_placeholders' }],
  views: {},
  policies: {
    access: { read: 'admin', write: 'admin' },
    cache: { ttl: 300 },
    audit: true,
    lock: true,
  },
  exposeToFront: true,
  fields: [
    { key: 'public_base_url', type: 'url', required: true },
    { key: 'share_message_template', type: 'textarea', required: true },
    { key: 'pin_ttl_hours', type: 'number', required: true, default: 24, min: 1, max: 720 },
    { key: 'pin_enabled', type: 'select', required: true, default: 'SI', enum: ['SI', 'NO'] },
  ],
};
