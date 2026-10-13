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
  issuesGrant: 'pickupGrant',
  output: {
    ok: { type: 'boolean', required: true },
    ref: { type: 'text', required: true },
    grant: { type: 'text', required: true },
    expires_at: { type: 'text', required: true },
  },
  // Códigos de aplicación devueltos dentro del envelope JSON de Apps Script.
  errors: [
    { status: 400, code: 'PIN_INPUT_REQUIRED', description: 'Falta la referencia o el PIN.' },
    { status: 401, code: 'PIN_INVALID', description: 'El PIN recibido no coincide.' },
    { status: 403, code: 'ORDER_NOT_ELIGIBLE', description: 'El pedido ya no admite retiro.' },
    {
      status: 404,
      code: 'PIN_NOT_AVAILABLE',
      description: 'No hay PIN disponible para el pedido.',
    },
    { status: 409, code: 'PIN_ALREADY_USED', description: 'El PIN ya fue utilizado.' },
    {
      status: 410,
      code: 'PIN_EXPIRED',
      description:
        'El PIN superó pin_ttl_hours (24 h por defecto) o su fecha de creación no se puede interpretar.',
    },
    {
      status: 422,
      code: 'VALIDATION_REQUIRED',
      description: 'Falta el PIN requerido en el payload.',
    },
    {
      status: 429,
      code: 'RATE_LIMITED',
      description: 'Se agotaron los intentos por pedido o el límite de 5/min.',
    },
    {
      status: 500,
      code: 'PIN_CONFIGURATION_ERROR',
      description: 'Error interno de configuración.',
    },
    {
      status: 503,
      code: 'PIN_STORE_UNAVAILABLE',
      description: 'La hoja auxiliar _pin no está configurada.',
    },
  ],
  since: '1.0',
};

REGISTRY.grantProfiles.pickupGrant = {
  purpose: 'register-pickup-person',
  issuedBy: 'pinVerify',
  resource: 'orders',
  command: 'register-pickup-person',
  keyParam: 'ref',
  ttlSeconds: 900,
  maxUses: 1,
  consume: 'on-success',
};
