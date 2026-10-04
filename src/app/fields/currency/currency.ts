import { Component, computed, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';

import type { CurrencyField } from '../../core/models/schema.model';
import { FieldAria } from '../field-aria';
import { childTree, type RootTree } from '../field-node';

/**
 * Número con prefijo de moneda (base.md §5.1). El valor sigue siendo número
 * puro; el prefijo sale del campo `currencyFrom` (código ISO, ej. `PEN`)
 * traducido a símbolo con Intl.
 */
@Component({
  selector: 'app-field-currency',
  imports: [FieldAria, FormField],
  template: `
    <div class="flex items-center gap-2">
      @if (symbol(); as symbol) {
        <span class="shrink-0 text-sm text-neutral" data-testid="currency-symbol">{{
          symbol
        }}</span>
      }
      <input
        type="number"
        step="any"
        class="field-input"
        [id]="state().name()"
        [formField]="node()"
        [placeholder]="field().placeholder ?? ''"
      />
    </div>
  `,
})
export class FieldCurrency {
  readonly field = input.required<CurrencyField>();
  readonly tree = input.required<RootTree>();

  protected readonly node = computed(() => childTree<number>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());

  /** Código ISO de la moneda desde el campo hermano (`currencyFrom`). */
  private readonly currencyCode = computed(() => {
    const from = this.field().currencyFrom;
    if (!from) {
      return null;
    }
    const value = childTree<unknown>(this.tree(), from)().value();
    return typeof value === 'string' && value !== '' ? value : null;
  });

  /** Símbolo localizado (`S/` para PEN); el código crudo si Intl lo rechaza. */
  protected readonly symbol = computed(() => {
    const code = this.currencyCode();
    if (code === null) {
      return null;
    }
    try {
      const parts = new Intl.NumberFormat('es-PE', {
        style: 'currency',
        currency: code,
      }).formatToParts(0);
      return parts.find((part) => part.type === 'currency')?.value ?? code;
    } catch {
      return code;
    }
  });
}
