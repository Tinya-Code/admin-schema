import { Component, computed, input } from '@angular/core';

import { LucideClock } from '@lucide/angular';

import { Badge, type BadgeKind } from '../../shared/components/badge/badge';
import type { FieldSchema } from '../../core/models/schema.model';
import { resolveBadgeKind } from './display-badge';

const FORMATO_FECHA_HORA = new Intl.DateTimeFormat('es-PE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

type Item = Record<string, unknown>;

/**
 * Display por defecto de `list` (R4.1 · modo `display`).
 *
 * Es la línea de tiempo del historial: **toda la plantilla de `list` que
 * vivía en `detail-view`** se muda acá, que es lo que R4.2 exige
 * («`detail-view` no tiene plantilla propia de campo»). El agrupador sigue
 * siendo `detail-view`: él decide que este campo va en su bloque con el
 * `<h3>` y el ancho grande; acá sólo se pinta el valor.
 *
 * `itemFields` no participa: el timeline lee `action` / `at` / `detail`
 * directamente, igual que antes.
 */
@Component({
  selector: 'app-field-display-list',
  imports: [Badge, LucideClock],
  template: `
    @if (chip()) {
      <!-- Paridad R4.2: la cabecera siempre mostró el valor formateado
           como chip, y para una lista ese valor era «N elementos». -->
      <app-badge [label]="resumen()" />
    } @else if (items().length > 0) {
      <div
        class="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-neutral/20"
      >
        @for (item of items(); track $index) {
          <div class="relative group">
            <span
              class="absolute -left-6 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 ring-4 ring-surface"
            >
              <span class="h-1.5 w-1.5 rounded-full bg-primary"></span>
            </span>
            <div
              class="rounded-xl border border-neutral/10 bg-neutral/5 p-3.5 transition hover:border-neutral/20"
            >
              <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                @if (item['action']) {
                  <app-badge
                    [label]="etiquetaAccion(item['action'])"
                    [kind]="kindAccion(item['action'])"
                  />
                }
                @if (item['at']) {
                  <span class="text-xs text-neutral flex items-center gap-1">
                    <svg lucideClock size="12" />
                    {{ fechaHora(item['at']) }}
                  </span>
                }
              </div>
              @if (item['detail']) {
                <p class="text-sm text-neutral-light">{{ item['detail'] }}</p>
              }
            </div>
          </div>
        }
      </div>
    } @else {
      <p class="text-xs italic text-neutral">No hay registros en el historial.</p>
    }
  `,
})
export class FieldDisplayList {
  readonly field = input.required<FieldSchema>();
  readonly value = input<unknown>(null);
  /** `true` en la cabecera: el resumen «N elementos» va como chip. */
  readonly chip = input(false);

  /** El host entrega el valor crudo; sólo un array tiene timeline. */
  protected readonly items = computed<Item[]>(() =>
    Array.isArray(this.value()) ? (this.value() as Item[]) : [],
  );

  /** Mismo texto que daba el formateo de detalle previo a R4.2. */
  protected resumen(): string {
    return `${this.items().length} elementos`;
  }

  protected fechaHora(valor: unknown): string {
    if (!valor) return '—';
    const d = new Date(String(valor));
    return Number.isNaN(d.getTime()) ? String(valor) : FORMATO_FECHA_HORA.format(d);
  }

  protected etiquetaAccion(valor: unknown): string {
    if (!valor) return '';
    return String(valor).replace(/_/g, ' ');
  }

  protected kindAccion(valor: unknown): BadgeKind {
    return resolveBadgeKind(String(valor));
  }
}
