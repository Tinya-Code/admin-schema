// capabilities/handlers/public-order — Proyección pública de pedido (Fase 4 §4).
//
// Resuelto desde `REGISTRY.endpoints.publicOrder` (/p/orders/:ref).
// Aplica whitelist estricta: sólo expone los campos que el recurso declaró
// en su audiencia pública.
//
// F7 · R7.2: la whitelist NO vive acá — la declara el recurso
// (`audiences.public.listProjection`) y éste es su ÚNICO lector. Ocultar un
// campo público es cambiar el schema del recurso, con su validación al
// arranque y sus tests; tocar código del endpoint.
//
// Precedente: `handleSchema` (schema.js) y `hiddenList` (hidden-list.js).

/**
 * Campos que la audiencia pública puede ver, o `null` si el recurso no
 * declara esa audiencia (fail-closed: sin declaración no viaja nada).
 */
function publicAudienceFields_(resource) {
  var audiences = resource.audiences;
  if (!audiences || typeof audiences !== 'object') return null;
  var pub = audiences['public'];
  if (!pub || !Array.isArray(pub.listProjection) || pub.listProjection.length === 0) return null;
  return pub.listProjection;
}

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

  var publicFields = publicAudienceFields_(resource);
  if (publicFields === null) {
    throw apiError_(500, "El recurso '" + resourceId + "' no declara audiences.public");
  }

  var ss = openSpreadsheet_();
  var map = storageMap_(resource);
  var detail = readDetail_(ss, resource, map, ref);

  var projected = {};
  publicFields.forEach(function (field) {
    if (detail[field] !== undefined) {
      projected[field] = detail[field];
    }
  });

  return projected;
}

registerCapability('handlers', {
  id: 'handlePublicOrder',
  since: '1.0',
  argsSchema: null,
  run: handlePublicOrder,
});
