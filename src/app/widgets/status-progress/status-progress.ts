import { Component, computed, input } from '@angular/core';

import type { StatusProgressWidget } from '../../core/models/schema.model';

interface SegmentDisplay {
  key: string;
  label: string;
  value: number;
  percentage: number;
  barClass: string;
  dotClass: string;
}

const COLOR_MAP: Record<string, { bar: string; dot: string }> = {
  success: { bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  warning: { bar: 'bg-amber-500', dot: 'bg-amber-500' },
  danger: { bar: 'bg-rose-500', dot: 'bg-rose-500' },
  neutral: { bar: 'bg-neutral/40', dot: 'bg-neutral/40' },
};

/**
 * Barra de distribución porcentual de estados operativos.
 */
@Component({
  selector: 'app-status-progress',
  template: `
    <article class="flex h-full flex-col rounded-xl border border-neutral/20 bg-surface p-4">
      <header class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-neutral-light">{{ widget().label }}</h2>
        <span class="text-xs text-neutral" data-testid="total-count">
          Total: {{ totalCount() }}
        </span>
      </header>

      <!-- Barra segmentada -->
      <div
        class="flex h-3 w-full overflow-hidden rounded-full bg-neutral/10"
        role="progressbar"
        [attr.aria-valuenow]="totalCount()"
        [attr.aria-valuemin]="0"
        [attr.aria-valuemax]="totalCount()"
        [attr.aria-label]="widget().label"
      >
        @if (totalCount() === 0) {
          <div class="h-full w-full bg-neutral/20"></div>
        } @else {
          @for (seg of calculatedSegments(); track seg.key) {
            @if (seg.percentage > 0) {
              <div
                [class]="seg.barClass"
                [style.width.%]="seg.percentage"
                [title]="seg.label + ': ' + seg.value + ' (' + seg.percentage.toFixed(1) + '%)'"
              ></div>
            }
          }
        }
      </div>

      <!-- Leyenda -->
      <div class="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        @for (seg of calculatedSegments(); track seg.key) {
          <div class="flex items-center gap-1.5 text-neutral-light">
            <span class="h-2 w-2 rounded-full" [class]="seg.dotClass"></span>
            <span class="font-medium">{{ seg.label }}:</span>
            <span class="text-neutral">{{ seg.value }} ({{ seg.percentage.toFixed(0) }}%)</span>
          </div>
        }
      </div>
    </article>
  `,
})
export class StatusProgress {
  readonly widget = input.required<StatusProgressWidget>();
  readonly data = input<Record<string, unknown> | null>(null);

  protected readonly totalCount = computed(() => {
    const d = this.data() || {};
    return this.widget().segments.reduce((acc, seg) => {
      const val = Number(d[seg.key]);
      return acc + (isNaN(val) ? 0 : Math.max(0, val));
    }, 0);
  });

  protected readonly calculatedSegments = computed<SegmentDisplay[]>(() => {
    const d = this.data() || {};
    const total = this.totalCount();

    return this.widget().segments.map((seg) => {
      const raw = Number(d[seg.key]);
      const value = isNaN(raw) ? 0 : Math.max(0, raw);
      const percentage = total > 0 ? (value / total) * 100 : 0;
      const colors = COLOR_MAP[seg.color] || COLOR_MAP['neutral'];

      return {
        key: seg.key,
        label: seg.label,
        value,
        percentage,
        barClass: colors.bar,
        dotClass: colors.dot,
      };
    });
  });
}
