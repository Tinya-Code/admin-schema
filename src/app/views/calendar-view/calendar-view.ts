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
import { LucideChevronLeft, LucideChevronRight } from '@lucide/angular';

import type {
  CalendarViewConfig,
  ResourceSchema,
  UiViewCalendar,
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
  agendaDayLabel,
  type CalendarMapping,
  type CalendarMode,
  type CalEvent,
  type CivilRange,
  daysInRange,
  eventsByDay,
  findFieldByKey,
  mapCalendarRows,
  monthGridDays,
  rangeLabelFor,
  REASON_END_BEFORE_START,
  REASON_UNDATED,
  sameMonth,
  shiftCursor,
  todayCivil,
  visibleRangeFor,
  weekDays,
  WEEKDAY_HEADINGS,
  weekdayShort,
} from './calendar-model';

/**
 * Narrowing helper: `UiViewBase` keeps `type: string` open, so comparing
 * `view.type === 'calendar'` alone does not remove the base member from the
 * union. Requiring `config` in the value is what actually proves the view is
 * a `UiViewCalendar` at runtime.
 */
function calendarConfigOf(view: unknown): UiViewCalendar['config'] | undefined {
  if (!view || typeof view !== 'object') return undefined;
  const candidate = view as { type?: unknown; config?: unknown };
  return candidate.type === 'calendar' && candidate.config !== undefined
    ? (candidate.config as UiViewCalendar['config'])
    : undefined;
}

type Status = 'loading' | 'ready' | 'error';

/** Mode switcher, in display order (Spanish UI copy). */
const MODE_OPTIONS: readonly { mode: CalendarMode; label: string }[] = [
  { mode: 'month', label: 'Mes' },
  { mode: 'week', label: 'Semana' },
  { mode: 'day', label: 'Día' },
  { mode: 'agenda', label: 'Agenda' },
];

/** Stable empty bucket — avoids allocating a new array per day per cycle. */
const NO_EVENTS: readonly CalEvent[] = [];

/**
 * Generic calendar view (R9.8.3): month / week / day / agenda over the rows
 * of the declared `CalendarViewConfig.source` (or the resource's own
 * listing), positioned client-side onto civil days.
 *
 * Data flow: ONE fetcher (`DataSourceService.rows`) per visible range. When
 * the schema declares `source.view` the visible `desde`/`hasta` travel as
 * `ctx` so the backend view can filter the range; without a view nothing
 * filters, the full listing is cached (30 s TTL) and reused while the user
 * navigates — both paths share this component, only the `ctx` differs.
 *
 * Read-only by design: no drag, no click-to-edit. Color never carries
 * meaning alone — every event pairs its color dot with the title text — and
 * the agenda mode is the no-grid fallback for small screens.
 */
