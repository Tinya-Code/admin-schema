// schema/resources/orders — Pedidos y autorizados de retiro (PickPass).
// Front: src/app/schemas/orders.schema.ts

REGISTRY.resources.orders = {
  id: 'orders',
  kind: 'collection',
  sheet: 'orders',
  keyField: 'ref',
  immutableKey: true,
  titleField: 'customer_name',
  ordering: 'none',
  activeField: null,
  onDelete: 'restrict',
  dependents: [],
  imageFolder: 'orders',
  exposeToFront: true,
  // `created_at` SE proyecta: la vista `pendientes_recientes` lo ordena
  // (27-views evalúa sobre los ítems ya proyectados por 24-crud).
  //
  // `pin` TAMBIÉN se proyecta: `list-view` interpola `shareTextTemplate`
  // sobre la fila PROYECTADA (list-view.ts:713), así que sin esta clave el
  // mensaje copiado desde la tabla saldría con el PIN en blanco. El detail y
  // el modal de alta reciben el registro completo, así que ahí nunca faltó.
  // Exponerlo acá no lo hace más visible de lo que ya está: el detail lo
  // muestra como campo readonly y la fila ya vive en el listado admin.
  listProjection: [
    'ref',
    'pin',
    'customer_name',
    'status',
    'pickup_date',
    'auth_state',
    'created_at',
  ],
  operations: {
    create: {
      computed: [
        { field: 'ref', transform: 'token', from: 'customer_name' },
        { field: 'pin', transform: 'pin', from: 'customer_name' },
      ],
    },
  },
  // El PIN en claro se queda en la fila del pedido; el hash lo escribe el
  // hook en `_pin` DESPUÉS de escribir. Si el hook falla, la escritura ya se
  // hizo (24-crud lo aísla: es reacción, no causa) y el pedido queda sin
  // verificación — `pin-verify` responde 404, que es exactamente el
  // comportamiento seguro ante la ausencia del PIN.
  hooks: {
    create: ['pinHash'],
  },
  checks: [
    { check: 'not-in-sheet', sheet: '_placeholders' },
    { check: 'no-auth-after-delivered' },
    { check: 'history-append-only' },
  ],
  policies: {
    access: { read: 'admin', write: 'admin' },
    cache: { ttl: 60 },
    audit: true,
    lock: true,
  },
  views: {
    // Contadores para las metric-cards del dashboard.
    // aggregate: 'count' → devuelve [{ value: n }] (motor-plan T2b / M2).
    pendientes: {
      where: [{ field: 'status', op: 'eq', value: 'PENDIENTE' }],
      aggregate: 'count',
    },
    entregados: {
      where: [{ field: 'status', op: 'eq', value: 'ENTREGADO' }],
      aggregate: 'count',
    },
    cancelados: {
      where: [{ field: 'status', op: 'eq', value: 'CANCELADO' }],
      aggregate: 'count',
    },
    // Lista de pedidos pendientes más recientes para el widget record-list del dashboard.
    pendientes_recientes: {
      where: [{ field: 'status', op: 'eq', value: 'PENDIENTE' }],
      sort: [{ field: 'created_at', dir: 'desc' }],
      limit: 5,
    },
  },
  fields: [
    { key: 'ref', type: 'text', required: true, unique: true },
    // PIN de autorización del retiro: lo genera el transform `pin` al crear.
    // Va en claro SÓLO en esta fila para que el operador pueda copiarlo en el
    // mensaje que manda al cliente; el SHA-256 vive en `_pin` y es lo que
    // compara `pin-verify` (Fase 5). Sin `system: true` a propósito:
    // 22-assemble:49 salta los campos system al construir la fila, así que
    // no llegaría a escribirse.
    { key: 'pin', type: 'text', maxLength: 12 },
    { key: 'customer_name', type: 'text', required: true, maxLength: 80 },
    { key: 'description', type: 'textarea', required: true, minWords: 3, maxWords: 120 },
    { key: 'pickup_date', type: 'date', required: true },
    {
      key: 'status',
      type: 'select',
      required: true,
      default: 'PENDIENTE',
      enum: ['PENDIENTE', 'ENTREGADO', 'CANCELADO'],
    },
    { key: 'reference_photo', type: 'image' },
    { key: 'customer_notes', type: 'textarea', maxLength: 500 },

    { key: 'authorized_name', type: 'text', maxLength: 80 },
    { key: 'authorized_photo', type: 'image' },
    { key: 'authorized_notes', type: 'textarea', maxLength: 300 },
    {
      key: 'auth_state',
      type: 'select',
      default: 'NINGUNO',
      enum: ['NINGUNO', 'ACTIVA', 'REVOCADA'],
    },

    { key: 'created_at', type: 'readonly-text', system: true, computed: 'now', format: 'date' },
    { key: 'updated_at', type: 'readonly-text', system: true, computed: 'now', format: 'date' },

    {
      key: 'history',
      type: 'list',
      sheet: 'order_history',
      fk: 'order_ref',
      min: 0,
      max: 200,
      itemFields: [
        { key: 'at', type: 'readonly-text', system: true, computed: 'now', format: 'date' },
        {
          key: 'action',
          type: 'select',
          enum: ['PEDIDO_CREADO', 'AUTORIZADO', 'AUTORIZADO_CAMBIADO', 'REVOCADO', 'ENTREGADO'],
        },
        { key: 'detail', type: 'text', maxLength: 120 },
      ],
    },
  ],
};
