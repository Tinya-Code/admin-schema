// api/engine/29-transitions.js — Máquinas de estado simples (B3 · R5.5).
//
// Declaración, en el recurso:
//
//   transitions: {
//     status: {
//       PENDIENTE: ['ENTREGADO', 'CANCELADO'],
//       ENTREGADO: ['ENTREGADO'],
//       CANCELADO: ['PENDIENTE'],
//     },
//   }
//
// La clave de cada mapa es el VALOR ACTUAL y el array son los valores a los
// que se PUEDE pasar. El motor sólo juzga CAMBIOS: un update que no toca el
// campo pasa por alto, y un cambio al mismo valor tampoco es un cambio.
//
// **Fail-closed, como todo acá:** un valor actual SIN entrada en el mapa no
// puede cambiar a nada (una fila vieja con un estado que nadie declaró no
// obtiene permiso por accidente); sólo se declaran las transiciones que se
// permiten. Y si el campo tiene `enum`, todo valor referenciado tiene que
// estar en ese enum — lo juzga el arranque (`validate-registry.js`), no
// acá.
//
// **409, no 422:** el estado guardado no es el que el front suponía. No es
// un error de formulario (que se pinta campo a campo en el 422), es el
// mundo cambiando por debajo de la vista — el mismo criterio que `from` de
// las acciones (R5.4).
//
// **Create queda fuera:** no hay «desde dónde» cuando no existe la fila. El
// valor inicial lo decide el schema (`default`).
function assertTransitions_(resource, current, incoming) {
  var machines = resource.transitions;
  if (machines === undefined || machines === null) return;
  if (!current || typeof current !== 'object') return; // create
  if (!incoming || typeof incoming !== 'object') return;

  Object.keys(machines).forEach(function (field) {
    if (!Object.prototype.hasOwnProperty.call(incoming, field)) return; // no lo toca
    var rules = machines[field];
    var from = current[field];
    var to = incoming[field];
    if (String(from) === String(to)) return; // no es un cambio
    var allowed = rules !== null && typeof rules === 'object' ? rules[from] : undefined;
    if (!Array.isArray(allowed) || allowed.indexOf(to) === -1) {
      throw apiError_(
        409,
        "Cambio de '" + field + "' no permitido: " + String(from) + ' → ' + String(to),
      );
    }
  });
}
