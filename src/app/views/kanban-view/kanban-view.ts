import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import type {
  KanbanViewConfig,
  ResourceSchema,
  SelectionBinding,
} from '../../core/models/schema.model';
import { ErrorMapperService } from '../../core/services/error-mapper.service';
import { DataSourceService, type SourceRow } from '../../core/services/data-source.service';
import type { SelectionEmitter } from '../composer/view-context';
import { getSchema } from '../../schemas/registry';
import { Button } from '../../shared/components/button/button';
import { EmptyState } from '../../shared/components/empty-state/empty-state';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import {
  cardSubtitle,
  cardTitle,
  mapKanbanRows,
  type KanbanColumnBucket,
  type KanbanMapping,
} from './kanban-model';

/**
 * Narrowing helper: `UiViewBase` keeps `type: string` open, so comparing
 * `view.type === 'kanban'` alone does not remove the base member from the
 * union. Requiring `config` in the value is what actually proves the view is
 * a `UiViewKanban` at runtime.
 */
function kanbanConfigOf(view: unknown): KanbanViewConfig | undefined {
  if (!view || typeof view !== 'object') return undefined;
  const candidate = view as { type?: unknown; config?: unknown };
  return candidate.type === 'kanban' && candidate.config !== undefined
    ? (candidate.config as KanbanViewConfig)
    : undefined;
}

type Status = 'loading' | 'ready' | 'error';

/** Label of the bucket for rows without a group value (Spanish UI copy). */
const UNKNOWN_LABEL = 'Sin valor';

/**
 * Synthetic `value` of that bucket: a real group value can never collide
 * with it (a declared `value` is non-empty and the grouping never produces
 * this literal), so `@for` tracking stays unique.
 */
const UNKNOWN_VALUE = '__sin_valor__';

/**
 * Generic kanban view (R9.8.4): rows of the declared
 * `KanbanViewConfig.source` (or the resource's own listing) grouped by
 * `groupField` into the declared columns, client-side.
 *
 * Data flow: ONE fetcher (`DataSourceService.rows`) — there is no dynamic
 * context here, so `ctx` is `undefined`; the 30 s cache of the service is
 * what keeps repeated visits free.
 *
 * Read-only by design (R9.8.1): no drag-and-drop, no move buttons, no
 * mutation path at all. Colour never carries meaning alone — every count is
 * text — and an empty column is a visible «Sin tarjetas», never a gap.
 */
@Component({
  selector: 'app-kanban-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, EmptyState, Skeleton],
  template: `
    @if (config(); as cfg) {
      <section class="space-y-4" aria-label="Tablero" [attr.aria-busy]="status() === 'loading'">
        <header class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="font-display text-xl font-semibold">Tablero</h2>
          <p class="text-sm text-neutral">
            Agrupado por <code>{{ cfg.groupField }}</code>
          </p>
        </header>

        @switch (status()) {
          @case ('loading') {
            <app-skeleton [lines]="6" [height]="32" />
          }
          @case ('error') {
            <app-empty-state title="No se pudo cargar el tablero" [message]="errorMessage()">
              <button app-button variant="outline" type="button" (click)="retry()">
                Reintentar
              </button>
            </app-empty-state>
          }
          @case ('ready') {
            <div class="flex gap-3 overflow-x-auto pb-2">
              @for (column of columns(); track column.value) {
                <section
                  class="flex w-64 shrink-0 flex-col gap-3 rounded-xl border border-neutral/20 bg-surface p-3"
                  [attr.data-column]="column.value"
                  [attr.aria-label]="columnAria(column)"
                >
                  <header class="flex items-center justify-between gap-2">
                    <h3 class="text-sm font-semibold">{{ column.label }}</h3>
                    <span class="rounded-full bg-neutral/10 px-2 py-0.5 text-xs text-neutral">
                      {{ column.rows.length }}<span class="sr-only"> tarjetas</span>
                    </span>
                  </header>
                  @if (column.rows.length === 0) {
                    <p class="text-sm text-neutral">Sin tarjetas</p>
                  } @else {
                    <ul class="flex flex-col gap-2">
                      @for (row of column.rows; track $index) {
                        <li
                          class="rounded-lg border border-neutral/15 p-2"
                          [attr.tabindex]="seleccionable() ? '0' : null"
                          [attr.role]="seleccionable() ? 'button' : null"
                          [class.cursor-pointer]="seleccionable()"
                          [class.ring-2]="esSeleccionada(row)"
                          [attr.data-selectable]="seleccionable() ? 'true' : null"
                          (click)="seleccionar(row)"
                          (keydown.enter)="activar($event, row)"
                          (keydown.space)="activar($event, row)"
                        >
                          <p class="text-sm font-medium">{{ cardTitleOf(row) }}</p>
                          @if (cardSubtitleOf(row); as subtitle) {
                            <p class="mt-0.5 text-xs text-neutral">{{ subtitle }}</p>
                          }
                        </li>
                      }
                    </ul>
                  }
                </section>
              }
            </div>
          }
        }
      </section>
    } @else {
      <app-empty-state
        title="Configuración inválida"
        message="Esta vista no declara una configuración de kanban válida."
      />
    }
  `,
})
export class KanbanView {
  private readonly route = inject(ActivatedRoute);
  // The shell mounts views via `loadComponent` (no input bindings), so the
  // schema is resolved from route data exactly like CalendarView does.
  private readonly routeData = toSignal(this.route.data, { requireSync: true });
  private readonly dataSource = inject(DataSourceService);
  private readonly errorMapper = inject(ErrorMapperService);

