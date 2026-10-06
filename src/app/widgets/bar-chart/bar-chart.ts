import { Component, computed, input } from '@angular/core';

export interface BarDatum {
  label: string;
  value: number;
}

/**
 * Barras por categoría, sin librería: se dibujan con CSS y un `@for` de
 * Angular (~1 K gz frente a los 61,4 K de Chart.js — viabilidad B2.1).
 *
 * Accesibilidad (plan 3.2): la grilla es `role="img"` con un `aria-label`
 * que resume los datos, de modo que un lector de pantalla no recorra cada
 * barra suelta sino que escuche «8 categorías. Mayor: …».
 */
@Component({
  selector: 'app-bar-chart',
  template: `
    <div class="rounded-lg border border-neutral/20 bg-surface p-4">
      <p class="mb-3 text-sm text-neutral">{{ label() }}</p>

      @if (data().length === 0) {
        <p class="text-sm text-neutral/60" data-testid="empty">Sin datos.</p>
      } @else {
        <div role="img" [attr.aria-label]="summary()" class="flex h-32 items-end gap-2">
          @for (row of data(); track row.label) {
            <div class="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span class="text-xs tabular-nums text-neutral"> {{ row.value }}{{ unit() }} </span>
              <div class="w-full rounded-t bg-primary" [style.height.%]="height(row.value)"></div>
              <span class="w-full truncate text-center text-xs text-neutral">{{ row.label }}</span>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class BarChart {
  /** Título del gráfico. */
  readonly label = input.required<string>();
  /** Series a dibujar; vacío ⇒ estado «Sin datos». */
  readonly data = input<BarDatum[]>([]);
  /** Sufijo de las cifras del eje («unidades», «S/»). */
  readonly unit = input('');

  private readonly max = computed(() => Math.max(0, ...this.data().map((row) => row.value)));

  /**
   * Altura relativa de una barra. `max = 0` ⇒ 0 % (nada de división por
   * cero); un valor de 0 se queda en 0, y los demás bajan a un 2 % mínimo
   * para que la barra siga siendo visible.
   */
  protected height(value: number): number {
    if (value === 0) {
      return 0;
    }
    const max = this.max();
    if (max === 0) {
      return 0;
    }
    return Math.max(2, (value / max) * 100);
  }

  protected readonly summary = computed(() => {
    const rows = this.data();
    if (rows.length === 0) {
      return 'Sin datos.';
    }
    const top = rows.reduce((best, row) => (row.value > best.value ? row : best), rows[0]);
    const unit = this.unit();
    return (
      `${rows.length} categorías. Mayor: ${top.label} con ${top.value}${unit}. ` +
      `Menor: ${rows.reduce((low, row) => (row.value < low.value ? row : low), rows[0]).label}.`
    );
  });
}
