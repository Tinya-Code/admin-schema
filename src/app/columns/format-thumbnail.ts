import { Component, computed, input } from '@angular/core';

import { getValue } from '../shared/utils/field-path';
import type { ColumnCell } from './column-cell';

/**
 * Formato `thumbnail` (R4.3): miniatura de la fila.
 *
 * Tanto `thumbnailSrc` como `thumbnailAlt` se mudan desde `list-view`: la
 * columna puede apuntar a `image_url`, al primer elemento de `images[]` o a
 * un objeto con `image_url`, y el texto alternativo sale del item o de la
 * fila. Sin URL se pinta el `—` de siempre.
 */
@Component({
  selector: 'app-column-format-thumbnail',
  template: `
    @if (src(); as url) {
      <img [src]="url" [alt]="alt()" class="size-9 rounded-md object-cover" loading="lazy" />
    } @else {
      <span class="text-neutral" aria-hidden="true">—</span>
    }
  `,
})
export class ColumnFormatThumbnail {
  readonly cell = input.required<ColumnCell>();

  protected readonly src = computed(() => {
    const value = this.valor();
    if (typeof value === 'string') {
      return value !== '' ? value : null;
    }
    if (Array.isArray(value)) {
      const first = value[0];
      const url = typeof first === 'string' ? first : getValue(first, 'image_url');
      return typeof url === 'string' && url !== '' ? url : null;
    }
    if (value && typeof value === 'object') {
      const url = getValue(value, 'image_url');
      return typeof url === 'string' && url !== '' ? url : null;
    }
    return null;
  });

  protected readonly alt = computed(() => {
    const value = this.valor();
    let item: unknown = this.cell().row;
    if (Array.isArray(value)) {
      item = value[0] ?? null;
    } else if (value && typeof value === 'object') {
      item = value;
    }
    const alt = item == null ? null : getValue(item, 'image_alt');
    if (typeof alt === 'string' && alt !== '') {
      return alt;
    }
    const rootAlt = this.cell().row['image_alt'];
    return typeof rootAlt === 'string' ? rootAlt : '';
  });

  private valor(): unknown {
    return getValue(this.cell().row, this.cell().column.key);
  }
}
