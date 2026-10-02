import { Component, computed, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';

import type { TextField } from '../../core/models/schema.model';
import { childTree, type RootTree } from '../field-node';

/**
 * Input de una línea (base.md §5.1 `text`).
 *
 * `readonly`, `maxLength` y `pattern` NO se bindean como atributos: el
 * directive `FormField` los gestiona desde el estado del campo y el compilador
 * lo exige (NG8022). La Fase 10 los traduce a reglas (`readonly()`,
 * `maxLength()`, `pattern()`) en el schema del formulario.
 */
@Component({
  selector: 'app-field-text',
  imports: [FormField],
  template: `
    <input
      type="text"
      class="field-input"
      [id]="state().name()"
      [formField]="node()"
      [placeholder]="field().placeholder ?? ''"
    />
  `,
})
export class FieldText {
  readonly field = input.required<TextField>();
  readonly tree = input.required<RootTree>();

  protected readonly node = computed(() => childTree<string>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());
}
