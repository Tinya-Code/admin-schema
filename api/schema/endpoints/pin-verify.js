// schema/endpoints/pin-verify — Verificación pública de PIN de autorización (Fase 5).
//
// POST /p/orders/:ref/pin → handlePinVerify
// Acceso 'public' (no requiere token admin).
// Rate-limit declarativo: 5 intentos por minuto para limitar fuerza bruta.
// El PIN nunca viaja en claro en la respuesta — sólo se verifica contra _pin.

REGISTRY.endpoints.pinVerify = {
  route: '/p/orders/:ref/pin',
  method: 'POST',
  access: 'public',
  limits: '5/min',
  handler: 'handlePinVerify',
  resource: 'orders',
};
