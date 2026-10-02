import { Component, computed, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';

import type { NumberField } from '../../core/models/schema.model';
import { childTree, type RootTree } from '../field-node';

/**
 * Input numérico (base.md §5.1). `step` sale del tipo o de `decimals`;
 * `min`/`max` los gestiona `FormField` desde las reglas (Fase 10).
 */
@Component({
  selector: 'app-field-number',
  imports: [FormField],
  template: `
    <input
      type="number"
      class="field-input"
      [id]="state().name()"
      [formField]="node()"
      [step]="stepAttr()"
      [placeholder]="field().placeholder ?? ''"
    />
  `,
})
export class FieldNumber {
  readonly field = input.required<NumberField>();
  readonly tree = input.required<RootTree>();

  protected readonly node = computed(() => childTree<number>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());

  protected readonly stepAttr = computed<number | null>(() => {
    const field = this.field();
    if (field.step !== undefined) {
      return field.step;
    }
    return field.decimals !== undefined ? Math.pow(10, -field.decimals) : null;
  });
}
