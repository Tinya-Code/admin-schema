import { Component, computed, ElementRef, input, viewChild } from '@angular/core';
import { FormField } from '@angular/forms/signals';

import type { TextareaField } from '../../core/models/schema.model';
import { FieldAria } from '../field-aria';
import { childTree, type RootTree } from '../field-node';
import { Button } from '../../shared/components/button/button';

/**
 * Área multilínea con contador de caracteres/palabras (base.md §5.1).
 * Los límites salen de `validators.*`, con `minWords`/`maxWords` del tipo
 * como respaldo, y coinciden con las reglas de `form-view/form-schema.ts`.
 *
 * Cuando el campo declara `tokens`, se pinta una fila de chips debajo: cada
 * chip escribe `{key}` **en la posición del cursor** (no al final) y devuelve
 * el foco, así el operador escribe → apreta → sigue escribiendo. Es la UI de
 * la plantilla de compartir; el motor back no se entera.
 */
@Component({
  selector: 'app-field-textarea',
  imports: [FieldAria, FormField, Button],
  template: `
    <div>
      <textarea
        class="field-input"
        [id]="state().name()"
        [formField]="node()"
        [placeholder]="field().placeholder ?? ''"
        [attr.rows]="field().rows ?? 4"
        #area
      ></textarea>
      @if (field().tokens?.length) {
        <div class="mt-1.5 flex flex-wrap gap-2 lg:gap-1.5" data-testid="textarea-tokens">
          @for (token of field().tokens; track token.key) {
            <button
              app-button
              type="button"
              variant="outline"
              size="sm"
              [attr.title]="'Inserta {' + token.key + '} en el texto'"
              (click)="insertToken(token.key)"
            >
              {{ token.label }}
            </button>
          }
        </div>
      }
      @if (counter(); as counter) {
        <div class="mt-1 flex justify-right text-xs text-neutral" data-testid="textarea-counter">
          {{ counter }}
        </div>
      }
    </div>
  `,
})
export class FieldTextarea {
  readonly field = input.required<TextareaField>();
  readonly tree = input.required<RootTree>();

  private readonly area = viewChild<ElementRef<HTMLTextAreaElement>>('area');

  protected readonly node = computed(() => childTree<string>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());

  /**
   * Escribe `{key}` donde está el cursor (o reemplaza la selección) y
   * reposiciona el cursor DESPUÉS del token insertado, para seguir escribiendo.
   *
   * Si el textarea aún no está montado (o no hay cursor válido) cae al
   * final del texto: nunca revienta por un click temprano.
   */
  protected insertToken(key: string): void {
    const area = this.area()?.nativeElement;
    const token = `{${key}}`;
    const current =
      typeof this.state().value() === 'string' ? (this.state().value() as string) : '';

    let next: string;
    let caret: number;
    if (area) {
      const start = area.selectionStart ?? current.length;
      const end = area.selectionEnd ?? start;
      next = current.slice(0, start) + token + current.slice(end);
      caret = start + token.length;
    } else {
      next = current + token;
      caret = next.length;
    }

    this.state().value.set(next);

    if (area) {
      area.focus();
      area.setSelectionRange(caret, caret);
    }
  }

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
