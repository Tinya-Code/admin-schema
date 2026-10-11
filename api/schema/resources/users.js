// schema/resources/users — Gestión de usuarios (auth.md §4.2 · R7.6).
// Hoja interna `_users` (schema/05-aux-sheets); aquí se declara como
// cualquier otro recurso, sin código especial. Sólo audiencia admin.
//
// `pass_hash`/`pass_salt` son `secret` (R7.6): existen en la hoja pero
// jamás viajan en respuesta ni aparecen en /admin/schema — ni para admin.
// `token_version` tampoco viaja: su escritura es del motor de auth
// (invalidación de sesiones), no del CRUD del admin.

REGISTRY.resources.users = {
  id: 'users',
  kind: 'collection',
  sheet: '_users',
  keyField: 'id',
  immutableKey: true,
  titleField: 'name',
  activeField: 'active',
  listProjection: ['id', 'email', 'name', 'role', 'active', 'last_login_at'],
  operations: {
    list: true,
    get: true,
    create: true,
    update: true,
    remove: true, // baja lógica vía activeField (soft del motor)
  },
  policies: {
    // Fail-closed: sólo admin administra usuarios (auth.md §4.2).
    access: { read: 'role:admin', write: 'role:admin' },
    cache: { ttl: 60 },
    audit: true,
    lock: true,
  },
  exposeToFront: true, // sólo audiencia admin — el público jamás la ve
  fields: [
    { key: 'id', type: 'text', required: true, unique: true, immutable: true },
    { key: 'email', type: 'email', required: true, unique: true },
    { key: 'name', type: 'text', required: true },
    {
      key: 'role',
      type: 'select',
      enum: ['admin'], // §9.4: admin es el único rol asignado hoy
      required: true,
      default: 'admin',
    },
    { key: 'active', type: 'boolean', required: true, default: true },
    { key: 'pass_hash', type: 'secret' }, // jamás viaja (R7.6)
    { key: 'pass_salt', type: 'secret' }, // jamás viaja (R7.6)
    { key: 'token_version', type: 'secret' }, // invalidación de sesiones: del motor, no del CRUD
    { key: 'last_login_at', type: 'readonly-text' },
    { key: 'created_at', type: 'readonly-text' },
  ],
};
