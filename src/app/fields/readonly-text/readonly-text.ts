import { Component, computed, input } from '@angular/core';

import type { ReadonlyTextField } from '../../core/models/schema.model';
import { childTree, type RootTree } from '../field-node';

/**
 * Dato de solo lectura (base.md §5.1, ej. `updated_at`). No edita: lee el
 * valor del árbol y lo presenta según `format` (`date`, `datetime`,
 * `number`; por defecto, texto). Renderiza `<output>` para que el `<label>`
 * del host pueda asociarse por `for`.
 */
@Component({
  selector: 'app-field-readonly-text',
  template: `
    <output
      [id]="state().name()"
      class="block py-2 text-sm text-neutral"
      data-testid="readonly-text"
    >
      {{ display() }}
    </output>
  `,
})
export class FieldReadonlyText {
  readonly field = input.required<ReadonlyTextField>();
  readonly tree = input.required<RootTree>();

  private readonly node = computed(() => childTree<unknown>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());

  protected readonly display = computed(() => {
    const value = this.state().value();
    if (value === null || value === undefined || value === '') {
      return '—';
    }
    const format = this.field().format;
    if (format === 'date' || format === 'datetime') {
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime())) {
        return String(value);
      }
      return new Intl.DateTimeFormat('es-PE', {
        timeZone: 'UTC',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        ...(format === 'datetime' ? { hour: '2-digit', minute: '2-digit' } : {}),
      }).format(date);
    }
    if (format === 'number') {
      const number = Number(value);
      return Number.isNaN(number) ? String(value) : new Intl.NumberFormat('es-PE').format(number);
    }
    return typeof value === 'string' ? value : String(value);
  });
}
