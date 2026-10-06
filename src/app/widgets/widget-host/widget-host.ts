import { Component, computed, input } from '@angular/core';

import type {
  BarChartWidget,
  ChartLineWidget,
  MetricCardWidget,
  QuickActionsWidget,
  RecordListWidget,
  StatusProgressWidget,
  WidgetSchema,
} from '../../core/models/schema.model';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { BarChart, type BarDatum } from '../bar-chart/bar-chart';
import { ChartLine } from '../chart-line/chart-line';
import { MetricCard } from '../metric-card/metric-card';
import { QuickActions } from '../quick-actions/quick-actions';
import { RecordList } from '../record-list/record-list';
import { StatusProgress } from '../status-progress/status-progress';

/** Tipos que la UI sabe renderizar. */
const SUPPORTED_WIDGET_TYPES = new Set<string>([
  'metric-card',
  'bar-chart',
  'chart-line',
  'record-list',
  'quick-actions',
  'status-progress',
]);

/** ¿La UI sabe renderizar este widget? */
export function isSupportedWidgetType(type: string): boolean {
  return SUPPORTED_WIDGET_TYPES.has(type);
}

/**
 * Despachador de widgets por `type` con soporte para anchos en grilla de 12 columnas.
 */
@Component({
  selector: 'app-widget-host',
  imports: [BarChart, ChartLine, MetricCard, RecordList, QuickActions, StatusProgress, Skeleton],
  host: {
    '[class]': 'gridSpanClass()',
  },
  template: `
    @if (supported()) {
      @switch (widget().type) {
        @case ('metric-card') {
          <app-metric-card
            [label]="metricCard().label"
            [value]="data()"
            [hint]="metricCard().hint ?? ''"
          />
        }
        @case ('bar-chart') {
          <app-bar-chart
            [label]="barChart().label"
            [data]="series()"
            [unit]="barChart().unit ?? ''"
          />
        }
        @case ('chart-line') {
          <div aria-live="polite" aria-atomic="true">
            @defer (on viewport) {
              <app-chart-line
                [label]="chartLine().label"
                [data]="series()"
                [unit]="chartLine().unit ?? ''"
              />
            } @placeholder {
              <div class="rounded-lg border border-neutral/20 bg-surface p-4" aria-hidden="true">
                <p class="mb-3 text-sm text-neutral">{{ chartLine().label }}</p>
                <div class="relative h-32">
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
        @case ('record-list') {
          <app-record-list [widget]="recordList()" [data]="recordListData()" />
        }
        @case ('quick-actions') {
          <app-quick-actions [widget]="quickActions()" />
        }
        @case ('status-progress') {
          <app-status-progress [widget]="statusProgress()" [data]="statusProgressData()" />
        }
      }
    }
  `,
})
export class WidgetHost {
  readonly widget = input.required<WidgetSchema>();
  readonly data = input<unknown>(null);

  protected readonly supported = computed(() => isSupportedWidgetType(this.widget().type));

  protected readonly gridSpanClass = computed(() => {
    const w = this.widget().width;
    switch (w) {
      case 12:
        return 'col-span-12 block';
      case 8:
        return 'col-span-12 lg:col-span-8 block';
      case 6:
        return 'col-span-12 sm:col-span-6 block';
      case 4:
        return 'col-span-12 sm:col-span-6 lg:col-span-4 block';
      case 3:
        return 'col-span-12 sm:col-span-6 lg:col-span-3 block';
      default:
        return 'col-span-12 sm:col-span-6 lg:col-span-4 block';
    }
  });

  protected readonly metricCard = computed(() => this.widget() as MetricCardWidget);
  protected readonly barChart = computed(() => this.widget() as BarChartWidget);
  protected readonly chartLine = computed(() => this.widget() as ChartLineWidget);
  protected readonly recordList = computed(() => this.widget() as RecordListWidget);
  protected readonly quickActions = computed(() => this.widget() as QuickActionsWidget);
  protected readonly statusProgress = computed(() => this.widget() as StatusProgressWidget);

  protected readonly recordListData = computed<Record<string, unknown>[] | null>(() => {
    const val = this.data();
    return Array.isArray(val) ? (val as Record<string, unknown>[]) : null;
  });

  protected readonly statusProgressData = computed<Record<string, unknown> | null>(() => {
    const val = this.data();
    return typeof val === 'object' && val !== null ? (val as Record<string, unknown>) : null;
  });

  protected readonly series = computed<BarDatum[]>(() => {
    const data = this.data();
    if (!Array.isArray(data)) {
      return [];
    }
    return data.filter(
      (row): row is BarDatum =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as BarDatum).label === 'string' &&
        typeof (row as BarDatum).value === 'number',
    );
  });

  protected readonly sparkPoints = computed(() => {
    const rows = this.series();
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
}