  /**
   * Resource schema for this view. The shell mounts views via
   * `loadComponent` (no input bindings), so the schema is resolved from
   * route data: either an explicit `schema` object (fixtures), or a
   * `resourceId` looked up in the registry (the production route shape).
   */
  readonly schema = computed<ResourceSchema | undefined>(() => {
    const data = this.routeData();
    const explicit = data['schema'];
    if (explicit !== undefined) return explicit as ResourceSchema;
    const resourceId = data['resourceId'];
    return typeof resourceId === 'string' ? getSchema(resourceId) : undefined;
  });

  /**
   * Config resolved from `schema.uiViews[<route uiView>]`; `undefined` when
   * the route does not name a kanban view with a usable config — the
   * template then renders the invalid-config empty state and NOTHING is
   * fetched (the effect below bails out on `undefined`).
   */
  readonly config = computed<KanbanViewConfig | undefined>(() => {
    const schema = this.schema();
    const viewName = this.routeData()['uiView'];
    if (schema === undefined || typeof viewName !== 'string') return undefined;
    const cfg = kanbanConfigOf(schema.uiViews?.[viewName]);
    if (cfg === undefined) return undefined;
    // Usable = the two references the board cannot render without: a
    // non-empty `groupField` and at least one column with a non-empty value.
    const usable =
      typeof cfg.groupField === 'string' &&
      cfg.groupField !== '' &&
      Array.isArray(cfg.columns) &&
      cfg.columns.length > 0 &&
      cfg.columns.every((column) => typeof column?.value === 'string' && column.value !== '');
    return usable ? cfg : undefined;
  });

  readonly status = signal<Status>('loading');
  readonly rows = signal<SourceRow[]>([]);
  readonly errorMessage = signal('');
  /** Clave seleccionada localmente cuando el binding declara `mode:'inline'`. */
  readonly seleccionada = signal<string | null>(null);

  /** Guards against a slow response overwriting a newer load's rows. */
  private loadEpoch = 0;

  constructor() {
    effect(() => {
      const cfg = this.config();
      if (cfg === undefined) return;
      void this.load(cfg);
    });
  }

  /** Rows grouped onto columns + the visible `unknown` bucket (pure model). */
  readonly mapping = computed<KanbanMapping>(() => {
    const cfg = this.config();
    const schema = this.schema();
    if (cfg === undefined || schema === undefined) return { columns: [], unknown: [] };
    return mapKanbanRows(this.rows(), cfg);
  });

