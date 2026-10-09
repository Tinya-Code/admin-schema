// primitives/handlers/public-order — Proyección pública de pedido (Fase 4 §4).
//
// Resuelto desde `REGISTRY.endpoints.publicOrder` (/p/orders/:ref).
// Aplica whitelist estricta: sólo expone campos que el cliente y el autorizado
// necesitan ver para verificar la recogida.
//
// Oculta explícitamente `customer_notes` y `authorized_notes` (notas internas).
//
// Precedente: `handleSchema` (schema.js) y `hiddenList` (hidden-list.js).

var PUBLIC_ORDER_FIELDS_ = [
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
  'history',
];

function handlePublicOrder(payload, request) {
  var ref =
    request && request.params && request.params.ref
      ? String(request.params.ref).trim()
      : payload && payload.ref
        ? String(payload.ref).trim()
        : '';
  if (!ref) {
    throw apiError_(400, 'Falta la referencia del pedido en la ruta');
  }

  var endpointDecl = REGISTRY.endpoints.publicOrder || {};
  var resourceId = typeof endpointDecl.resource === 'string' ? endpointDecl.resource : '';
  if (!resourceId) throw apiError_(500, 'Recurso no configurado en el endpoint');

  var resource = getResourceSchema(resourceId);
  if (!resource) throw apiError_(500, 'Recurso ausente: ' + resourceId);

  var ss = openSpreadsheet_();
  var map = storageMap_(resource);
  var detail = readDetail_(ss, resource, map, ref);

  var projected = {};
  PUBLIC_ORDER_FIELDS_.forEach(function (field) {
    if (detail[field] !== undefined) {
      projected[field] = detail[field];
    }
  });

  return projected;
}

REGISTRY.handlers.handlePublicOrder = handlePublicOrder;
