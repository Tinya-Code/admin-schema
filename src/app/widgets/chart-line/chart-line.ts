import {
  AfterViewInit,
  Component,
  OnDestroy,
  computed,
  effect,
  input,
  viewChild,
} from '@angular/core';
import type { ElementRef } from '@angular/core';
import {
  CategoryScale,
  Chart,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js';

import type { BarDatum } from '../bar-chart/bar-chart';

// Chart.js usa registro explícito en vez de `chart.js/auto`: sólo entra lo que
// esta serie necesita (sin DoughnutController, sin Filler, sin Legend).
Chart.register(CategoryScale, LineController, LineElement, LinearScale, PointElement, Tooltip);

/**
 * Serie temporal con Chart.js (viabilidad B2.1).
 *
 * La librería —61,4 K gz medidos— sólo se arrastra con ESTE componente, y
 * `widget-host` lo referencia exclusivamente dentro de su
 * `@defer (on viewport)`. Por eso vive en el chunk diferido que Angular
 * genera y **no entra en el bundle inicial**. Las tres condiciones del
 * compilador se cumplen (angular.dev «Deferred loading with @defer»): es
 * standalone, se referencia sólo dentro del bloque y se importa por ruta
 * directa — el repo no tiene barrels, que son la causa nº 1 de que el
 * chunk diferido no se cree.
 *
 * El `@defer` vive en `widget-host` y no acá: sólo un componente referenciado
 * desde otro archivo es lo que el compilador parte.
 */
@Component({
  selector: 'app-chart-line',
  template: `
    <div class="rounded-lg border border-neutral/20 bg-surface p-4">
      <p class="mb-3 text-sm text-neutral">{{ label() }}</p>

      @if (data().length === 0) {
        <p class="text-sm text-neutral/60" data-testid="empty">Sin datos.</p>
      } @else {
        <div role="img" [attr.aria-label]="summary()" class="relative h-32">
          <canvas #canvas class="absolute inset-0 h-full w-full"></canvas>
        </div>
      }
    </div>
  `,
})
export class ChartLine implements AfterViewInit, OnDestroy {
  /** Título del gráfico. */
  readonly label = input.required<string>();
  /** Series a dibujar; vacío ⇒ estado «Sin datos». */
  readonly data = input<BarDatum[]>([]);
  /** Sufijo de las cifras del eje («unidades», «S/»). */
  readonly unit = input('');

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart: Chart<'line'> | null = null;

  /**
   * Los efectos corren DURANTE el ciclo de CD, así que en el primer ciclo
   * el lienzo todavía no existe. Esta banda mantiene el `effect` inerte
   * hasta que `ngAfterViewInit` haya dibujado de verdad.
   */
  private ready = false;

  constructor() {
    effect(() => {
      this.data();
      this.label();
      this.unit();
      if (this.ready) {
        this.render();
      }
    });
  }

  ngAfterViewInit(): void {
    this.ready = true;
    this.render();
  }

  ngOnDestroy(): void {
    this.destroy();
  }

  protected readonly summary = computed(() => {
    const rows = this.data();
    if (rows.length === 0) {
      return 'Sin datos.';
    }
    const unit = this.unit();
    const first = rows[0];
    const last = rows[rows.length - 1];
    const delta = last.value - first.value;
    const trend = delta > 0 ? 'sube' : delta < 0 ? 'baja' : 'se mantiene';
    return (
      `Serie de ${rows.length} puntos, de ${first.label} (${first.value}${unit}) ` +
      `a ${last.label} (${last.value}${unit}): ${trend}.`
    );
  });

  private render(): void {
    const rows = this.data();

    // Sin datos no hay lienzo en el template: acceder a `canvas` lanzaría.
    if (rows.length === 0) {
      this.destroy();
      return;
    }

    const canvas = this.canvas().nativeElement;
    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels: rows.map((row) => row.label),
        datasets: [
          {
            label: this.label(),
            data: rows.map((row) => row.value),
            borderColor: this.cssColor('--color-primary'),
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.35,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: true, mode: 'index', intersect: false },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) =>
                typeof value === 'number' ? `${value}${this.unit()}` : String(value),
            },
          },
        },
      },
    };

    this.destroy();
    this.chart = new Chart<'line'>(canvas, config);
  }

  private destroy(): void {
    this.chart?.destroy();
    this.chart = null;
  }

  /**
   * Chart.js pinta en el lienzo y NO entiende `var(--…)`, así que el token se
   * resuelve en tiempo de dibujo. Se lee en cada render —no al arrancar—
   * porque el modo oscuro sobre-escribe `--color-primary` (`styles/theme.css`).
   */
  private cssColor(token: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    return value || '#1d69f0';
  }
}
