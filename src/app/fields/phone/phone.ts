import { Component, computed, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';

import type { PhoneField } from '../../core/models/schema.model';
import { FieldAria } from '../field-aria';
import { childTree, type RootTree } from '../field-node';

/**
 * Input telefónico (base.md §5.1). El valor se normaliza al perder el foco:
 * `e164` → `+` y dígitos (máx. 15); `digits` → solo dígitos. Mientras se
 * escribe se conserva lo tipeado.
 */
@Component({
  selector: 'app-field-phone',
  imports: [FieldAria, FormField],
  template: `
    <input
      type="tel"
      class="field-input"
      [id]="state().name()"
      [formField]="node()"
      [placeholder]="field().placeholder ?? ''"
      (blur)="normalize()"
    />
  `,
})
export class FieldPhone {
  readonly field = input.required<PhoneField>();
  readonly tree = input.required<RootTree>();

  protected readonly node = computed(() => childTree<string>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());

  protected normalize(): void {
    const current = this.state().value();
    if (typeof current !== 'string' || current === '') {
      return;
    }
    const digits = current.replace(/\D/g, '');
    const normalized =
      this.field().format === 'digits' ? digits : digits !== '' ? `+${digits.slice(0, 15)}` : '';
    if (normalized !== current) {
      this.state().value.set(normalized);
    }
  }
}
