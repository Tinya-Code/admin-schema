import { Component, computed, input } from '@angular/core';

import { Badge } from '../../shared/components/badge/badge';
import type { FieldSchema } from '../../core/models/schema.model';

const FORMATO_NUMERO = new Intl.NumberFormat('es-PE');

/**
 * Display por defecto de `number` y `currency` (R4.1 · modo `display`).
 *
 * Los dos tipos compartían rama en `formatValue` y la comparten acá: miles
 * con separador `es-PE` y sin decimales fijos (el schema controla los
 * decimales con `decimals` en el form; en display manda el valor tal cual
 * viene). Si no es número, se pinta el texto crudo — la degradación que ya
 * hacía `detail-view`.
 */
@Component({
  selector: 'app-field-display-number',
  imports: [Badge],
  template: `
    @if (chip()) {
      <app-badge [label]="texto()" />
    } @else {
      {{ texto() }}
    }
  `,
})
export class FieldDisplayNumber {
  readonly field = input.required<FieldSchema>();
  readonly value = input<unknown>(null);
  /** `true` en la cabecera: el número se pinta como chip compacto. */
  readonly chip = input(false);

  protected readonly texto = computed(() => {
    const n = Number(this.value());
    if (!Number.isFinite(n)) {
      return String(this.value());
    }
    return FORMATO_NUMERO.format(n);
  });
}
