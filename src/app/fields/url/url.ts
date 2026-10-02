import { Component, computed, input } from '@angular/core';
import { FormField } from '@angular/forms/signals';

import type { UrlField } from '../../core/models/schema.model';
import { childTree, type RootTree } from '../field-node';

/**
 * Input con validación de URL y botón «abrir» (base.md §5.1). La validación
 * de formato la aporta Fase 10 (`pattern`/`validate`); acá solo se enlaza el
 * valor cuando es http(s).
 */
@Component({
  selector: 'app-field-url',
  imports: [FormField],
  template: `
    <div class="flex items-start gap-2">
      <input
        type="url"
        class="field-input"
        [id]="state().name()"
        [formField]="node()"
        [placeholder]="field().placeholder ?? 'https://…'"
      />
      @if (href(); as href) {
        <a
          class="shrink-0 rounded-lg border border-neutral/30 px-3 py-2 text-sm hover:border-primary"
          [href]="href"
          target="_blank"
          rel="noopener noreferrer"
        >
          Abrir
        </a>
      }
    </div>
  `,
})
export class FieldUrl {
  readonly field = input.required<UrlField>();
  readonly tree = input.required<RootTree>();

  protected readonly node = computed(() => childTree<string>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());

  /** Solo http(s): evita enlazar `javascript:` u otros esquemas. */
  protected readonly href = computed(() => {
    const value = this.state().value();
    return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
  });
}