  /**
   * Columns to paint: the model's buckets plus the `unknown` bucket at the
   * END — but only when it actually has rows, otherwise the board would show
   * an empty column nobody declared.
   */
  readonly columns = computed<readonly KanbanColumnBucket[]>(() => {
    const { columns, unknown } = this.mapping();
    if (unknown.length === 0) return columns;
    return [...columns, { value: UNKNOWN_VALUE, label: UNKNOWN_LABEL, rows: unknown }];
  });

  retry(): void {
    const cfg = this.config();
    if (cfg !== undefined) void this.load(cfg);
  }

  /** Clave estable de la fila (mismo campo que el resto del motor). */
  private keyOf(row: SourceRow): string {
    const schema = this.schema();
    const key = schema ? row[schema.keyField] : undefined;
    return key === undefined || key === null ? '' : String(key);
  }

  /** Binding `select` declarado por la vista (R9.9.4 · decision table). */
  private binding(): SelectionBinding | undefined {
    return this.routeData()['select'] as SelectionBinding | undefined;
  }

  /**
   * Clic de tarjeta. Sin declaración ⇒ inerte (el tablero no navegaba);
   * con declaración ⇒ sólo el contrato declarado corre: `route` emite al
   * dispatcher, `inline` selecciona en local, `none` es no-op explícito.
   */
  /**
   * R9.8.7 — la misma selección que el clic, operable con teclado (Enter y
   * Space sobre la tarjeta focusable). Sólo tiene sentido con `select`
   * declarado: sin binding la tarjeta no es focusable y esto nunca corre.
   */
  activar(event: Event, row: SourceRow): void {
    if (!this.seleccionable()) return;
    event.preventDefault(); // Space no debe desplazar la página
    this.seleccionar(row);
  }

  seleccionar(row: SourceRow): void {
    const binding = this.binding();
    if (binding === undefined) return;
    if (binding.mode === 'inline') {
      this.seleccionada.set(this.keyOf(row));
      return;
    }
    if (binding.mode === 'none') return;
    const schema = this.schema();
    const emit = this.routeData()['emit'] as SelectionEmitter | undefined;
    emit?.({
      resource: schema?.id ?? String(this.routeData()['resourceId'] ?? ''),
      key: this.keyOf(row),
      action: binding.on,
    });
  }

  /** El DOM declara clicable sólo si hay contrato que responder. */
  seleccionable(): boolean {
    const binding = this.binding();
    return binding !== undefined && binding.mode !== 'none';
  }

  esSeleccionada(row: SourceRow): boolean {
    return this.seleccionable() && this.seleccionada() === this.keyOf(row);
  }

  /** «Por hacer: 2 tarjetas» — the count is text, never colour alone. */
  columnAria(column: KanbanColumnBucket): string {
    const count = column.rows.length;
    return `${column.label}: ${count} ${count === 1 ? 'tarjeta' : 'tarjetas'}`;
  }

  cardTitleOf(row: SourceRow): string {
    const cfg = this.config();
    const schema = this.schema();
    if (cfg === undefined || schema === undefined) return '';
    return cardTitle(row, cfg, schema);
  }

  cardSubtitleOf(row: SourceRow): string {
    const cfg = this.config();
    const schema = this.schema();
    if (cfg === undefined || schema === undefined) return '';
    return cardSubtitle(row, cfg, schema);
  }

  private async load(cfg: KanbanViewConfig): Promise<void> {
    const schema = this.schema();
    if (schema === undefined) return;
    const epoch = ++this.loadEpoch;
    this.status.set('loading');
    const source = cfg.source ?? { resource: schema.id };
    try {
      const rows = await this.dataSource.rows(source, undefined);
      if (epoch !== this.loadEpoch) return;
      this.rows.set(rows);
      this.errorMessage.set('');
      this.status.set('ready');
    } catch (error) {
      if (epoch !== this.loadEpoch) return;
      this.errorMessage.set(this.errorMapper.map(error).general ?? 'No se pudo cargar el tablero.');
      this.status.set('error');
    }
  }
}
