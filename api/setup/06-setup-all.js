// setup/06-setup-all — Un solo punto de entrada para montar el entorno.
//
// Antes había SEIS funciones sueltas en `doc/guia.md` que había que correr a
// mano en este orden: 00 → 01 → 02 → 04 → 03 → 05. Cualquiera que olvidara
// una se encontraba un error sin relación aparente con lo que faltaba (`No
// existe la hoja _users` viniendo de `bootstrapAdmin_`, `Falta la
// configuración de auth` viniendo de `setupAuth_`). D24: un solo `setupAll()`
// que las encadena en orden y devuelve QUÉ PASÓ en cada paso.
//
//   setupAll()                        → todo, incluido setupSeed()
//   setupAll({ seed: false })         → salta los datos de configuración iniciales
//   setupAll({ email, password })     → credenciales del admin en claro para
//                                       este arranque (si no: props → dueño)
//
// Editor-only por hechos, no por suerte: no hay ninguna ruta que lo declare,
// y además está en `EDITOR_ONLY_FNS` (core/10-router) — el guard existe
// porque `dispatchRoute_` resuelve handlers por nombre y `setupAll` crea un
// administrador.
//
// Idempotente: todos los pasos lo son, así que se puede volver a correr sin
// miedo a duplicar nada (`setupTriggers_` además reconcilia y BORRA los
// triggers de schedules que ya no se declaran).
//
// Política de fallo: si un paso LANZA, se detiene ahí y devuelve
// `detenidoEn` + los pasos ya corridos. Que `checkProperties` reporte
// `ok: false` NO detiene nada: significa «faltan valores de propiedades», no
// «falló el paso», y el resto del setup no depende de ellos (sólo
// `bootstrapAdmin_`, que en ese caso cae al dueño + contraseña generada).

/**
 * @param {{seed?: boolean, email?: string, password?: string}} [opts]
 *   `seed: false` salta setupSeed(). `email`/`password` se los pasa a
 *   `bootstrapAdmin_`: si no van acá, éste toma `ADMIN_EMAIL`/`ADMIN_PASSWORD`
 *   de las props y, si siguen vacías, al dueño con contraseña generada.
 * @return {{ok: boolean, detenidoEn: string|null, pendientesDeValor: string[], pasos: Array<{paso: string, ok: boolean, detalle: string}>}}
 */
function setupAll(opts) {
  var conSeed = !(opts && opts.seed === false);
  var pasos = [];
  var pendientesDeValor = [];
  var detenidoEn = null;

  var correr = function (paso, fn) {
    if (detenidoEn !== null) return null;
    try {
      var r = fn();
      pasos.push({ paso: paso, ok: true, detalle: detalleSeguro_(paso, r) });
      return r;
    } catch (e) {
      detenidoEn = paso;
      pasos.push({ paso: paso, ok: false, detalle: String((e && e.message) || e) });
      return null;
    }
  };

  // 0) Propiedades. Sus `ok:false` son informativos: recogemos los que siguen
  //    sin valor y seguimos, porque nada más los necesita.
  correr('checkProperties', function () {
    var props = checkProperties();
    if (props && props.pendientes) pendientesDeValor = props.pendientes;
    return props;
  });

  correr('setupSpreadsheet', setupSpreadsheet);
  correr('setupSheets', setupSheets);
  if (conSeed) correr('setupSeed', setupSeed);
  correr('setupDrift', function () {
    return setupDrift(); // dryRun por defecto false ⇒ aplica
  });
  correr('setupAuth_', setupAuth_);

  // R9.5.6 · jobs programados: instala los triggers declarados en
  // `resource.schedules`. SÓLO el editor puede crear triggers (O3), por
  // eso vive acá y no en el runtime.
  correr('setupTriggers_', setupTriggers_);

  // 409 no es un fallo: significa que el admin ya estaba dado de alta.
  correr('bootstrapAdmin_', function () {
    try {
      return bootstrapAdmin_(opts && opts.email, opts && opts.password);
    } catch (e) {
      if (e && e.apiStatus === 409) return { ok: true, detalle: String(e.message) };
      throw e;
    }
  });

  var report = {
    ok: detenidoEn === null,
    detenidoEn: detenidoEn,
    pendientesDeValor: pendientesDeValor,
    pasos: pasos,
  };
  Logger.log('✓ setupAll: ' + JSON.stringify(report, null, 2));
  if (detenidoEn !== null) Logger.log('✗ setupAll se detuvo en: ' + detenidoEn);
  if (pendientesDeValor.length > 0) {
    Logger.log('… cambia el valor de: ' + pendientesDeValor.join(', '));
  }
  return report;
}

// Resumen corto por paso — el detalle crudo ya lo imprime cada función.
//
// Nunca puede tumbar el paso: informar es distinto de ejecutar. Un retorno
// inesperado (o un paso stubbeado en un test) debe costar un detalle vacío,
// no convertir un setup exitoso en uno fallido.
function detalleSeguro_(paso, r) {
  try {
    return detallePaso_(paso, r);
  } catch (e) {
    return '';
  }
}

function detallePaso_(paso, r) {
  if (r && typeof r === 'object' && typeof r.detalle === 'string') return r.detalle;
  if (!r || typeof r !== 'object') return '';

  switch (paso) {
    case 'checkProperties': {
      var parts = [];
      if (r.creadas && r.creadas.length) parts.push('creadas vacías: ' + r.creadas.join(', '));
      if (r.pendientes && r.pendientes.length)
        parts.push('pendientes de valor: ' + r.pendientes.join(', '));
      if (r.invalid && r.invalid.length) parts.push('inválidas: ' + r.invalid.join(', '));
      if (r.pending && r.pending.length) parts.push('generated pendientes: ' + r.pending.length);
      return parts.join(' · ') || 'completas';
    }
    case 'setupSpreadsheet':
      return (r.reused ? 'libro existente: ' : 'libro nuevo: ') + r.url;
    case 'setupSheets':
      return r.created && r.created.length ? 'nuevas: ' + r.created.join(', ') : 'ya estaban';
    case 'setupSeed':
      return (
        'enums ' +
        (r.enumsUpdated || []).length +
        ' · placeholders ' +
        (r.placeholdersUpdated || []).length +
        ' · kv ' +
        r.kvRowsAdded
      );
    case 'setupDrift':
      return (
        r.createdSheets.length +
        ' hojas · ' +
        r.added.length +
        ' columnas · ' +
        r.orphans.length +
        ' huérfanas · schema ' +
        r.schemaVersion
      );
    case 'setupAuth_':
      return r.creado && r.creado.length ? 'generadas: ' + r.creado.join(', ') : 'ya existían';
    case 'setupTriggers_': {
      var creados = r.creados || [];
      var existentes = r.existentes || [];
      var borrados = r.borrados || [];
      return (
        creados.length +
        ' creados · ' +
        existentes.length +
        ' ya estaban' +
        (borrados.length ? ' · ' + borrados.length + ' borrados' : '')
      );
    }
    case 'bootstrapAdmin_':
      if (r.actualizada === true) return 'admin ' + r.email + ' (contraseña ACTUALIZADA — D25)';
      return (
        'admin ' + r.email + (r.passwordGenerada ? ' (contraseña generada)' : ' (ADMIN_PASSWORD)')
      );
    default:
      return '';
  }
}
