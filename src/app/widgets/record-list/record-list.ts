import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import type { RecordListWidget } from '../../core/models/schema.model';
import { interpolateTemplate, parseNavigationUrl } from '../../core/utils/template-interpolator';
import { EmptyState } from '../../shared/components/empty-state/empty-state';

/**
 * Tabla embebida de registros operativos para el Dashboard.
 * Permite visualizar filas clave (ej. pedidos que requieren atención)
 * con enlace de acción por fila hacia su ficha de detalle.
 */
@Component({
  selector: 'app-record-list',
  imports: [EmptyState, RouterLink],
  template: `
    <article class="flex h-full flex-col rounded-xl border border-neutral/20 bg-surface p-4">
      <header class="mb-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <h2 class="text-sm font-semibold text-neutral-light">{{ widget().label }}</h2>
          @if (rows().length > 0) {
            <span
              class="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
            >
              {{ rows().length }}
            </span>
          }
        </div>
      </header>

      @if (rows().length === 0) {
        <div class="flex flex-1 items-center justify-center py-6">
          <app-empty-state
            title="Sin registros pendientes"
            message="No hay registros que requieran atención en este momento."
          />
        </div>
      } @else {
        <div class="flex-1 overflow-x-auto">
          <table class="w-full text-left text-sm" role="table">
            <thead>
              <tr class="border-b border-neutral/10 text-xs text-neutral">
                @for (col of widget().columns; track col) {
                  <th scope="col" class="pb-2 font-medium capitalize">{{ formatHeader(col) }}</th>
                }
                @if (widget().action) {
                  <th scope="col" class="pb-2 text-right font-medium">Acción</th>
                }
              </tr>
            </thead>
            <tbody class="divide-y divide-neutral/10">
              @for (row of rows(); track trackRow(row, $index)) {
                <tr class="transition-colors hover:bg-neutral/5">
                  @for (col of widget().columns; track col) {
                    <td class="py-2.5 pr-3 text-neutral-light">
                      <span class="line-clamp-1">{{ formatCell(row[col]) }}</span>
                    </td>
                  }
                  @if (widget().action) {
                    <td class="py-2.5 text-right">
                      <a
                        [routerLink]="resolveRoute(row).path"
                        [queryParams]="resolveRoute(row).queryParams"
                        class="inline-flex items-center rounded-lg border border-neutral/30 bg-surface px-2.5 py-1 text-xs font-medium text-neutral-light transition-colors hover:bg-neutral/10"
                      >
                        {{ widget().action?.label || 'Ver' }}
                      </a>
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </article>
  `,
})
export class RecordList {
  protected readonly router = inject(Router, { optional: true });

  readonly widget = input.required<RecordListWidget>();
  readonly data = input<Record<string, unknown>[] | null>(null);

  protected readonly rows = computed<Record<string, unknown>[]>(() => {
    const val = this.data();
    if (!Array.isArray(val)) return [];
    return val.filter(
      (item): item is Record<string, unknown> => typeof item === 'object' && item !== null,
    );
  });

  protected formatHeader(key: string): string {
    return key.replace(/_/g, ' ');
  }

  protected formatCell(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  protected trackRow(row: Record<string, unknown>, index: number): string | number {
    return (row['id'] as string) || (row['ref'] as string) || (row['key'] as string) || index;
  }

  protected resolveRoute(row: Record<string, unknown>): {
    path: string;
    queryParams: Record<string, string>;
  } {
    const template = this.widget().action?.routeTemplate;
    if (!template) return { path: '', queryParams: {} };
    return parseNavigationUrl(interpolateTemplate(template, row));
  }
}