@Component({
  selector: 'app-calendar-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, EmptyState, LucideChevronLeft, LucideChevronRight, Skeleton],
  template: `
    @if (config(); as cfg) {
      <section class="space-y-4" aria-label="Calendario" [attr.aria-busy]="status() === 'loading'">
        <header class="flex flex-wrap items-center justify-between gap-3">
          <h2 class="font-display text-xl font-semibold">{{ rangeLabel() }}</h2>
          <div class="flex items-center gap-1">
            <button
              app-button
              variant="outline"
              size="icon"
              type="button"
              aria-label="Período anterior"
              title="Período anterior"
              (click)="previous()"
            >
              <svg lucideChevronLeft size="16" aria-hidden="true" />
            </button>
            <button app-button variant="outline" size="sm" type="button" (click)="today()">
              Hoy
            </button>
            <button
              app-button
              variant="outline"
              size="icon"
              type="button"
              aria-label="Período siguiente"
              title="Período siguiente"
              (click)="next()"
            >
              <svg lucideChevronRight size="16" aria-hidden="true" />
            </button>
          </div>
          <div class="flex items-center gap-1" role="group" aria-label="Vista del calendario">
            @for (option of modeOptions; track option.mode) {
              <button
                app-button
                variant="ghost"
                size="sm"
                type="button"
                [attr.aria-pressed]="mode() === option.mode"
                (click)="setMode(option.mode)"
              >
                {{ option.label }}
              </button>
            }
          </div>
        </header>

        @switch (status()) {
          @case ('loading') {
            <app-skeleton [lines]="8" [height]="32" />
          }
          @case ('error') {
            <app-empty-state title="No se pudo cargar el calendario" [message]="errorMessage()">
              <button app-button variant="outline" type="button" (click)="retry()">
                Reintentar
              </button>
            </app-empty-state>
          }
          @case ('ready') {
            @if (mapping().events.length === 0) {
              <app-empty-state
                title="Sin eventos"
                message="No hay eventos con fecha válida en este período."
              />
            } @else {
              @switch (mode()) {
                @case ('month') {
                  <div class="overflow-x-auto rounded-xl border border-neutral/20 bg-surface">
                    <div class="grid min-w-[640px] grid-cols-7">
                      @for (heading of weekdayHeadings; track heading) {
                        <div
                          class="border-b border-neutral/15 px-2 py-1.5 text-xs font-medium uppercase text-neutral"
                        >
                          {{ heading }}
                        </div>
                      }
                      @for (day of monthGrid(); track day) {
                        <div
                          class="min-h-24 border-b border-r border-neutral/10 p-1.5"
                          [attr.data-day]="day"
                          [class.opacity-40]="!isInCursorMonth(day)"
                        >
                          <span class="text-xs font-medium">{{ dayNumber(day) }}</span>
                          <ul class="mt-1 space-y-0.5">
                            @for (event of eventsFor(day); track event.key) {
                              <li
                                class="flex items-center gap-1 text-xs"
                                [class.cursor-pointer]="seleccionable()"
                                [class.ring-2]="esSeleccionada(event)"
                                [attr.data-event-key]="event.key"
                                [attr.data-selectable]="seleccionable() ? 'true' : null"
                                (click)="seleccionar(event)"
                              >
                                <span
                                  class="size-2 shrink-0 rounded-full bg-neutral/30"
                                  [style.background-color]="event.color ?? null"
                                  aria-hidden="true"
                                ></span>
                                <span class="truncate">{{ event.title }}</span>
                              </li>
                            }
                          </ul>
                        </div>
                      }
                    </div>
                  </div>
                }
                @case ('week') {
                  <div class="overflow-x-auto rounded-xl border border-neutral/20 bg-surface">
                    <div class="grid min-w-[560px] grid-cols-7">
                      @for (day of weekColumnDays(); track day) {
                        <div class="min-h-32 border-r border-neutral/10 p-2" [attr.data-day]="day">
                          <span class="text-xs font-medium uppercase text-neutral">
                            {{ weekdayShort(day) }} {{ dayNumber(day) }}
                          </span>
                          <ul class="mt-2 space-y-1">
                            @for (event of eventsFor(day); track event.key) {
                              <li
                                class="flex items-center gap-1.5 text-sm"
                                [class.cursor-pointer]="seleccionable()"
                                [class.ring-2]="esSeleccionada(event)"
                                [attr.data-event-key]="event.key"
                                [attr.data-selectable]="seleccionable() ? 'true' : null"
                                (click)="seleccionar(event)"
                              >
                                <span
                                  class="size-2 shrink-0 rounded-full bg-neutral/30"
                                  [style.background-color]="event.color ?? null"
                                  aria-hidden="true"
                                ></span>
                                <span class="truncate">{{ event.title }}</span>
                              </li>
                            }
                          </ul>
                        </div>
                      }
                    </div>
                  </div>
                }
                @case ('day') {
                  <div
                    class="rounded-xl border border-neutral/20 bg-surface p-4"
                    [attr.data-day]="cursor()"
                  >
                    <h3 class="font-display text-base font-semibold">
                      {{ dayHeading(cursor()) }}
                    </h3>
                    @if (eventsFor(cursor()).length === 0) {
                      <p class="mt-2 text-sm text-neutral">Sin eventos este día.</p>
                    } @else {
                      <ul class="mt-3 space-y-2">
                        @for (event of eventsFor(cursor()); track event.key) {
                          <li
                            class="flex items-center gap-1 text-xs"
                            [class.cursor-pointer]="seleccionable()"
                            [class.ring-2]="esSeleccionada(event)"
                            [attr.data-event-key]="event.key"
                            [attr.data-selectable]="seleccionable() ? 'true' : null"
                            (click)="seleccionar(event)"
                          >
                            <span
                              class="size-2.5 shrink-0 rounded-full bg-neutral/30"
                              [style.background-color]="event.color ?? null"
                              aria-hidden="true"
                            ></span>
                            <span>{{ event.title }}</span>
                          </li>
                        }
                      </ul>
                    }
                  </div>
                }
                @case ('agenda') {
                  <ol class="space-y-4">
                    @for (day of agendaDays(); track day) {
                      <li class="rounded-xl border border-neutral/20 bg-surface p-4">
                        <h3 class="text-sm font-semibold">{{ dayHeading(day) }}</h3>
                        <ul class="mt-2 space-y-1">
                          @for (event of eventsFor(day); track event.key) {
                            <li
                              class="flex items-center gap-2 text-sm"
                              [class.cursor-pointer]="seleccionable()"
                              [class.ring-2]="esSeleccionada(event)"
                              [attr.data-event-key]="event.key"
                              [attr.data-selectable]="seleccionable() ? 'true' : null"
                              (click)="seleccionar(event)"
                            >
                              <span
                                class="size-2 shrink-0 rounded-full bg-neutral/30"
                                [style.background-color]="event.color ?? null"
                                aria-hidden="true"
                              ></span>
                              <span>{{ event.title }}</span>
                            </li>
                          }
                        </ul>
                      </li>
                    }
                  </ol>
                }
              }
            }

            <!-- Problem records are VISIBLE, never silently dropped: a row
                 without a valid start or with an impossible interval cannot
                 be painted, but the operator must see why. -->
            @if (hasProblemRecords()) {
              <section
                class="rounded-xl border border-neutral/30 p-4"
                aria-label="Registros sin fecha válida"
              >
                <h3 class="font-display text-sm font-semibold">Registros sin fecha válida</h3>
                <p class="mt-1 text-help text-neutral">
                  Estos registros no se pueden pintar en el calendario:
                </p>
                <ul class="mt-2 space-y-1 text-sm">
                  @for (row of mapping().undated; track $index) {
                    <li>{{ recordLabel(row) }} — {{ reasonUndated }}</li>
                  }
                  @for (item of mapping().invalid; track $index) {
                    <li>{{ recordLabel(item.row) }} — {{ item.reason }}</li>
                  }
                </ul>
              </section>
            }
          }
        }
      </section>
    } @else {
      <app-empty-state
        title="Configuración inválida"
        message="Esta vista no declara una configuración de calendario válida."
      />
    }
  `,
})
export class CalendarView {
  private readonly route = inject(ActivatedRoute);
  // The shell mounts views via `loadComponent` (no input bindings), so the
  // schema is resolved from route data exactly like FormView does.
  private readonly routeData = toSignal(this.route.data, { requireSync: true });
  private readonly dataSource = inject(DataSourceService);
  private readonly errorMapper = inject(ErrorMapperService);

