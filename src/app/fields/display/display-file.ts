import { Component, computed, input } from '@angular/core';

import { Badge } from '../../shared/components/badge/badge';
import type { FieldSchema } from '../../core/models/schema.model';

/**
 * Display por defecto de `file` (R4.1 · modo `display` · R9.5.3).
 *
 * Un archivo no tiene miniatura: el valor es la URL pública, y lo honesto
 * en la ficha de detalle es un enlace que lo abre (mismo lenguaje que el
 * «Abrir» de `url`). En la cabecera (`chip`) va como badge con la URL, la
 * paridad con el resto de los displays.
 */
@Component({
  selector: 'app-field-display-file',
  imports: [Badge],
  template: `
    @if (chip()) {
      <app-badge [label]="url()" />
    } @else {
      <a
        class="font-medium text-primary hover:underline"
        [href]="url()"
        target="_blank"
        rel="noopener noreferrer"
      >
        Abrir archivo
      </a>
    }
  `,
})
export class FieldDisplayFile {
  /** Campo que se pinta. Lo usa el tipo; acá sólo tipa la forma común. */
  readonly field = input.required<FieldSchema>();
  /** Valor crudo del registro (la URL pública). El host ya filtró el vacío. */
  readonly value = input<unknown>(null);
  /** `true` en la cabecera: la URL se pinta como chip compacto. */
  readonly chip = input(false);

  protected readonly url = computed(() => String(this.value()));
}
