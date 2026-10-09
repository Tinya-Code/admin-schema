import { Component, computed, input } from '@angular/core';

import { Badge } from '../../shared/components/badge/badge';
import type { FieldSchema } from '../../core/models/schema.model';

/**
 * Display por defecto de los tipos textuales (R4.1 · modo `display`).
 *
 * Toma el valor crudo del registro —no el árbol del formulario— y lo pinta
 * como texto: el `default` de `formatValue` de `detail-view`, que era donde
 * caían `text`, `textarea`, `slug`, `url`, `email`, `phone`, `readonly-text`,
 * `relation`, `group`, `key-value`, `string-list`, `multiselect` y `time`.
 *
 * `String(raw)` conserva el comportamiento previo (un array sale `a,b`; un
 * objeto sale `[object Object]`): R4.2 pide que «los 7 detalles rendericen
 * igual», así que la paridad manda sobre la estética.
 *
 * Todos los display declaran `field`, `value` y `chip` aunque no los usen:
 * el host les pasa la misma forma a los 6 y `ngComponentOutletInputs` no
 * admite claves que el componente no declare.
 */
@Component({
  selector: 'app-field-display-text',
  imports: [Badge],
  template: `
    @if (chip()) {
      <app-badge [label]="texto()" />
    } @else {
      {{ texto() }}
    }
  `,
})
export class FieldDisplayText {
  /** Campo que se pinta. Lo usa el tipo; acá sólo tipa la forma común. */
  readonly field = input.required<FieldSchema>();
  /** Valor crudo del registro. El host ya filtró el vacío (`—`). */
  readonly value = input<unknown>(null);
  /** `true` en la cabecera: el texto se pinta como chip compacto. */
  readonly chip = input(false);

  protected readonly texto = computed(() => String(this.value()));
}
