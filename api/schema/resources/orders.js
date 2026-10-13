// schema/resources/orders — Pedidos y autorizados de retiro (PickPass).
// Front: src/app/schemas/orders.schema.ts

REGISTRY.resources.orders = {
  id: 'orders',
  commandsRoute: '/p/orders',
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
  // F7 · R7.2 (auth §4.8): qué viaja a CADA frontend. `exposeToFront`
  // sigue siendo la audiencia admin (equivalencia declarada en el plan);
  // la pública es lista blanca estricta y ES la que lee
  // `handlePublicOrder` — sin esta declaración ese endpoint no sirve nada.
  // De acá sale también la lista que R7.3 compara contra lo que la app
  // pública llama.
  audiences: {
    public: {
      listProjection: [
        'ref',
        'customer_name',
        'description',
        'pickup_date',
        'status',
        'reference_photo',
        'authorized_name',
        'authorized_photo',
        'auth_state',
        'created_at',
        'updated_at',
      ],
      // Sólo lectura (el validador lo exige): estas operaciones controlan el
      // CRUD público. La verificación del PIN es un endpoint propio (`pinVerify`)
      // con su contrato y política declarados en schema/endpoints/pin-verify.js.
      operations: ['get'],
    },
  },
  // B3 · R5.3: operaciones encendidas (sin declarar ⇒ 405). Los pedidos no
  // se reordenan ni se editan en bloque.
  operations: {
    list: true,
    get: true,
    create: {
      computed: [
        { field: 'ref', transform: 'token', from: 'customer_name' },
        { field: 'pin', transform: 'pin', from: 'customer_name' },
      ],
    },
    update: true,
    remove: true, // hard (por defecto): orders no tiene activeField
    reorder: false,
    bulk: false,
  },
  // El PIN en claro se queda en la fila del pedido; el hash lo escribe el
  // hook en `_pin` DESPUÉS de escribir. Si el hook falla, la escritura ya se
  // hizo (24-crud lo aísla: es reacción, no causa) y el pedido queda sin
  // verificación — `pin-verify` responde 404, que es exactamente el
  // comportamiento seguro ante la ausencia del PIN.
  hooks: {
    create: ['pinHash'],
  },
  // R8.8 (D14): regenerar el PIN de un pedido — la vía de R10 («pedidos sin
  // PIN recuperable») sin recrear el pedido. Escape hatch §6: el handler
  // rehace transform + fila + sustitución en `_pin` BAJO EL MISMO lock;
  // hacerlo en dos pasos deja el hash desincronizado de la fila. El dispatch
  // NO audita ni invalida caché en esta ruta — lo hace el propio handler.
  actions: {
    'regenerate-pin': { handler: 'handlePinRegenerate' },
  },
  commands: {
    'register-pickup-person': {
      input: {
        authorized_name: { type: 'text', required: true, maxLength: 80 },
        photo: { type: 'upload', profile: 'pickupPhoto', required: false },
      },
      output: {
        ok: { type: 'boolean', required: true },
        ref: { type: 'text', required: true },
        authorized_name: { type: 'text', required: true },
        authorized_photo: { type: 'image' },
        auth_state: { type: 'select', enum: ['NINGUNO', 'ACTIVA', 'REVOCADA'], required: true },
      },
      access: 'public',
      grant: 'pickupGrant',
      limits: '5/min',
      preconditions: [{ field: 'status', op: 'eq', value: 'PENDIENTE' }],
      changes: {
        authorized_name: { from: 'input.authorized_name' },
        authorized_photo: { from: 'input.photo' },
        auth_state: { value: 'ACTIVA' },
      },
      events: [
        {
          appendTo: 'history',
          operationIdField: 'operation_id',
          when: { field: 'auth_state', op: 'eq', value: 'ACTIVA' },
          values: {
            action: { value: 'AUTORIZADO_CAMBIADO' },
            detail: { value: 'Responsable de retiro actualizado' },
          },
        },
        {
          appendTo: 'history',
          operationIdField: 'operation_id',
          when: { field: 'auth_state', op: 'neq', value: 'ACTIVA' },
          values: {
            action: { value: 'AUTORIZADO' },
            detail: { value: 'Responsable de retiro registrado' },
          },
        },
      ],
      errors: [
        {
          status: 401,
          code: 'GRANT_REQUIRED',
          message: 'Se requiere el grant emitido al verificar el PIN.',
        },
        {
          status: 401,
          code: 'GRANT_INVALID',
          message: 'El grant no es válido.',
        },
        {
          status: 403,
          code: 'GRANT_SCOPE_MISMATCH',
          message: 'El grant o la carga no corresponde a este pedido y comando.',
        },
        {
          status: 409,
          code: 'GRANT_CONSUMED',
          message: 'El grant ya fue consumido por otra operación.',
        },
        {
          status: 409,
          code: 'GRANT_IN_PROGRESS',
          message: 'La operación está en curso y puede reintentarse con la misma clave.',
        },
        {
          status: 409,
          code: 'COMMAND_PRECONDITION_FAILED',
          message: 'El pedido ya no admite cambios en la autorización.',
        },
        {
          status: 409,
          code: 'IDEMPOTENCY_CONFLICT',
          message: 'La clave idempotente ya se usó con otra solicitud.',
        },
        {
          status: 409,
          code: 'OPERATION_FAILED',
          message: 'La operación falló y no puede reintentarse.',
        },
        {
          status: 410,
          code: 'GRANT_EXPIRED',
          message: 'La autorización temporal expiró.',
        },
        {
          status: 410,
          code: 'UPLOAD_EXPIRED',
          message: 'La carga temporal expiró.',
        },
        {
          status: 422,
          code: 'UPLOAD_TOO_LARGE',
          message: 'La imagen excede el máximo de 10 MiB.',
        },
        {
          status: 422,
          code: 'UPLOAD_FORMAT_NOT_ALLOWED',
          message: 'Formato permitido: JPEG, PNG o WebP.',
        },
        {
          status: 503,
          code: 'UPLOAD_PROVIDER_UNAVAILABLE',
          message: 'El proveedor de carga no está disponible temporalmente.',
        },
      ],
      idempotency: 'required',
    },
  },
  checks: [
    { check: 'not-in-sheet', sheet: '_placeholders' },
    { check: 'no-auth-after-delivered' },
    { check: 'history-append-only' },
  ],
  policies: {
    access: { read: 'admin', write: 'admin' },
    // R8.4: ttl 60 es seguro con audit+lock porque 24-crud llama
    // cacheInvalidate_ en TODA escritura (create/update/remove) ANTES del
    // lock: el TTL es techo de staleness entre mutaciones, no ventana de
    // datos viejos tras una.
    cache: { ttl: 60 },
    audit: true,
    lock: true,
  },
  // R8.4: los 4 views están consumidos por los widgets del dashboard
  // (dashboard.schema.ts): pendientes/entregados/cancelados alimentan las
  // metric-cards y el status-progress; pendientes_recientes alimenta el
  // record-list. Los 3 checks tienen specs (checks.spec.js,
  // check-ctx.spec.js, validate-registry.spec.js).
  views: {
    // Contadores para las metric-cards del dashboard.
    // aggregate: 'count' → devuelve [{ value: n }] (refactormotor.md B6).
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
        { key: 'operation_id', type: 'readonly-text', system: true },
      ],
    },
  ],
};
