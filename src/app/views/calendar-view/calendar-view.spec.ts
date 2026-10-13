import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../core/models/api.model';
import type {
  CalendarViewConfig,
  ResourceSchema,
  SelectionBinding,
} from '../../core/models/schema.model';
import { DataSourceService, type SourceRow } from '../../core/services/data-source.service';
import {
  agendaDayLabel,
  daysInRange,
  eventsByDay,
  formatDay,
  mapCalendarRows,
  monthGridDays,
  parseDay,
  rangeLabelFor,
  REASON_END_BEFORE_START,
  REASON_INVALID_END,
  REASON_UNDATED,
  shiftCursor,
  shiftMonths,
  todayCivil,
  visibleRangeFor,
  weekDays,
} from './calendar-model';
import { CalendarView } from './calendar-view';

/**
 * R9.8.3 — generic `CalendarView`.
 *
 * The pure model (civil-day math, row→event mapping) is tested directly;
 * the component is tested against a stubbed `DataSourceService` + a stubbed
 * `ActivatedRoute.data` carrying `uiView` (the same pattern as
 * `resource-page.spec.ts`).
 */

// Deterministic fixtures — 2026-10-12 is a MONDAY and 2026-10-01 a
// Thursday, so the October grid starts Monday 2026-09-28 (42-day window
// ending 2026-11-08).
const MONDAY = '2026-10-12';
const MONTH_GRID_START = '2026-09-28';
const MONTH_GRID_END = '2026-11-08';

const BASE_CONFIG: CalendarViewConfig = {
  startField: 'start',
  endField: 'end',
  titleField: 'name',
  colorField: 'status',
  defaultView: 'month',
};

function calendarSchema(config: CalendarViewConfig | null = BASE_CONFIG): ResourceSchema {
  return {
    id: 'cal_events',
    label: 'Evento',
    labelPlural: 'Eventos',
    kind: 'collection',
    endpoint: { list: '/admin/cal_events' },
    keyField: 'slug',
    titleField: 'name',
    listColumns: [],
    fields: [
      { type: 'text', key: 'slug', label: 'Slug' },
      { type: 'text', key: 'name', label: 'Nombre' },
      { type: 'date', key: 'start', label: 'Inicio' },
      { type: 'date', key: 'end', label: 'Fin' },
      { type: 'time', key: 'end_hour', label: 'Hora de fin' },
      { type: 'select', key: 'status', label: 'Estado', options: [] },
    ],
    uiViews:
      config === null ? { agenda: { type: 'list' } } : { agenda: { type: 'calendar', config } },
  };
}

type RowsBehavior = SourceRow[] | 'pending' | 'reject';

interface Harness {
  fixture: ComponentFixture<CalendarView>;
  component: CalendarView;
  rowsMock: ReturnType<typeof vi.fn>;
  el: HTMLElement;
}

