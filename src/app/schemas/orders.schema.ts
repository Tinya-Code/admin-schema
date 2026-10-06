import type { ResourceSchema } from '../core/models/schema.model';

export const ordersSchema: ResourceSchema = {
  id: 'orders',
  label: 'Pedido',
  labelPlural: 'Pedidos',
  kind: 'collection',
  endpoint: {
    list: '/admin/orders',
    get: '/admin/orders/{key}',
    create: '/admin/orders',
    update: '/admin/orders/{key}',
    remove: '/admin/orders/{key}',
  },
  keyField: 'ref',
  titleField: 'customer_name',
  search: ['ref', 'customer_name', 'authorized_name'],
  filters: [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { label: 'Pendiente', value: 'PENDIENTE' },
        { label: 'Entregado', value: 'ENTREGADO' },
        { label: 'Cancelado', value: 'CANCELADO' },
      ],
    },
    {
      key: 'auth_state',
      label: 'Autorización',
      type: 'select',
      options: [
        { label: 'Ninguno', value: 'NINGUNO' },
        { label: 'Activa', value: 'ACTIVA' },
        { label: 'Revocada', value: 'REVOCADA' },
      ],
    },
  ],
  listColumns: [
    { key: 'ref', label: 'Ref' },
    { key: 'customer_name', label: 'Cliente' },
    { key: 'status', label: 'Estado' },
    { key: 'pickup_date', label: 'Fecha de retiro' },
    { key: 'auth_state', label: 'Autorización' },
  ],
  detail: {
    enabled: true,
    headerFields: ['ref', 'status', 'auth_state'],
  },
  postCreate: {
    mode: 'modal',
    title: '¡Pedido Registrado con Éxito!',
    description:
      'El pedido {ref} fue generado. Puede compartir el enlace de retiro con el cliente.',
    summaryFields: ['ref', 'customer_name', 'pickup_date', 'status'],
    actions: [
      {
        id: 'share_order',
        type: 'copy-share',
        label: 'Compartir con Cliente',
        urlTemplate: '{public_base_url}/p/{ref}',
        shareTextTemplate:
          'Hola {customer_name}, puede retirar su pedido {ref} aquí: {public_base_url}/p/{ref}. Su PIN es {pin}.',
      },
    ],
  },
  actions: [
    {
      id: 'share_order',
      type: 'copy-share',
      label: 'Compartir Enlace',
      urlTemplate: '{public_base_url}/p/{ref}',
      shareTextTemplate:
        'Hola {customer_name}, puede retirar su pedido {ref} aquí: {public_base_url}/p/{ref}. Su PIN es {pin}.',
    },
  ],
  layout: {
    mode: 'sections',
    sections: [
      { id: 'pedido', label: 'Datos del Pedido' },
      { id: 'autorizado', label: 'Persona Autorizada' },
      { id: 'historial', label: 'Historial de Eventos' },
      { id: 'sistema', label: 'Sistema' },
    ],
  },
  fields: [
    {
      type: 'text',
      key: 'ref',
      label: 'Código del Pedido',
      // El back lo genera (`operations.create.computed`, transform `token`):
      // es un código aleatorio, no una entrada del operador, de ahí el
      // `readonlyOn: 'create'` y el `help`.
      //
      // `required` + `unique` SÍ se declaran acá para que coincidan con el
      // back y no diverja el contract check. NO bloquean el guardado aunque el
      // campo esté vacío en alta: Signal Forms salta la validación de un nodo
      // readonly (`shouldSkipValidation = hidden || disabled || readonly`,
      // _validation_errors-chunk.mjs:778). En update el campo sí se valida.
      required: true,
      validators: { unique: true },
      // En alta no existe todavía (lo llena el transform `token`): no tiene
      // sentido mostrarlo vacío con un help que explica que se genera solo.
      // En edición sí aparece, pero como `immutableKey: true` lo rechaza en el
      // back, el campo es de solo-lectura en TODOS los modos.
      hiddenOn: 'create',
      readonlyOn: 'always',
      help: 'Se genera solo al guardar: 6 caracteres sin confundir 0 con O ni 1 con I.',
      section: 'pedido',
      width: 6,
    },
    {
      type: 'text',
      key: 'pin',
      label: 'PIN de Autorización',
      // Lo genera el transform `pin` al crear y queda en claro SÓLO en la fila
      // del pedido, para copiarlo en el mensaje del cliente. Nunca se edita:
      // cambiarlo a mano dejaría la fila sin correspondencia en `_pin`, que es
      // lo que compara `pin-verify` (aunque no abre el retiro, el pin mostrado
      // dejaría de verificar).
      // Igual que `ref`: en alta no existe (lo llena el transform `pin`), así
      // que se oculta. En edición SÍ aparece — es donde al operador le sirve
      // ver el PIN de ese pedido para dictarlo por teléfono.
      hiddenOn: 'create',
      readonlyOn: 'always',
      validators: { maxLength: 12 },
      help: 'Se genera solo al guardar (6 dígitos) y no se puede modificar.',
      section: 'pedido',
      width: 6,
    },
    {
      type: 'text',
      key: 'customer_name',
      label: 'Nombre del Cliente',
      required: true,
      placeholder: 'Ej. Ana Pérez',
      validators: { maxLength: 80 },
      section: 'pedido',
      width: 6,
    },
    {
      type: 'textarea',
      key: 'description',
      label: 'Descripción del Pedido',
      required: true,
      help: 'Qué es el pedido: mínimo 3 palabras, máximo 120.',
      validators: { minWords: 3, maxWords: 120 },
      section: 'pedido',
      width: 12,
    },
    {
      type: 'date',
      key: 'pickup_date',
      label: 'Fecha Acordada de Retiro',
      required: true,
      help: 'Cuándo viene el cliente a retirarlo.',
      section: 'pedido',
      width: 6,
    },
    {
      type: 'select',
      key: 'status',
      label: 'Estado',
      required: true,
      default: 'PENDIENTE',
      options: [
        { label: 'Pendiente', value: 'PENDIENTE' },
        { label: 'Entregado', value: 'ENTREGADO' },
        { label: 'Cancelado', value: 'CANCELADO' },
      ],
      section: 'pedido',
      width: 6,
    },
    {
      type: 'image',
      key: 'reference_photo',
      label: 'Foto de Referencia del Pedido',
      section: 'pedido',
      width: 6,
    },
    {
      type: 'textarea',
      key: 'customer_notes',
      label: 'Notas Internas / Instrucciones',
      placeholder: 'Ej. Entregar por el portón trasero, llamar antes',
      validators: { maxLength: 500 },
      section: 'pedido',
      width: 12,
    },
    {
      type: 'text',
      key: 'authorized_name',
      label: 'Nombre de la Persona Autorizada',
      help: 'Quién viene a retirar. Déjelo vacío si retira el propio cliente.',
      validators: { maxLength: 80 },
      section: 'autorizado',
      width: 6,
    },
    {
      type: 'image',
      key: 'authorized_photo',
      label: 'Foto del Autorizado',
      section: 'autorizado',
      width: 6,
    },
    {
      type: 'textarea',
      key: 'authorized_notes',
      label: 'Notas sobre la Autorización',
      validators: { maxLength: 300 },
      section: 'autorizado',
      width: 12,
    },
    {
      type: 'select',
      key: 'auth_state',
      label: 'Estado de Autorización',
      help: 'Activa habilita el retiro por tercero con el código del pedido.',
      default: 'NINGUNO',
      options: [
        { label: 'Ninguno', value: 'NINGUNO' },
        { label: 'Activa', value: 'ACTIVA' },
        { label: 'Revocada', value: 'REVOCADA' },
      ],
      section: 'autorizado',
      width: 6,
    },
    {
      type: 'readonly-text',
      key: 'created_at',
      label: 'Fecha de creación',
      section: 'sistema',
      width: 6,
    },
    {
      type: 'readonly-text',
      key: 'updated_at',
      label: 'Última actualización',
      section: 'sistema',
      width: 6,
    },
    {
      type: 'list',
      key: 'history',
      label: 'Historial',
      min: 0,
      max: 200,
      section: 'historial',
      itemFields: [
        {
          type: 'readonly-text',
          key: 'at',
          label: 'Fecha/Hora',
        },
        {
          type: 'select',
          key: 'action',
          label: 'Acción',
          options: [
            { label: 'Pedido Creado', value: 'PEDIDO_CREADO' },
            { label: 'Autorizado', value: 'AUTORIZADO' },
            { label: 'Autorización Cambiada', value: 'AUTORIZADO_CAMBIADO' },
            { label: 'Revocado', value: 'REVOCADO' },
            { label: 'Entregado', value: 'ENTREGADO' },
          ],
        },
        {
          type: 'text',
          key: 'detail',
          label: 'Detalle',
          validators: { maxLength: 120 },
        },
      ],
    },
  ],
};
