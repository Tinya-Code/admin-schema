// primitives/handlers/dashboard — Métricas del panel declarativo (Fase 3 §3.3).
//
// Resuelto desde `REGISTRY.endpoints.dashboard` (schema/endpoints/dashboard).
// Lee los recursos configurados en `endpointDecl.resource` (string o array de strings),
// ejecuta todas las vistas declaradas en `resource.views` vía `applyDeclaredView_`
// y devuelve un mapa con los resultados indexados por el nombre de cada vista.
//
// Para vistas con `aggregate: 'count'|'sum'|'avg'`, extrae el valor escalar (o 0 si null).
// Para vistas estándar o handlers custom, preserva la estructura devuelta.
//
// Contrato de respuesta:
//   { [viewName]: number | object | array, ... }
//
// No recibe payload. Devuelve datos; el envelope lo envuelve core/12-http.

function handleDashboard() {
  var endpointDecl = REGISTRY.endpoints.dashboard || {};
  var resourceIds = [];
  if (typeof endpointDecl.resource === 'string' && endpointDecl.resource) {
    resourceIds.push(endpointDecl.resource);
  } else if (Array.isArray(endpointDecl.resource)) {
    resourceIds = endpointDecl.resource;
  } else {
    // Si no se restringe a un recurso específico, descubre automáticamente
    // todos los recursos del registro que tengan vistas declaradas (agnóstico al dominio).
    var allKeys = Object.keys(REGISTRY.resources || {});
    for (var k = 0; k < allKeys.length; k++) {
      var r = REGISTRY.resources[allKeys[k]];
      if (r && r.views && Object.keys(r.views).length > 0) {
        resourceIds.push(allKeys[k]);
      }
    }
  }
  if (resourceIds.length === 0) return {};

  var ss = null;
  var result = {};

  resourceIds.forEach(function (resourceId) {
    var resource = getResourceSchema(resourceId);
    if (!resource) return;
    if (ss === null) ss = openSpreadsheet_();
    var map = storageMap_(resource);
    var items = listCollection_(ss, resource, map);
    var views = resource.views || {};
    Object.keys(views).forEach(function (name) {
      var view = views[name];
      if (!view) return;
      var rows = applyDeclaredView_(resource, name, items, {});
      if (view.aggregate) {
        result[name] = rows.length > 0 && rows[0].value !== null ? Number(rows[0].value) : 0;
      } else {
        result[name] = rows;
      }
    });
  });

  return result;
}

REGISTRY.handlers.handleDashboard = handleDashboard;