async function create(options: {
  rows?: RowsBehavior;
  config?: CalendarViewConfig | null;
  /** Route data override — selection contract travels here too. */
  data?: Record<string, unknown>;
}): Promise<Harness> {
  const rowsBehavior = options.rows ?? [];
  const rowsMock = vi.fn(() => {
    if (rowsBehavior === 'pending') return new Promise<SourceRow[]>(() => {});
    if (rowsBehavior === 'reject') {
      return Promise.reject(new ApiError(500, 'Fallo del servidor'));
    }
    return Promise.resolve(rowsBehavior);
  });

  const schema = calendarSchema(options.config === null ? null : (options.config ?? BASE_CONFIG));

  await TestBed.configureTestingModule({
    imports: [CalendarView],
    providers: [
      {
        // `uiView` names the view within `uiViews`; the schema travels by
        // route data because the shell mounts views with `loadComponent`
        // (no input bindings) and the schema registry is immutable.
        provide: ActivatedRoute,
        useValue: {
          data: of({ uiView: 'agenda', schema, ...(options.data ?? {}) }),
        },
      },
      { provide: DataSourceService, useValue: { rows: rowsMock } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(CalendarView);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, rowsMock, el: fixture.nativeElement };
}

/** Flush a cursor/mode change plus the load it triggers. */
async function settle(fixture: ComponentFixture<CalendarView>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

// ─────────────────────────────────────────────────────────────
// Pure model — civil-day parsing and ranges
// ─────────────────────────────────────────────────────────────

describe('calendar-model — civil days', () => {
  it('parsea YYYY-MM-DD como medianoche UTC (sin shift de zona horaria)', () => {
    expect(parseDay('2026-10-12')).toBe(Date.UTC(2026, 9, 12));
    expect(formatDay(Date.UTC(2026, 9, 12))).toBe('2026-10-12');
  });

  it('rechaza vacíos, basura y días inexistentes', () => {
    for (const bad of ['', '   ', null, undefined, 42, '2026-13-01', '2026-02-30', '12/10/2026']) {
      expect(parseDay(bad)).toBeNull();
    }
  });

  it('deriva el rango visible por modo conSemana lunes-primero', () => {
    // month = grilla de 6 semanas (lunes previo al día 1)
    expect(visibleRangeFor('month', '2026-10-15')).toEqual({
      desde: MONTH_GRID_START,
      hasta: MONTH_GRID_END,
    });
    // week: miércoles cae en la semana del lunes 12
    expect(visibleRangeFor('week', '2026-10-14')).toEqual({
      desde: '2026-10-12',
      hasta: '2026-10-18',
    });
    // el propio lunes abre su semana; el domingo la cierra
    expect(visibleRangeFor('week', MONDAY)).toEqual({ desde: '2026-10-12', hasta: '2026-10-18' });
    expect(visibleRangeFor('week', '2026-10-18')).toEqual({
      desde: '2026-10-12',
      hasta: '2026-10-18',
    });
    // day = el cursor; agenda = ventana fija de 30 días
    expect(visibleRangeFor('day', MONDAY)).toEqual({ desde: MONDAY, hasta: MONDAY });
    expect(visibleRangeFor('agenda', MONDAY)).toEqual({ desde: MONDAY, hasta: '2026-11-10' });
  });

  it('la grilla del mes tiene 42 días lunes-primero y contiene el día 1', () => {
    const grid = monthGridDays('2026-10-15');
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe(MONTH_GRID_START);
    expect(grid[41]).toBe(MONTH_GRID_END);
    expect(grid).toContain('2026-10-01');
    expect(parseDay(grid[0])! % (7 * 86_400_000)).toBe(Date.UTC(1970, 0, 5)); // lunes
  });

  it('la semana del cursor son 7 días lunes-primero', () => {
    expect(weekDays(MONDAY)).toHaveLength(7);
    expect(weekDays(MONDAY)[0]).toBe(MONDAY);
  });

  it('shiftMonths acota el día al largo del mes destino', () => {
    expect(formatDay(shiftMonths(Date.UTC(2026, 0, 31), 1))).toBe('2026-02-28');
  });

  it('shiftCursor avanza una unidad por modo (agenda: 30 días)', () => {
    expect(shiftCursor('day', MONDAY, 1)).toBe('2026-10-13');
    expect(shiftCursor('week', MONDAY, -1)).toBe('2026-10-05');
    expect(shiftCursor('month', MONDAY, 1)).toBe('2026-11-12');
    expect(shiftCursor('agenda', MONDAY, 1)).toBe('2026-11-11');
  });

  it('los rótulos se construyen con partes civiles', () => {
    expect(rangeLabelFor('month', '2026-10-15')).toBe('octubre de 2026');
    expect(rangeLabelFor('week', MONDAY)).toBe('12 oct – 18 oct 2026');
    expect(agendaDayLabel(MONDAY)).toContain('12 de octubre de 2026');
  });
});

// ─────────────────────────────────────────────────────────────
// Pure model — row → event mapping
// ─────────────────────────────────────────────────────────────

describe('calendar-model — mapCalendarRows', () => {
  it('mapea una fila válida a un evento con clave, título, color y span real', () => {
    const row: SourceRow = {
      slug: 'r1',
      name: 'Demo',
      start: '2026-10-10',
      end: '2026-10-12',
      status: 'confirmado',
    };
    const mapping = mapCalendarRows([row], BASE_CONFIG, { keyField: 'slug' });
    expect(mapping.undated).toHaveLength(0);
    expect(mapping.invalid).toHaveLength(0);
    expect(mapping.events).toHaveLength(1);
    expect(mapping.events[0]).toMatchObject({
      key: 'r1',
      title: 'Demo',
      startDay: '2026-10-10',
      endDay: '2026-10-12',
      color: 'confirmado',
    });
  });

  it('una fila sin inicio válido queda en «undated», nunca oculta', () => {
    const rows: SourceRow[] = [
      { slug: 'r2', name: 'Sin fecha', start: '' },
      { slug: 'r3', name: 'Basura', start: 'no-date' },
    ];
    const mapping = mapCalendarRows(rows, BASE_CONFIG, { keyField: 'slug' });
    expect(mapping.events).toHaveLength(0);
    expect(mapping.undated.map((row) => row['slug'])).toEqual(['r2', 'r3']);
    expect(REASON_UNDATED.length).toBeGreaterThan(0);
  });

  it('fin < inicio queda como intervalo inválido, no como evento', () => {
    const row: SourceRow = { slug: 'r4', name: 'Mal', start: '2026-10-12', end: '2026-10-10' };
    const mapping = mapCalendarRows([row], BASE_CONFIG, { keyField: 'slug' });
    expect(mapping.events).toHaveLength(0);
    expect(mapping.invalid).toHaveLength(1);
    expect(mapping.invalid[0].reason).toBe(REASON_END_BEFORE_START);
  });

  it('un endField de tipo time no span días (queda en el día de inicio)', () => {
    const timeConfig: CalendarViewConfig = { ...BASE_CONFIG, endField: 'end_hour' };
    const row: SourceRow = { slug: 'r5', name: 'Turno', start: '2026-10-12', end_hour: '18:30' };
    const mapping = mapCalendarRows([row], timeConfig, {
      keyField: 'slug',
      endFieldType: 'time',
    });
    expect(mapping.events[0].endDay).toBe('2026-10-12');
  });

  it('un endField date vacío es evento de un solo día', () => {
    const row: SourceRow = { slug: 'r6', name: 'Un día', start: '2026-10-12', end: '' };
    const mapping = mapCalendarRows([row], BASE_CONFIG, { keyField: 'slug' });
    expect(mapping.events[0].endDay).toBe('2026-10-12');
    expect(mapping.invalid).toHaveLength(0);
  });

  it('un fin ilegible queda como intervalo inválido con motivo visible', () => {
    const row: SourceRow = { slug: 'r9', name: 'Raro', start: '2026-10-12', end: 'fin?' };
    const mapping = mapCalendarRows([row], BASE_CONFIG, { keyField: 'slug' });
    expect(mapping.events).toHaveLength(0);
    expect(mapping.invalid[0].reason).toBe(REASON_INVALID_END);
  });

  it('pinta un intervalo multi-día en cada día que toca, acotado al rango', () => {
    const row: SourceRow = { slug: 'r7', name: 'Feriado', start: '2026-10-10', end: '2026-10-12' };
    const { events } = mapCalendarRows([row], BASE_CONFIG, { keyField: 'slug' });
    const byDay = eventsByDay(events, { desde: '2026-10-11', hasta: '2026-10-31' });
    // El día 10 queda fuera del rango: se acolcha el pintado, no el span real.
    expect([...byDay.keys()]).toEqual(['2026-10-11', '2026-10-12']);
    expect(events[0].startDay).toBe('2026-10-10');
    expect(daysInRange({ desde: '2026-10-11', hasta: '2026-10-13' })).toEqual([
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

describe('CalendarView', () => {
  it('pinta el evento en el día correcto de la grilla del mes', async () => {
    const { fixture, component, el } = await create({
      rows: [
        { slug: 'e1', name: 'Lanzamiento', start: '2026-10-15' },
        { slug: 'e2', name: 'Charla', start: '2026-10-05', end: '2026-10-07' },
      ],
    });
    component.cursor.set(MONDAY);
    await settle(fixture);

    const cell = (day: string): string =>
      el.querySelector(`[data-day="${day}"]`)?.textContent ?? '';
    expect(cell('2026-10-15')).toContain('Lanzamiento');
    expect(cell('2026-10-16')).not.toContain('Lanzamiento');
    // intervalo multi-día pintado en cada día que toca
    expect(cell('2026-10-05')).toContain('Charla');
    expect(cell('2026-10-06')).toContain('Charla');
    expect(cell('2026-10-07')).toContain('Charla');
    expect(cell('2026-10-08')).not.toContain('Charla');
    // días fuera del mes deprimidos visualmente
    expect(el.querySelector('[data-day="2026-09-28"]')?.className).toContain('opacity-40');
  });

  it('muestra el skeleton mientras la fuente no responde', async () => {
    const { el } = await create({ rows: 'pending' });
    expect(el.querySelector('app-skeleton')).not.toBeNull();
    expect(el.querySelector('section')?.getAttribute('aria-busy')).toBe('true');
  });

  it('pinta el estado de error con el mensaje mapeado', async () => {
    const { el } = await create({ rows: 'reject' });
    expect(el.querySelector('app-empty-state')?.textContent).toContain(
      'No se pudo cargar el calendario',
    );
    expect(el.textContent).toContain('Fallo del servidor');
  });

  it('pinta el estado vacío cuando no hay eventos válidos', async () => {
    const { el } = await create({ rows: [] });
    expect(el.textContent).toContain('Sin eventos');
  });

  it('muestra la sección visible de registros sin fecha válida', async () => {
    const { el } = await create({
      rows: [
        { slug: 'x1', name: 'Sin fecha', start: '' },
        { slug: 'x2', name: 'Mal rango', start: '2026-10-12', end: '2026-10-01' },
      ],
    });
    const section = el.querySelector('[aria-label="Registros sin fecha válida"]');
    expect(section).not.toBeNull();
    expect(el.textContent).toContain('Sin fecha');
    expect(el.textContent).toContain('Mal rango');
    expect(el.textContent).toContain(REASON_UNDATED);
    expect(el.textContent).toContain(REASON_END_BEFORE_START);
  });

  it('navega el rango visible con previous/next/today', async () => {
    const { fixture, component, el } = await create({ rows: [] });
    const label = (): string => el.querySelector('h2')?.textContent ?? '';

    component.cursor.set(MONDAY);
    await settle(fixture);
    expect(label()).toContain('octubre de 2026');

    component.next();
    await settle(fixture);
    expect(label()).toContain('noviembre de 2026');

    component.previous();
    component.previous();
    await settle(fixture);
    expect(label()).toContain('septiembre de 2026');

    component.today();
    await settle(fixture);
    expect(label()).toContain(rangeLabelFor('month', todayCivil()));
  });

  it('cambia la vista al elegir otro modo', async () => {
    const { fixture, component, el } = await create({
      rows: [{ slug: 'e1', name: 'Lanzamiento', start: '2026-10-15' }],
    });
    component.cursor.set(MONDAY);
    await settle(fixture);
    const label = (): string => el.querySelector('h2')?.textContent ?? '';
    const dayCells = (): number => el.querySelectorAll('[data-day]').length;

    expect(dayCells()).toBe(42); // mes: grilla de 6 semanas

    component.setMode('week');
    await settle(fixture);
    expect(dayCells()).toBe(7);
    expect(label()).toBe('12 oct – 18 oct 2026');

    // El evento cae el 15: para verlo en modo Día el cursor debe estar ahí.
    component.setMode('day');
    component.cursor.set('2026-10-15');
    await settle(fixture);
    expect(dayCells()).toBe(1);
    expect(el.textContent).toContain('Lanzamiento');

    component.setMode('agenda');
    await settle(fixture);
    expect(label()).toBe('15 oct – 13 nov 2026');
    // agenda agrupa por día con encabezado; sólo días con eventos
    const headings = [...el.querySelectorAll('ol li h3')].map((h) => h.textContent ?? '');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toContain('15 de octubre de 2026');
  });

  it('expone los botones accesibles de navegación y modo', async () => {
    const { el } = await create({ rows: [] });
    expect(el.querySelector('[aria-label="Período anterior"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Período siguiente"]')).not.toBeNull();
    const pressed = [...el.querySelectorAll('[aria-pressed]')].map((b) => ({
      label: b.textContent?.trim(),
      pressed: b.getAttribute('aria-pressed'),
    }));
    expect(pressed).toEqual([
      { label: 'Mes', pressed: 'true' },
      { label: 'Semana', pressed: 'false' },
      { label: 'Día', pressed: 'false' },
      { label: 'Agenda', pressed: 'false' },
    ]);
  });

  it('pinta la config inválida como estado vacío, sin pedir filas', async () => {
    const { el, rowsMock } = await create({ config: null });
    expect(el.textContent).toContain('Configuración inválida');
    expect(rowsMock).not.toHaveBeenCalled();
  });

  it('sin ningún schema en route data pinta «Configuración inválida», no el grid', async () => {
    // Regression the old spec missed: the shell mounts views via
    // `loadComponent` (no input bindings), so `input.required` never received
    // a schema in production. With neither `schema` nor `resourceId` in route
    // data there is nothing to resolve, and the only honest render is the
    // invalid-config empty state (no grid, no fetch).
    const rowsMock = vi.fn(() => Promise.resolve<SourceRow[]>([]));
    await TestBed.configureTestingModule({
      imports: [CalendarView],
      providers: [
        { provide: ActivatedRoute, useValue: { data: of({ uiView: 'agenda' }) } },
        { provide: DataSourceService, useValue: { rows: rowsMock } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CalendarView);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Configuración inválida');
    expect(rowsMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// Optimization branch — desde/hasta ctx
// ─────────────────────────────────────────────────────────────

describe('CalendarView — rango backend (desde/hasta)', () => {
  it('pasa desde/hasta como ctx cuando la fuente declara view', async () => {
    const { component, fixture, rowsMock } = await create({
      rows: [],
      config: {
        ...BASE_CONFIG,
        source: {
          resource: 'oth',
          view: 'por_rango',
          params: { desde: '{desde}', hasta: '{hasta}' },
        },
      },
    });
    component.cursor.set(MONDAY);
    await settle(fixture);
    expect(rowsMock).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'por_rango' }), {
      desde: MONTH_GRID_START,
      hasta: MONTH_GRID_END,
    });
  });

  it('no pasa ctx de rango cuando la fuente no declara view', async () => {
    const { component, fixture, rowsMock } = await create({
      rows: [],
      config: { ...BASE_CONFIG, source: { resource: 'oth' } },
    });
    component.cursor.set(MONDAY);
    await settle(fixture);
    expect(rowsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ resource: 'oth' }),
      undefined,
    );
  });

  it('pide el listado del propio recurso cuando no declara source', async () => {
    // With no `source`, the component falls back to the resource's own
    // listing. The schema travels by route data (fixture), so the fetch asks
    // for `{ resource: <schema.id> }` with no range ctx.
    const { rowsMock } = await create({ rows: [] });
    expect(rowsMock).toHaveBeenCalledWith({ resource: 'cal_events' }, undefined);
  });
});

// ─────────────────────────────────────────────────────────────
// R9.9.4 · decision table — the event is inert until a binding declares it
// ─────────────────────────────────────────────────────────────

describe('CalendarView — contrato de selección declarado (R9.9.4)', () => {
  const ROUTE: SelectionBinding = {
    on: 'open',
    mode: 'route',
    target: { resource: 'orders', view: 'detail', params: ['key'] },
  };
  const ROWS: SourceRow[] = [
    { slug: 'ev-1', name: 'Reunión', start: '2026-10-10', end: '2026-10-10' },
  ];

  function primerEvento(el: HTMLElement): HTMLElement | null {
    return el.querySelector('[data-day] li[data-event-key]') as HTMLElement | null;
  }

  it("mode:'route' ⇒ el evento emite con la acción declarada", async () => {
    const emit = vi.fn();
    const h = await create({ rows: ROWS, data: { select: ROUTE, emit } });

    const li = primerEvento(h.el);
    expect(li, 'el evento debe estar pintado en el grid del mes').not.toBeNull();
    li?.click();

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      resource: 'cal_events',
      key: 'ev-1',
      action: 'open',
    });
  });

  it("mode:'none' ⇒ el evento permanece inerte", async () => {
    const emit = vi.fn();
    const h = await create({
      rows: ROWS,
      data: { select: { on: 'open', mode: 'none' }, emit },
    });

    primerEvento(h.el)?.click();

    expect(emit).not.toHaveBeenCalled();
  });

  it('sin select declarado ⇒ el evento no emite nada (comportamiento actual)', async () => {
    const emit = vi.fn();
    const h = await create({ rows: ROWS, data: { emit } });

    primerEvento(h.el)?.click();

    expect(emit).not.toHaveBeenCalled();
    expect(
      h.el.querySelector('[data-day] li[data-event-key]')?.hasAttribute('data-selectable'),
    ).toBe(false);
  });
});
