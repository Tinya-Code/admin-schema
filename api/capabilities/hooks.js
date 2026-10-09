// capabilities/hooks — Reacciones post-escritura (refactormotor.md §B9).
//
// Categoría `hooks` de REGISTRY.capabilities: se registran por la puerta
// única (R3.14) y la proyección legacy llena REGISTRY.hooks, que es lo que
// sigue leyendo engine/24-crud (emitHook_). El único hook hoy es `pinHash`.

registerCapability('hooks', {
  id: 'pinHash',
  since: '1.0',
  argsSchema: null,
  // Fase 5 — hook `pinHash`: el lado generador, par de `handlePinVerify`.
  //
  // Hasta ahora nadie escribía en `_pin`, así que la verificación respondía
  // siempre 404 "el pedido no requiere PIN": sistema huérfano. Acá se cierra
  // el circuito — el PIN en claro ya quedó en la fila del pedido (transform
  // `pin` declarado en `operations.create.computed`) y acá se registra su
  // SHA-256, que es lo único que consulta `pin-verify`. Texto plano NUNCA en
  // `_pin`, salvo la marca `__failed__` de los intentos.
  //
  // Post-escritura y aislado por diseño: si falla, la escritura del pedido ya
  // se hizo y `emitHook_` sólo lo deja en consola. El pedido queda sin
  // verificación y `pin-verify` responde 404, que es exactamente el
  // comportamiento seguro ante la ausencia de PIN.
  run: function (ctx) {
    var key = ctx && ctx.key !== undefined ? String(ctx.key) : '';
    var pin = ctx && ctx.payload ? ctx.payload.pin : undefined;
    if (pin === undefined || pin === null || String(pin) === '') {
      // El computed no corrió (sin origen no se deriva): mejor un error en
      // consola que un 404 mudo en producción.
      throw new Error('orders/' + key + ': sin PIN generado, el computed no corrió');
    }
    var sheet = ctx.ss.getSheetByName('_pin');
    if (sheet === null) {
      throw new Error('_pin no existe: correr setupDrift desde el editor de Apps Script');
    }
    // [ref, pin_hash, created_at, used_at] — `used_at` vacío marca el PIN
    // activo: pin-verify toma el más reciente NO usado.
    sheet.appendRow([key, Props.hashText(String(pin)), nowStamp_(), '']);
  },
});
