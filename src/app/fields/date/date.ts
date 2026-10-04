import { Component, computed, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';

import type { DateField } from '../../core/models/schema.model';
import { FieldAria } from '../field-aria';
import { childTree, type RootTree } from '../field-node';

/**
 * Selector de fecha ISO `YYYY-MM-DD` (base.md §5.1).
 *
 * `min`/`max` del schema se validan con reglas propias en
 * `pages/form-view/form-schema.ts`: `minDate`/`maxDate` de Signal Forms
 * exigen valores `Date` y este modelo guarda strings. `FormField` solo setea
 * los atributos nativos `min`/`max` cuando existen las reglas `min()`/`max()`
 * (que aplican a números).
 */
@Component({
  selector: 'app-field-date',
  imports: [FieldAria, FormField],
  template: `
    <input
      type="date"
      class="field-input"
      [id]="state().name()"
      [formField]="node()"
      [placeholder]="field().placeholder ?? ''"
    />
  `,
})
export class FieldDate {
  readonly field = input.required<DateField>();
  readonly tree = input.required<RootTree>();

  protected readonly node = computed(() => childTree<string>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());
}
