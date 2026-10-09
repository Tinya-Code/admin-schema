import { Component, computed, input } from '@angular/core';

import { getValue } from '../shared/utils/field-path';
import type { ColumnCell } from './column-cell';

/**
 * Formato `text` (R4.3 · el `@default` del `@switch` viejo).
 *
 * `cellText` de `list-view`: `null`/`undefined` se pintan vacíos y el resto
 * pasa por `String()` — un objeto sale `[object Object]`, igual que antes.
 */
@Component({
  selector: 'app-column-format-text',
  template: `{{ texto() }}`,
})
export class ColumnFormatText {
  readonly cell = input.required<ColumnCell>();

  protected readonly texto = computed(() => {
    const value = getValue(this.cell().row, this.cell().column.key);
    return value == null ? '' : String(value);
  });
}
