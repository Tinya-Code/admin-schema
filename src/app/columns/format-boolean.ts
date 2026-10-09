import { Component, computed, input } from '@angular/core';

import { Badge } from '../shared/components/badge/badge';
import { getValue } from '../shared/utils/field-path';
import type { ColumnCell } from './column-cell';
import { badgeInfo } from './format-badge';

/**
 * Formato `boolean` (R4.3): interruptor o badge.
 *
 * Es la rama `@case ('boolean')` de `list-view`, con una sola diferencia de
 * domicilio: hoy sólo monta este componente si el formato efectivo ya es
 * `boolean`, así que la comprobación `column.format === 'boolean'` que hacía
 * `isSwitchColumn` sobra. El criterio restante — `active` booleano y con
 * permiso de edición (base.md §10) — vive acá, que es quien dibuja el control.
 */
@Component({
  selector: 'app-column-format-boolean',
  imports: [Badge],
  template: `
    @if (esInterruptor()) {
      <input
        type="checkbox"
        class="size-5 cursor-pointer accent-primary"
        [checked]="valor()"
        [disabled]="cell().saving"
        [attr.aria-label]="cell().column.label + ': ' + cell().title"
        (click)="$event.stopPropagation()"
        (change)="alternar($event)"
      />
    } @else {
      <app-badge [label]="badge().label" [kind]="badge().kind" />
    }
  `,
})
export class ColumnFormatBoolean {
  readonly cell = input.required<ColumnCell>();

  protected readonly badge = computed(() => badgeInfo(this.cell()));

  protected readonly valor = computed(() => {
    const value = getValue(this.cell().row, this.cell().column.key);
    return value === true || value === 'true';
  });

  /** `active` declarado como boolean en el schema → interruptor (base.md §10). */
  protected readonly esInterruptor = computed(() => {
    const cell = this.cell();
    if (cell.column.key !== 'active' || !cell.canUpdate) {
      return false;
    }
    return cell.fields.some((field) => field.type === 'boolean' && field.key === 'active');
  });

  protected alternar(event: Event): void {
    this.cell().toggle?.((event.target as HTMLInputElement).checked);
  }
}
