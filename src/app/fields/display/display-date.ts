import { Component, computed, input } from '@angular/core';

import { Badge } from '../../shared/components/badge/badge';
import type { FieldSchema } from '../../core/models/schema.model';

const FORMATO_FECHA = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeZone: 'UTC' });

/**
 * Display por defecto de `date` (R4.1 · modo `display`).
 *
 * Misma fórmula que `formatValue` de `detail-view` antes de R4.2: `es-PE`,
 * `dateStyle: 'medium'`, **UTC** para que la fecha no se corra un día según
 * el huso de quien abra la ficha, y texto crudo si no es parseable.
 */
@Component({
  selector: 'app-field-display-date',
  imports: [Badge],
  template: `
    @if (chip()) {
      <app-badge [label]="texto()" />
    } @else {
      {{ texto() }}
    }
  `,
})
export class FieldDisplayDate {
  readonly field = input.required<FieldSchema>();
  readonly value = input<unknown>(null);
  /** `true` en la cabecera: la fecha se pinta como chip compacto. */
  readonly chip = input(false);

  protected readonly texto = computed(() => {
    const d = new Date(String(this.value()));
    if (Number.isNaN(d.getTime())) {
      return String(this.value());
    }
    return FORMATO_FECHA.format(d);
  });
}
