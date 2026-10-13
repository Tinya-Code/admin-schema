import type { ResourceSchema } from '../core/models/schema.model';

/**
 * Usuarios y roles (auth.md §4.2 · R7.6). Colección sobre la hoja interna
 * `_users`, sólo audiencia admin — el back verifica `role:admin` en cada
 * petición (policies.access), acá sólo se decide qué botones se muestran.
 *
 * `pass_hash` / `pass_salt` / `token_version` NO se declaran: son campos
 * `secret` del back, jamás viajan en una respuesta ni aparecen en
 * /admin/schema (R7.6/R7.7) — el form no puede pedir lo que no puede ver.
 */
export const usersSchema: ResourceSchema = {
  id: 'users',
  label: 'Usuario',
  labelPlural: 'Usuarios',
  kind: 'collection',
  uiViews: {
    list: { type: 'list' },
    create: { type: 'form', path: 'new' },
    edit: { type: 'form', path: ':key/edit' },
  },
  endpoint: {
    list: '/admin/users',
    get: '/admin/users/{key}',
    create: '/admin/users',
    update: '/admin/users/{key}',
    remove: '/admin/users/{key}',
  },
  keyField: 'id',
  titleField: 'name',
  // Sólo admin administra usuarios (§5.3): el menú y las rutas lo ocultan
  // al resto; el back vuelve a verificar `role:admin` en cada petición.
  access: { requires: 'role:admin' },
  listColumns: [
    { key: 'email', label: 'Email' },
    { key: 'name', label: 'Nombre' },
    { key: 'role', label: 'Rol' },
    { key: 'active', label: 'Activo', format: 'boolean' },
  ],
  fields: [
    {
      key: 'id',
      label: 'ID',
      type: 'text',
      required: true,
      // En alta lo genera el back (create.computed uuid, como products.slug):
      // el form no lo pide ni lo muestra. En edición se ve, pero es inmutable
      // (readonly + unique).
      hiddenOn: 'create',
      readonlyOn: 'always',
      // El back declara `unique: true` en el keyField; el contract-check
      // compara validators efectivos (top-level + validators.*).
      validators: { unique: true },
    },
    {
      key: 'email',
      label: 'Email',
      type: 'email',
      required: true,
      validators: { unique: true },
    },
    { key: 'name', label: 'Nombre', type: 'text', required: true },
    {
      key: 'role',
      label: 'Rol',
      type: 'select',
      required: true,
      options: [{ value: 'admin', label: 'Admin' }],
      default: 'admin',
    },
    { key: 'active', label: 'Activo', type: 'boolean', required: true, default: true },
    { key: 'last_login_at', label: 'Último acceso', type: 'readonly-text' },
    { key: 'created_at', label: 'Creado', type: 'readonly-text' },
  ],
};
