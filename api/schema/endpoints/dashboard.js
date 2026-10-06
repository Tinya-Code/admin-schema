// schema/endpoints/dashboard — Endpoint de métricas del panel (Fase 3).
//
// Declarado, no cableado: el router lo resuelve desde REGISTRY.endpoints.
// El handler lee las vistas declaradas en `orders.views` vía
// `applyDeclaredView_` (engine/27-views) y devuelve los contadores.
// Sólo GET, sólo admin: el dashboard es sólo-lectura.

REGISTRY.endpoints.dashboard = {
  route: '/admin/dashboard',
  method: 'GET',
  access: 'admin',
  limits: '30/min',
  handler: 'handleDashboard',
  // El id del recurso que alimenta las métricas. El handler lo lee para
  // evitar hardcodear el nombre en primitives/ (§11.1: sin nombres concretos).
  resource: 'orders',
};
