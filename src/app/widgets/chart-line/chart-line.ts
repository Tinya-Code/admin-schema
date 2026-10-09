import { Component, OnDestroy, computed, effect, input, viewChild } from '@angular/core';
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

import { Skeleton } from '../../shared/components/skeleton/skeleton';
import type { BarDatum } from '../bar-chart/bar-chart';

// Chart.js usa registro explícito en vez de `chart.js/auto`: sólo entra lo que
// esta serie necesita (sin DoughnutController, sin Filler, sin Legend).
Chart.register(CategoryScale, LineController, LineElement, LinearScale, PointElement, Tooltip);

/**
 * Serie temporal con Chart.js (viabilidad B2.1).
 *
 * La librería —61,4 K gz medidos— sólo se arrastra con ESTE componente y se
 * descarga en su propio chunk: el descriptor del widget la trae con
 * `import('./chart-line')` y es esa llamada la que hace que esbuild la
 * aparte del bundle inicial (aquí se importa estáticamente, así que ningún
 * `@defer` de otro fichero podría separarla).
 *
 * El `@defer (on viewport)` de abajo cumple el otro objetivo y vive aquí, y
 * no en un host: el chunk llega con el panel, pero el lienzo y la instancia
 * de `Chart` sólo se crean cuando el gráfico entra en pantalla. Un host no
 * puede decidir eso — desde R3.6 el motor no conoce ningún tipo concreto
 * (R3.6 · `doc/plan-refactor-motor.md`).
 *
 * La condición `on viewport` necesita `IntersectionObserver`, que jsdom no
 * trae: los tests configuran `DeferBlockBehavior.Manual` y pintan el bloque
 * a mano, igual que hacía `widget-host.spec`.
 */
@Component({
  selector: 'app-chart-line',
  imports: [Skeleton],
  template: `
    <div class="rounded-lg border border-neutral/20 bg-surface p-4">
      <p class="mb-3 text-sm text-neutral">{{ label() }}</p>

      @if (data().length === 0) {
        <p class="text-sm text-neutral/60" data-testid="empty">Sin datos.</p>
      } @else {
        <div aria-live="polite" aria-atomic="true">
          @defer (on viewport) {
            <div role="img" [attr.aria-label]="summary()" class="relative h-32">
              <canvas #canvas class="absolute inset-0 h-full w-full"></canvas>
            </div>
          } @placeholder {
            <div class="relative h-32" aria-hidden="true">
              <svg
                viewBox="0 0 100 40"
                preserveAspectRatio="none"
                class="absolute inset-0 h-full w-full text-primary"
              >
                <polyline
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  vector-effect="non-scaling-stroke"
                  [attr.points]="sparkPoints()"
                />
              </svg>
            </div>
          } @loading {
            <app-skeleton [lines]="3" [height]="24" />
          } @error {
            <p class="text-sm text-neutral/60" data-testid="chart-error">
              No se pudo cargar el gráfico.
            </p>
          }
        </div>
      }
    </div>
  `,
})
export class ChartLine implements OnDestroy {
  /** Título del gráfico. */
  readonly label = input.required<string>();
  /** Series a dibujar; vacío ⇒ estado «Sin datos». */
  readonly data = input<BarDatum[]>([]);
  /** Sufijo de las cifras del eje («unidades», «S/»). */
  readonly unit = input('');

  /**
   * Opcional y no `required`: el lienzo sólo existe una vez completado el
   * `@defer`, así que el `effect` de abajo se re-ejecuta solo al aparecer y
   * dibuja en ese momento. Un `viewChild.required` reventaría en el primer
   * ciclo, cuando el bloque todavía está en placeholder.
   */
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  private chart: Chart<'line'> | null = null;

  constructor() {
    effect(() => {
      const lienzo = this.canvas();
      this.data();
      this.label();
      this.unit();

      if (lienzo) {
        this.render(lienzo.nativeElement);
      } else {
        // Sin lienzo (sin datos, o el bloque aún en placeholder) no hay nada
        // que mantener vivo: una instancia huérfana seguiría redibujando.
        this.destroy();
      }
    });
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

  /** Miniatura del placeholder: la misma serie, dibujada con SVG y sin JS. */
  protected readonly sparkPoints = computed(() => {
    const rows = this.data();
    if (rows.length === 0) {
      return '';
    }
    const max = Math.max(0, ...rows.map((row) => row.value));
    const last = rows.length - 1;
    return rows
      .map((row, index) => {
        const x = last === 0 ? 50 : (index / last) * 100;
        const y = max === 0 ? 40 : 40 - (row.value / max) * 36;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  });

  private render(canvas: HTMLCanvasElement): void {
    const rows = this.data();

    // Sin datos no hay lienzo en el template: crear un `Chart` sobre él
    // reventaría (y el `@if` ya se lo habría llevado por delante).
    if (rows.length === 0) {
      this.destroy();
      return;
    }

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