  /**
   * Resource schema for this view. The shell mounts views via
   * `loadComponent` (no input bindings), so the schema is resolved from
   * route data: either an explicit `schema` object, or a `resourceId` looked
   * up in the registry (same route shape FormView uses).
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
   * the route does not name a calendar view with a usable config — the
   * template then renders the invalid-config empty state instead of a grid.
   */
  readonly config = computed<CalendarViewConfig | undefined>(() => {
    const schema = this.schema();
    const viewName = this.routeData()['uiView'];
    if (schema === undefined || typeof viewName !== 'string') return undefined;
    const cfg = calendarConfigOf(schema.uiViews?.[viewName]);
    if (cfg === undefined) return undefined;
    const usable =
      typeof cfg.startField === 'string' &&
      cfg.startField !== '' &&
      typeof cfg.titleField === 'string' &&
      cfg.titleField !== '';
    return usable ? cfg : undefined;
  });

  /** Explicit user choice; `undefined` ⇒ the config's `defaultView`. */
  private readonly explicitMode = signal<CalendarMode | undefined>(undefined);

  readonly mode = computed<CalendarMode>(
    () => this.explicitMode() ?? this.config()?.defaultView ?? 'month',
  );

  /** Anchor civil day of the visible range; init = today (civil). */
  readonly cursor = signal<string>(todayCivil());

  /** Visible `{desde, hasta}` derived from cursor + mode. */
  readonly visibleRange = computed<CivilRange | null>(() =>
    this.config() === undefined ? null : visibleRangeFor(this.mode(), this.cursor()),
  );

  readonly rangeLabel = computed(() =>
    this.config() === undefined ? '' : rangeLabelFor(this.mode(), this.cursor()),
  );

  readonly status = signal<Status>('loading');
  readonly rows = signal<SourceRow[]>([]);
  /** Clave seleccionada localmente cuando el binding declara `mode:'inline'`. */
  readonly seleccionada = signal<string | null>(null);
  readonly errorMessage = signal('');

  readonly modeOptions = MODE_OPTIONS;
  readonly weekdayHeadings = WEEKDAY_HEADINGS;
  readonly reasonUndated = REASON_UNDATED;

  /** Guards against a slow response overwriting a newer range's rows. */
  private loadEpoch = 0;

  constructor() {
    effect(() => {
      const cfg = this.config();
      const range = this.visibleRange();
      if (cfg === undefined || range === null) return;
      void this.load(cfg, range);
    });
  }

  /** Rows mapped to events + visible problem records (pure model). */
  readonly mapping = computed<CalendarMapping>(() => {
    const cfg = this.config();
    const schema = this.schema();
    if (cfg === undefined || schema === undefined) return { events: [], undated: [], invalid: [] };
    const endFieldType =
      cfg.endField !== undefined ? findFieldByKey(schema.fields, cfg.endField)?.type : undefined;
    return mapCalendarRows(this.rows(), cfg, {
      keyField: schema.keyField,
      endFieldType,
    });
  });

