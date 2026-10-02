import { Component, computed, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';

import type { TextareaField } from '../../core/models/schema.model';
import { childTree, type RootTree } from '../field-node';

/**
 * Área multilínea con contador de caracteres/palabras (base.md §5.1).
 * Los límites salen de `validators.*`, con `minWords`/`maxWords` del tipo
 * como respaldo, y coinciden con las reglas de `form-view/form-schema.ts`.
 */
@Component({
  selector: 'app-field-textarea',
  imports: [FormField],
  template: `
    <div>
      <textarea
        class="field-input"
        [id]="state().name()"
        [formField]="node()"
        [placeholder]="field().placeholder ?? ''"
        [attr.rows]="field().rows ?? 4"
      ></textarea>
      @if (counter(); as counter) {
        <div class="mt-1 flex justify-end text-xs text-neutral" data-testid="textarea-counter">
          {{ counter }}
        </div>
      }
    </div>
  `,
})
export class FieldTextarea {
  readonly field = input.required<TextareaField>();
  readonly tree = input.required<RootTree>();

  protected readonly node = computed(() => childTree<string>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());

  /** Contador `n/m …`; `null` cuando el campo no declara límites. */
  protected readonly counter = computed<string | null>(() => {
    const field = this.field();
    const value = this.state().value();
    const text = typeof value === 'string' ? value : '';
    const chars = text.length;
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;

    const parts: string[] = [];
    const maxChars = field.validators?.maxLength;
    if (maxChars !== undefined) {
      parts.push(`${chars}/${maxChars} caracteres`);
    }
    // `validators` tiene prioridad sobre las opciones propias del tipo
    // (mismo criterio que las reglas de `form-schema.ts`).
    const maxWords = field.validators?.maxWords ?? field.maxWords;
    const minWords = field.validators?.minWords ?? field.minWords;
    if (maxWords !== undefined) {
      parts.push(
        minWords !== undefined
          ? `${words}/${maxWords} palabras (mín. ${minWords})`
          : `${words}/${maxWords} palabras`,
      );
    } else if (minWords !== undefined) {
      parts.push(`${words} palabras (mín. ${minWords})`);
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  });
}
