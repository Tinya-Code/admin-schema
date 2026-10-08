// schema/endpoints/pin-verify — Verificación pública de PIN de autorización (Fase 5).
//
// POST /p/pin/:ref → handlePinVerify
// Acceso 'public' (no requiere token admin).
// Rate-limit declarativo: 5 intentos por minuto para limitar fuerza bruta.
// El PIN nunca viaja en claro en la respuesta — sólo se verifica contra _pin.
//
// NOTA: La ruta es /p/pin/:ref (no /p/orders/:ref/pin) porque el router de GAS
// solo soporta un nivel de parámetro al final de la ruta.

REGISTRY.endpoints.pinVerify = {
  route: '/p/pin/:ref',
  method: 'POST',
  access: 'public',
  limits: '5/min',
  handler: 'handlePinVerify',
  resource: 'orders',
};
