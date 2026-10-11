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
  // B3 · R5.3: un singleton sólo se LEE y se ACTUALIZA en su base.
  // `create`/`remove`/`reorder`/`bulk` apagados: sin declarar ⇒ 405.
  operations: {
    get: true,
    update: true,
    create: false,
    remove: false,
    reorder: false,
    bulk: false,
  },
  views: {},
  policies: {
    access: { read: 'admin', write: 'admin' },
    // R8.5: ttl 300 es seguro porque 24-crud invalida la caché en TODA
    // escritura (update incluido): cambiar public_base_url no deja al front
    // con la URL vieja más allá de la propia petición.
    cache: { ttl: 300 },
    audit: true,
    lock: true,
  },
  exposeToFront: true,
  // R8.5: kvColumns ['key','value','type','note'] coincide con lo que
  // 02-setup-sheets crea (principalColSpecs_ singleton) y con lo que
  // 04-setup-seed escribe ([key, def, type, '']) — hoja KV canónica.
  // D12: pin_ttl_hours y pin_enabled los consume pin-verify (R8.9):
  // TTL de vigencia y rechazo cuando el PIN está deshabilitado.
  fields: [
    { key: 'public_base_url', type: 'url', required: true },
    { key: 'share_message_template', type: 'textarea', required: true },
    { key: 'pin_ttl_hours', type: 'number', required: true, default: 24, min: 1, max: 720 },
    { key: 'pin_enabled', type: 'select', required: true, default: 'SI', enum: ['SI', 'NO'] },
  ],
};
