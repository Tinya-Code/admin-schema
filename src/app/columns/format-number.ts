import { Component, computed, input } from '@angular/core';

import { getValue } from '../shared/utils/field-path';
import type { ColumnCell } from './column-cell';

const NUMBER_FORMAT = new Intl.NumberFormat('es-PE');

function formatNumber(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return value == null ? '' : String(value);
  }
  return NUMBER_FORMAT.format(number);
}

/**
 * Formato `number` (R4.3). Misma fórmula que el helper de `list-view`:
 * miles con separador `es-PE` y texto crudo si el valor no es número.
 */
@Component({
  selector: 'app-column-format-number',
  template: `{{ numero() }}`,
})
export class ColumnFormatNumber {
  readonly cell = input.required<ColumnCell>();

  protected readonly numero = computed(() => formatNumber(this.valor()));

  private valor(): unknown {
    return getValue(this.cell().row, this.cell().column.key);
  }
}
