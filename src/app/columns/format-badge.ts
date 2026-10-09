import { Component, computed, input } from '@angular/core';

import { Badge, type BadgeKind } from '../shared/components/badge/badge';
import { resolveBadgeKind } from '../fields/display/display-badge';
import type { SelectField } from '../core/models/schema.model';
import { getValue } from '../shared/utils/field-path';
import type { ColumnCell } from './column-cell';

/**
 * Formato `badge` (R4.3, afinado en R4.4).
 *
 * Un booleano usa `trueLabel`/`falseLabel` del campo (o «Sí»/«No») con
 * `success`/`danger` — el vocabulario de la lista para el control que
 * permite escribir. El vacío sigue siendo «Sin dato»/`danger`.
 *
 * El resto alinea el chip con el display del detalle (D41): un `select`
 * pinta la **etiqueta** de la opción y los estados se clasifican con
 * `resolveBadgeKind`, el mismo criterio que la cabecera de la ficha —
 * antes, toda columna declarada `badge` salía verde sin mirar el valor.
 */
@Component({
  selector: 'app-column-format-badge',
  imports: [Badge],
  template: `<app-badge [label]="badge().label" [kind]="badge().kind" />`,
})
export class ColumnFormatBadge {
  readonly cell = input.required<ColumnCell>();

  protected readonly badge = computed(() => badgeInfo(this.cell()));
}

export function badgeInfo(cell: ColumnCell): { label: string; kind: BadgeKind } {
  const value = getValue(cell.row, cell.column.key);
  const field = cell.fields.find((candidate) => candidate.key === cell.column.key);
  if (typeof value === 'boolean') {
    const label =
      value === true
        ? ((field?.type === 'boolean' ? field.trueLabel : undefined) ?? 'Sí')
        : ((field?.type === 'boolean' ? field.falseLabel : undefined) ?? 'No');
    return { label, kind: value ? 'success' : 'danger' };
  }
  const text = value == null ? '' : String(value);
  if (text === '') {
    return { label: 'Sin dato', kind: 'danger' };
  }
  const etiqueta =
    field?.type === 'select'
      ? ((field as SelectField).options?.find((option) => option.value === text)?.label ?? text)
      : text;
  return { label: etiqueta, kind: resolveBadgeKind(text) };
}