  /** Events bucketed per civil day, clamped to the visible range. */
  readonly eventsByDay = computed(() => {
    const range = this.visibleRange();
    if (range === null) return new Map<string, CalEvent[]>();
    return eventsByDay(this.mapping().events, range);
  });

  readonly monthGrid = computed(() => monthGridDays(this.cursor()));
  readonly weekColumnDays = computed(() => weekDays(this.cursor()));

  /** Agenda headings: the days of the range that actually have events. */
  readonly agendaDays = computed(() => {
    const range = this.visibleRange();
    if (range === null) return [] as string[];
    return daysInRange(range).filter((day) => this.eventsByDay().has(day));
  });

  readonly hasProblemRecords = computed(
    () => this.mapping().undated.length > 0 || this.mapping().invalid.length > 0,
  );

  previous(): void {
    this.cursor.set(shiftCursor(this.mode(), this.cursor(), -1));
  }

  next(): void {
    this.cursor.set(shiftCursor(this.mode(), this.cursor(), 1));
  }

  /** Reset the cursor to today (civil). */
  today(): void {
    this.cursor.set(todayCivil());
  }

  setMode(mode: CalendarMode): void {
    this.explicitMode.set(mode);
  }

  retry(): void {
    const cfg = this.config();
    const range = this.visibleRange();
    if (cfg !== undefined && range !== null) void this.load(cfg, range);
  }

  /** Binding `select` declarado por la vista (R9.9.4 · decision table). */
  private binding(): SelectionBinding | undefined {
    return this.routeData()['select'] as SelectionBinding | undefined;
  }

  /**
   * Clic de evento. Sin declaración ⇒ inerte (el calendario no navegaba);
   * con declaración ⇒ sólo el contrato declarado corre: `route` emite al
   * dispatcher, `inline` selecciona en local, `none` es no-op explícito.
   */
  seleccionar(event: CalEvent): void {
    const binding = this.binding();
    if (binding === undefined) return;
    if (binding.mode === 'inline') {
      this.seleccionada.set(event.key);
      return;
    }
    if (binding.mode === 'none') return;
    const schema = this.schema();
    const emit = this.routeData()['emit'] as SelectionEmitter | undefined;
    emit?.({
      resource: schema?.id ?? String(this.routeData()['resourceId'] ?? ''),
      key: event.key,
      action: binding.on,
    });
  }

  /** El DOM declara clicable sólo si hay contrato que responder. */
  seleccionable(): boolean {
    const binding = this.binding();
    return binding !== undefined && binding.mode !== 'none';
  }

  esSeleccionada(event: CalEvent): boolean {
    return this.seleccionable() && this.seleccionada() === event.key;
  }

  eventsFor(day: string): readonly CalEvent[] {
    return this.eventsByDay().get(day) ?? NO_EVENTS;
  }

  dayNumber(day: string): number {
    return Number(day.slice(8, 10));
  }

  isInCursorMonth(day: string): boolean {
    return sameMonth(day, this.cursor());
  }

  /** Weekday + number ("lun 12") for week columns. */
  weekdayShort(day: string): string {
    return weekdayShort(day);
  }

  /** Full heading ("lunes, 12 de octubre de 2026") for day/agenda. */
  dayHeading(day: string): string {
    return agendaDayLabel(day);
  }

  recordLabel(row: SourceRow): string {
    const schema = this.schema();
    if (schema === undefined) return '';
    const title = String(row[schema.titleField] ?? '').trim();
    return title !== '' ? title : String(row[schema.keyField] ?? '');
  }

  private async load(cfg: CalendarViewConfig, range: CivilRange): Promise<void> {
    const schema = this.schema();
    if (schema === undefined) return;
    const epoch = ++this.loadEpoch;
    this.status.set('loading');
    // Optimization branch (decided): range ctx ONLY when the schema declares
    // a backend view — that's the signal that a `where` may filter on
    // `param: 'desde'`/`'hasta'`. Without a view the params would be ignored
    // (and the full listing is cached while the user navigates).
    const ctx =
      cfg.source?.view !== undefined && cfg.source.view !== ''
        ? { desde: range.desde, hasta: range.hasta }
        : undefined;
    const source = cfg.source ?? { resource: schema.id };
    try {
      const rows = await this.dataSource.rows(source, ctx);
      if (epoch !== this.loadEpoch) return;
      this.rows.set(rows);
      this.errorMessage.set('');
      this.status.set('ready');
    } catch (error) {
      if (epoch !== this.loadEpoch) return;
      this.errorMessage.set(
        this.errorMapper.map(error).general ?? 'No se pudo cargar el calendario.',
      );
      this.status.set('error');
    }
  }
}
