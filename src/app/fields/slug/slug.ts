import { Component, computed, effect, input, signal } from '@angular/core';
import { FormField } from '@angular/forms/signals';

import type { SlugField } from '../../core/models/schema.model';
import { slugify } from '../../shared/utils/slugify';
import { childTree, type RootTree } from '../field-node';

/**
 * Slug autogenerado desde otro campo (base.md §5.1). Se regenera mientras el
 * usuario no lo edite a mano; queda bloqueado tras crear el registro si
 * `lockAfterCreate` no es `false`. La rama bloqueada no usa `formField`
 * (atributo `readonly` estático y sin sincronización).
 */
@Component({
  selector: 'app-field-slug',
  imports: [FormField],
  template: `
    @if (locked()) {
      <input
        type="text"
        class="field-input"
        [id]="state().name()"
        [value]="state().value()"
        readonly
      />
    } @else {
      <input
        type="text"
        class="field-input"
        [id]="state().name()"
        [formField]="node()"
        [placeholder]="field().placeholder ?? ''"
        (input)="manual.set(true)"
      />
    }
  `,
})
export class FieldSlug {
  readonly field = input.required<SlugField>();
  readonly tree = input.required<RootTree>();
  /** Si el registro ya existe (lo informa form-view, Fase 10). */
  readonly exists = input(false);

  /** Edición manual del usuario: corta la autogeneración. */
  protected readonly manual = signal(false);

  protected readonly node = computed(() => childTree<string>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());

  protected readonly locked = computed(
    () => this.field().lockAfterCreate !== false && this.exists(),
  );

  private readonly sourceValue = computed(() =>
    childTree<unknown>(this.tree(), this.field().from)().value(),
  );

  constructor() {
    effect(() => {
      if (this.locked() || this.manual()) {
        return;
      }
      this.state().value.set(slugify(String(this.sourceValue() ?? '')));
    });
  }
}
