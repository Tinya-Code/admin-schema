// schema/endpoints/public-order — Proyección pública de solo lectura de un pedido (Fase 4).
//
// Declarado, no cableado: el router resuelve la ruta /p/orders/:ref desde REGISTRY.endpoints.
// Acceso 'public' sin token de admin y rate-limit declarativo (60/min).

REGISTRY.endpoints.publicOrder = {
  route: '/p/orders/:ref',
  method: 'GET',
  access: 'public',
  limits: '60/min',
  handler: 'handlePublicOrder',
  resource: 'orders',
};
