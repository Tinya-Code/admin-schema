import { Component, computed, input } from '@angular/core';

import { getValue } from '../shared/utils/field-path';
import type { ColumnCell } from './column-cell';

function formatDate(value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    return value == null ? '' : String(value);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  // Fechas `YYYY-MM-DD`: forzar UTC para no desfasar un día.
  return date.toLocaleDateString('es-PE', { timeZone: 'UTC' });
}

/**
 * Formato `date` (R4.3). Corto (`toLocaleDateString`), a diferencia del
 * display de la ficha, que va con `dateStyle: 'medium'`: cada superficie
 * con su formato, pero ambos desde su propio componente.
 */
@Component({
  selector: 'app-column-format-date',
  template: `{{ fecha() }}`,
})
export class ColumnFormatDate {
  readonly cell = input.required<ColumnCell>();

  protected readonly fecha = computed(() => formatDate(this.valor()));

  private valor(): unknown {
    return getValue(this.cell().row, this.cell().column.key);
  }
}
