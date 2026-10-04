/**
 * Utilidades de foco para los diálogos (`modal` y `drawer`).
 *
 * Los dos componentes comparten el mismo contrato: atrapan el Tab dentro del
 * panel para que el foco no se pierda detrás del fondo oscuro. Tener el
 * selector y el test de visibilidad en un solo sitio evita que los dos
 * diálogos diverjan.
 */

/** Candidatos a foco dentro del diálogo (el orden del foco del navegador). */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * ¿Se puede enfocar este elemento ahora mismo?
 *
 * No se usa `offsetParent`: en jsdom es siempre `null` y el atrapado del Tab
 * quedaría sin opérculo en los tests. `checkVisibility` da la respuesta
 * exacta en navegador; si no existe (jsdom), se confía en lo que hay en el
 * DOM y sólo se descarta lo marcado `hidden`.
 */
export function isVisibleNow(element: HTMLElement): boolean {
  if (element.hasAttribute('hidden') || element.closest('[hidden]') !== null) {
    return false;
  }
  const check = (element as { checkVisibility?: (options?: unknown) => boolean }).checkVisibility;
  return typeof check !== 'function' || check.call(element);
}
