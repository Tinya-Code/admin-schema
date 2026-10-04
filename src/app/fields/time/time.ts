import { Component, computed, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';

import type { TimeField } from '../../core/models/schema.model';
import { FieldAria } from '../field-aria';
import { childTree, type RootTree } from '../field-node';

/** Selector de hora `HH:mm` (base.md §5.1). */
@Component({
  selector: 'app-field-time',
  imports: [FieldAria, FormField],
  template: `
    <input
      type="time"
      class="field-input"
      [id]="state().name()"
      [formField]="node()"
      [placeholder]="field().placeholder ?? ''"
    />
  `,
})
export class FieldTime {
  readonly field = input.required<TimeField>();
  readonly tree = input.required<RootTree>();

  protected readonly node = computed(() => childTree<string>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());
}
