import { Component, computed, input } from '@angular/core';

/**
 * KPI de una cifra suelta («3 pendientes»).
 *
 * Cero dependencias: es sólo presentación — el valor lo trae el
 * orquestador del panel desde el endpoint de métricas.
 *
 * Sin `icon`: el schema no tiene hoy un registro de nombres de icono
 * (los Lucide se importan estáticamente), así que un `icon?: string` no
 * podría resolverse declarativamente. Se añade cuando exista ese registro.
 */
@Component({
  selector: 'app-metric-card',
  template: `
    <article class="rounded-lg border border-neutral/20 bg-surface p-4">
      <p class="text-sm text-neutral">{{ label() }}</p>

      @if (empty()) {
        <p class="font-display text-3xl font-semibold text-neutral/40" data-testid="value-empty">
          —
        </p>
      } @else {
        <p class="font-display text-3xl font-semibold" data-testid="value">{{ display() }}</p>
      }

      @if (hint()) {
        <p class="mt-1 text-xs text-neutral">{{ hint() }}</p>
      }
    </article>
  `,
})
export class MetricCard {
  /** Rótulo del KPI. */
  readonly label = input.required<string>();
  /** Cifra a mostrar; `null`/`undefined` ⇒ estado vacío. */
  readonly value = input<unknown>(null);
  /** Texto secundario estático bajo la cifra. */
  readonly hint = input('');

  /** `0` es un valor, no un vacío: sólo `null`/`undefined` vacían la tarjeta. */
  protected readonly empty = computed(() => this.value() === null || this.value() === undefined);

  protected readonly display = computed(() => {
    const value = this.value();
    return typeof value === 'number' ? new Intl.NumberFormat('es-PE').format(value) : String(value);
  });
}
