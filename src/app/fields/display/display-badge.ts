import { Component, computed, input } from '@angular/core';

import { Badge, type BadgeKind } from '../../shared/components/badge/badge';
import type { FieldSchema, SelectField } from '../../core/models/schema.model';

/**
 * Display por defecto de `boolean` y `select` (R4.1 · modo `display`).
 *
 * Absorbe `formatValue` + `resolveBadgeKind` de `detail-view` (R4.2): los
 * estados siguen clasificándose con el mismo vocabulario —
 * `PENDIENTE/WAITING/EN_PROCESO/PROCESSING` en `warning`,
 * `ENTREGADO/DELIVERED/…` en `success`, `CANCELADO/REVOCADA/ERROR/…` en
 * `danger` y el resto en `neutral` — porque es el criterio que el operador
 * ya reconoce en la cabecera de la ficha.
 *
 * `boolean` pinta `Sí`/`No` con `success`/`neutral` (la paridad de R4.2);
 * los `trueLabel`/`falseLabel` del schema siguen siendo cosa del control de
 * **edición**, y de la columna de lista (R4.3), que sí los usa.
 */
@Component({
  selector: 'app-field-display-badge',
  imports: [Badge],
  template: `<app-badge [label]="label()" [kind]="kind()" />`,
})
export class FieldDisplayBadge {
  readonly field = input.required<FieldSchema>();
  readonly value = input<unknown>(null);
  /** El chip de la cabecera ya es este componente: se ignora. */
  readonly chip = input(false);

  protected readonly label = computed(() => {
    if (this.field().type === 'boolean') {
      return this.value() ? 'Sí' : 'No';
    }
    const opciones = (this.field() as SelectField).options ?? [];
    const encontrada = opciones.find((o) => o.value === String(this.value()));
    return encontrada ? encontrada.label : String(this.value());
  });

  protected readonly kind = computed<BadgeKind>(() => {
    if (this.field().type === 'boolean') {
      return this.value() ? 'success' : 'neutral';
    }
    return resolveBadgeKind(String(this.value()));
  });
}

/**
 * Clasificación de estados, común al display de detalle (acá) y al
 * timeline del historial (`display-list`). Exportada para que R4.3 pueda
 * reusarla si la columna de lista decide alinearse con este criterio.
 */
export function resolveBadgeKind(valor: string): BadgeKind {
  const upper = String(valor).toUpperCase();
  if (['PENDIENTE', 'WAITING', 'EN_PROCESO', 'PROCESSING'].includes(upper)) return 'warning';
  if (
    ['ENTREGADO', 'DELIVERED', 'ACTIVA', 'ACTIVE', 'COMPLETADO', 'SUCCESS', 'SI', 'SÍ'].includes(
      upper,
    )
  )
    return 'success';
  if (['CANCELADO', 'CANCELLED', 'REVOCADA', 'REVOKED', 'ERROR', 'NO'].includes(upper))
    return 'danger';
  return 'neutral';
}
