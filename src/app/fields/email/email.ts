import { Component, computed, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';

import type { EmailField } from '../../core/models/schema.model';
import { childTree, type RootTree } from '../field-node';

/** Input de correo (base.md §5.1); la validación `email()` llega en Fase 10. */
@Component({
  selector: 'app-field-email',
  imports: [FormField],
  template: `
    <input
      type="email"
      class="field-input"
      [id]="state().name()"
      [formField]="node()"
      [placeholder]="field().placeholder ?? ''"
    />
  `,
})
export class FieldEmail {
  readonly field = input.required<EmailField>();
  readonly tree = input.required<RootTree>();

  protected readonly node = computed(() => childTree<string>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());
}
