import { Component, computed, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';

import type { BooleanField } from '../../core/models/schema.model';
import { FieldAria } from '../field-aria';
import { childTree, type RootTree } from '../field-node';

/**
 * Interruptor booleano (base.md §5.1) con `trueLabel`/`falseLabel`.
 * Checkbox nativo + `formField` (se estiliza como switch con `peer-checked`).
 */
@Component({
  selector: 'app-field-boolean',
  imports: [FieldAria, FormField],
  template: `
    <label class="inline-flex cursor-pointer items-center gap-2">
      <input type="checkbox" class="peer sr-only" [id]="state().name()" [formField]="node()" />
      <span
        class="relative h-5 w-9 shrink-0 rounded-full bg-neutral/30 transition-colors peer-checked:bg-primary after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform after:content-[''] peer-checked:after:translate-x-4"
      ></span>
      <span class="text-sm">{{ currentLabel() }}</span>
    </label>
  `,
})
export class FieldBoolean {
  readonly field = input.required<BooleanField>();
  readonly tree = input.required<RootTree>();

  protected readonly node = computed(() => childTree<boolean>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());

  protected readonly currentLabel = computed(() => {
    const on = this.state().value() === true;
    const field = this.field();
    if (on) {
      return field.trueLabel ?? 'Sí';
    }
    return field.falseLabel ?? 'No';
  });
}
