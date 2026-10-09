import { Component, computed, input } from '@angular/core';

import { getValue } from '../shared/utils/field-path';
import type { ColumnCell } from './column-cell';

/**
 * Formato `currency` (R4.3). Igual que el helper de `list-view`: `es-PE`,
 * moneda tomada del schema (se pasaba desde la vista porque sólo ella la
 * conoce) y texto crudo si el valor no es número.
 */
@Component({
  selector: 'app-column-format-currency',
  template: `{{ precio() }}`,
})
export class ColumnFormatCurrency {
  readonly cell = input.required<ColumnCell>();

  protected readonly precio = computed(() => {
    const cell = this.cell();
    const value = getValue(cell.row, cell.column.key);
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return value == null ? '' : String(value);
    }
    return new Intl.NumberFormat('es-PE', {
      style: 'currency',
      currency: cell.currency,
    }).format(number);
  });
}
