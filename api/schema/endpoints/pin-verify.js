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
  // Contrato de transporte: el ref viene de la ruta y el PIN se acepta sólo
  // como campo secreto. El handler juzga su contenido contra el hash.
  input: {
    params: { ref: { type: 'text', required: true } },
    pin: { type: 'secret', required: true },
  },
  output: { ok: { type: 'boolean', required: true }, ref: { type: 'text', required: true } },
  // Códigos de aplicación devueltos dentro del envelope JSON de Apps Script.
  errors: [
    { status: 401, description: 'El PIN recibido no coincide con el hash guardado.' },
    { status: 403, description: 'El pedido no está PENDIENTE y ya no admite retiro.' },
    {
      status: 404,
      description: 'No hay PIN para el pedido, el PIN está deshabilitado o el pedido no existe.',
    },
    { status: 409, description: 'El PIN ya fue utilizado.' },
    {
      status: 410,
      description:
        'El PIN superó pin_ttl_hours (24 h por defecto) o su fecha de creación no se puede interpretar.',
    },
    { status: 422, description: 'Falta el PIN requerido en el payload.' },
    { status: 429, description: 'Se agotaron los intentos por pedido o el límite de 5/min.' },
    { status: 500, description: 'Error de configuración o estructura interna de las hojas.' },
    { status: 503, description: 'La hoja auxiliar _pin no está configurada.' },
  ],
  since: '1.0',
};
