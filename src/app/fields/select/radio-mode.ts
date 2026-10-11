import type { SelectField } from '../../core/models/schema.model';

/**
 * Guía de control (standards §Control selection): 2–4 opciones → radio
 * buttons; 5–7 → dropdown simple; más de 7 → dropdown con búsqueda.
 *
 * Dos limitaciones deliberadas:
 *  - **Sólo opciones estáticas** (`source` excluido): una fuente se carga
 *    después y su cantidad de filas puede cambiar; el control no debe mutar
 *    de `<select>` a radios en mitad de una edición.
 *  - **Mínimo 2**: con una sola opción el dropdown (o un único radio) no
 *    aporta nada y el caso real (`users.role`) ya existe así.
 *
 * La comparten el campo (`select.ts`, para ramificar su plantilla) y el
 * rótulo del host (`render-host.ts`): sin este mismo cálculo el host
 * dibujaría un `label[for]` apuntando a un id que un grupo de radios no
 * tiene (el ancla la reemplaza `role="radiogroup"` + `aria-label`).
 */
export function esGrupoRadio(field: SelectField): boolean {
  if (field.source !== undefined) {
    return false;
  }
  const total = field.options?.length ?? 0;
  return total >= 2 && total <= 4;
}
