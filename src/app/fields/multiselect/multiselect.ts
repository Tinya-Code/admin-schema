import { Component, input, model } from '@angular/core';
import { LucideX } from '@lucide/angular';
import type { FormValueControl } from '@angular/forms/signals';

import type { MultiselectField, SelectOption } from '../../core/models/schema.model';

/**
 * Selección múltiple con chips (base.md §5.1). `<select multiple>` no está
 * soportado por `[formField]`, así que es un control propio que cumple el
 * contrato `FormValueControl<string[]>`: el nodo llega desde el host con
 * `[formField]` y el valor se sincroniza por `model()`.
 */
@Component({
  selector: 'app-field-multiselect',
  imports: [LucideX],
  template: `
    <div class="space-y-2">
      @if (value().length > 0) {
        <div class="flex flex-wrap gap-1.5" data-testid="multiselect-chips">
          @for (item of value(); track item) {
            <span
              class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary"
            >
              {{ labelOf(item) }}
              <button
                type="button"
                class="rounded-full px-0.5 hover:text-danger"
                [attr.aria-label]="'Quitar ' + labelOf(item)"
                [disabled]="disabled()"
                (click)="remove(item)"
              >
                <svg lucideX size="14" />
              </button>
            </span>
          }
        </div>
      }
      <div class="flex flex-wrap gap-1.5">
        @for (option of field().options; track option.value) {
          @if (!isSelected(option.value)) {
            <button
              type="button"
              class="rounded-full border border-neutral/30 px-2.5 py-1 text-xs hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              [disabled]="disabled() || (option.disabled ?? false)"
              (click)="toggle(option)"
            >
              {{ option.label }}
            </button>
          }
        }
      </div>
    </div>
  `,
})
export class FieldMultiselect implements FormValueControl<string[]> {
  readonly field = input.required<MultiselectField>();

  /** Sincronizado por el directive `FormField` del host. */
  readonly value = model.required<string[]>();
  readonly disabled = input(false);

  protected toggle(option: SelectOption): void {
    if (this.disabled()) {
      return;
    }
    this.value.update((current) =>
      current.includes(option.value)
        ? current.filter((item) => item !== option.value)
        : [...current, option.value],
    );
  }

  protected remove(item: string): void {
    if (this.disabled()) {
      return;
    }
    this.value.update((current) => current.filter((value) => value !== item));
  }

  protected isSelected(item: string): boolean {
    return this.value().includes(item);
  }

  protected labelOf(item: string): string {
    return this.field().options.find((option) => option.value === item)?.label ?? item;
  }
}
