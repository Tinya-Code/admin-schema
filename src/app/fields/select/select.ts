import { Component, computed, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';

import type { SelectField } from '../../core/models/schema.model';
import { childTree, type RootTree } from '../field-node';

/** Desplegable de un solo valor (base.md §5.1). */
@Component({
  selector: 'app-field-select',
  imports: [FormField],
  template: `
    <select class="field-input" [id]="state().name()" [formField]="node()">
      @if (!field().required) {
        <option value="">{{ field().placeholder ?? '— Seleccionar —' }}</option>
      }
      @for (option of field().options; track option.value) {
        <option [value]="option.value" [disabled]="option.disabled ?? false">
          {{ option.label }}
        </option>
      }
    </select>
  `,
})
export class FieldSelect {
  readonly field = input.required<SelectField>();
  readonly tree = input.required<RootTree>();

  protected readonly node = computed(() => childTree<string>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());
}
