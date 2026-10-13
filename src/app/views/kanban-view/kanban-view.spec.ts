import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../core/models/api.model';
import type {
  KanbanViewConfig,
  ResourceSchema,
  SelectionBinding,
} from '../../core/models/schema.model';
import { DataSourceService, type SourceRow } from '../../core/services/data-source.service';
import { CARD_NO_TITLE, cardSubtitle, cardTitle, mapKanbanRows } from './kanban-model';
import { KanbanView } from './kanban-view';

/**
 * R9.8.4 — generic `KanbanView`.
 *
 * The pure model (grouping, card title/subtitle) is tested directly; the
 * component is tested against a stubbed `DataSourceService` + a stubbed
 * `ActivatedRoute.data` carrying `uiView` and the schema — the exact harness
 * of `calendar-view.spec.ts`, because the shell mounts views via
 * `loadComponent` with NO input bindings.
 */

const BASE_CONFIG: KanbanViewConfig = {
  groupField: 'status',
  columns: [
    { value: 'todo', label: 'Por hacer' },
    { value: 'doing', label: 'En curso' },
    { value: 'done', label: 'Hecho' },
  ],
  titleField: 'name',
  subtitleField: 'owner',
};

function kanbanSchema(config: KanbanViewConfig | null = BASE_CONFIG): ResourceSchema {
  return {
    id: 'kanban_tasks',
    label: 'Tarea',
    labelPlural: 'Tareas',
    kind: 'collection',
    endpoint: { list: '/admin/kanban_tasks' },
    keyField: 'slug',
    titleField: 'name',
    listColumns: [],
    fields: [
      { type: 'text', key: 'slug', label: 'Slug' },
      { type: 'text', key: 'name', label: 'Nombre' },
      { type: 'text', key: 'owner', label: 'Responsable' },
      { type: 'select', key: 'status', label: 'Estado', options: [] },
    ],
    uiViews: config === null ? { board: { type: 'list' } } : { board: { type: 'kanban', config } },
  };
}

type RowsBehavior = SourceRow[] | 'pending' | 'reject';

interface Harness {
  fixture: ComponentFixture<KanbanView>;
  component: KanbanView;
  rowsMock: ReturnType<typeof vi.fn>;
  el: HTMLElement;
}

async function create(options: {
  rows?: RowsBehavior;
  /** Custom fetcher — lets a test resolve two loads out of order. */
  rowsImpl?: () => Promise<SourceRow[]>;
  config?: KanbanViewConfig | null;
  /** Route data override — the schema travels here, never as an input. */
  data?: Record<string, unknown>;
}): Promise<Harness> {
  const rowsBehavior = options.rows ?? [];
  const rowsMock = options.rowsImpl
    ? vi.fn(options.rowsImpl)
    : vi.fn(() => {
        if (rowsBehavior === 'pending') return new Promise<SourceRow[]>(() => {});
        if (rowsBehavior === 'reject') {
          return Promise.reject(new ApiError(500, 'Fallo del servidor'));
        }
        return Promise.resolve(rowsBehavior);
      });

  const data =
    options.data ??
    ({
      // `uiView` names the view within `uiViews`; the schema travels by route
      // data because the shell mounts views with `loadComponent` (no input
      // bindings) and the schema registry is immutable.
      uiView: 'board',
      schema: kanbanSchema(options.config === null ? null : (options.config ?? BASE_CONFIG)),
    } satisfies Record<string, unknown>);

  await TestBed.configureTestingModule({
    imports: [KanbanView],
    providers: [
      { provide: ActivatedRoute, useValue: { data: of(data) } },
      { provide: DataSourceService, useValue: { rows: rowsMock } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(KanbanView);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, rowsMock, el: fixture.nativeElement };
}

/** `value` of every painted column, in DOM order. */
function columnValues(el: HTMLElement): string[] {
  return [...el.querySelectorAll('[data-column]')].map(
    (node) => node.getAttribute('data-column') ?? '',
  );
}

/** Title of each card of a column, in order (first `p` of every card). */
function cardTitles(el: HTMLElement, value: string): string[] {
  return [...el.querySelectorAll(`[data-column="${value}"] li`)].map(
    (card) => card.querySelector('p')?.textContent?.trim() ?? '',
  );
}

// ─────────────────────────────────────────────────────────────
// Pure model — grouping
// ─────────────────────────────────────────────────────────────

describe('kanban-model — mapKanbanRows', () => {
  it('agrupa por groupField respetando el orden declarado y las columnas vacías', () => {
    const rows: SourceRow[] = [
      { slug: 't1', name: 'Deploy', status: 'done' },
      { slug: 't2', name: 'Diseño', status: 'todo' },
      { slug: 't3', name: 'QA', status: 'todo' },
    ];
    const { columns, unknown } = mapKanbanRows(rows, BASE_CONFIG, {});
    expect(unknown).toHaveLength(0);
    expect(columns.map((column) => column.value)).toEqual(['todo', 'doing', 'done']);
    expect(columns.map((column) => column.label)).toEqual(['Por hacer', 'En curso', 'Hecho']);
    // la columna declarada sin filas SIGUE ahí (vacía, no ausente)
    expect(columns[1].rows).toEqual([]);
    expect(columns[0].rows.map((row) => row['slug'])).toEqual(['t2', 't3']);
    expect(columns[2].rows.map((row) => row['slug'])).toEqual(['t1']);
  });

  it('un valor no declarado queda como columna propia, después de las declaradas', () => {
    const rows: SourceRow[] = [
      { slug: 't1', status: 'blocked' },
      { slug: 't2', status: 'todo' },
      { slug: 't3', status: 'blocked' },
    ];
    const { columns } = mapKanbanRows(rows, BASE_CONFIG, {});
    expect(columns.map((column) => column.value)).toEqual(['todo', 'doing', 'done', 'blocked']);
    // rótulo = el valor crudo: lo no declarado se VE, no se esconde
    expect(columns[3].label).toBe('blocked');
    expect(columns[3].rows.map((row) => row['slug'])).toEqual(['t1', 't3']);
    expect(columns.reduce((total, column) => total + column.rows.length, 0)).toBe(3);
  });

  it('un valor vacío o ausente va a «unknown», nunca se pierde', () => {
    const rows: SourceRow[] = [
      { slug: 't1', name: 'Sin estado', status: '' },
      { slug: 't2', name: 'Sin clave' },
      { slug: 't3', name: 'Nulo', status: null },
      { slug: 't4', name: 'Ok', status: 'todo' },
    ];
    const { columns, unknown } = mapKanbanRows(rows, BASE_CONFIG, {});
    expect(unknown.map((row) => row['slug'])).toEqual(['t1', 't2', 't3']);
    expect(unknown).toHaveLength(3);
    // ninguna fila queda fuera del recuento total
    const total = columns.reduce((sum, column) => sum + column.rows.length, 0) + unknown.length;
    expect(total).toBe(rows.length);
    expect(columns.map((column) => column.value)).toEqual(['todo', 'doing', 'done']);
  });

  it('es estable: el orden de inserción dentro de cada columna se conserva', () => {
    const rows: SourceRow[] = [
      { slug: 'a', status: 'todo' },
      { slug: 'b', status: 'todo' },
      { slug: 'c', status: 'todo' },
    ];
    const first = mapKanbanRows(rows, BASE_CONFIG, {});
    const second = mapKanbanRows(rows, BASE_CONFIG, {});
    expect(first.columns[0].rows.map((row) => row['slug'])).toEqual(['a', 'b', 'c']);
    expect(second.columns[0].rows.map((row) => row['slug'])).toEqual(['a', 'b', 'c']);
    // mismo input ⇒ misma salida (pura)
    expect(second.columns.map((column) => column.value)).toEqual(
      first.columns.map((column) => column.value),
    );
  });

  it('labelFor sólo decora el rótulo de los valores no declarados', () => {
    const rows: SourceRow[] = [
      { slug: 't1', status: 'blocked' },
      { slug: 't2', status: 'todo' },
    ];
    const { columns } = mapKanbanRows(rows, BASE_CONFIG, {
      labelFor: (value) => `Sin columna: ${value}`,
    });
    expect(columns[0].label).toBe('Por hacer'); // declarada: intocable
    expect(columns[3].label).toBe('Sin columna: blocked');
  });

  it('una celda objeto se reduce a su etiqueta legible, nunca a [object Object]', () => {
    const rows: SourceRow[] = [{ slug: 't1', status: { label: 'En curso' } }];
    const { columns, unknown } = mapKanbanRows(rows, BASE_CONFIG, {});
    expect(unknown).toHaveLength(0);
    expect(columns.map((column) => column.value)).toContain('En curso');
    // un objeto sin escalar legible no puede nombrar una columna: va a unknown
    const orphan = mapKanbanRows([{ slug: 't2', status: { weird: true } }], BASE_CONFIG, {});
    expect(orphan.unknown.map((row) => row['slug'])).toEqual(['t2']);
    expect(JSON.stringify(orphan)).not.toContain('[object Object]');
  });
});

// ─────────────────────────────────────────────────────────────
// Pure model — card title / subtitle
// ─────────────────────────────────────────────────────────────

describe('kanban-model — cardTitle / cardSubtitle', () => {
  const schema = kanbanSchema();

  it('cardTitle: config.titleField → schema.titleField → keyField', () => {
    const cfg: KanbanViewConfig = { ...BASE_CONFIG, titleField: 'owner' };
    expect(cardTitle({ slug: 't1', name: 'Deploy', owner: 'Ana' }, cfg, schema)).toBe('Ana');
    // sin titleField en la config ⇒ el titleField del schema
    const withoutTitle: KanbanViewConfig = { groupField: 'status', columns: BASE_CONFIG.columns };
    expect(cardTitle({ slug: 't1', name: 'Deploy' }, withoutTitle, schema)).toBe('Deploy');
    // ni config ni fila con título legible ⇒ la clave del registro
    expect(cardTitle({ slug: 't1' }, withoutTitle, schema)).toBe('t1');
  });

  it('cardTitle nunca pinta undefined ni [object Object]', () => {
    const cfg: KanbanViewConfig = { ...BASE_CONFIG, titleField: 'name' };
    const row: SourceRow = { slug: 't9', name: { weird: true } };
    const title = cardTitle(row, cfg, schema);
    expect(title).toBe('t9'); // cae a la clave
    expect(title).not.toContain('[object Object]');
    expect(cardTitle({ slug: 't9', name: { label: 'Legible' } }, cfg, schema)).toBe('Legible');
    expect(cardTitle({ slug: 't9', name: '' }, cfg, schema)).toBe('t9');
  });

  it('cardTitle con ningún candidato legible ⇒ «Sin título» visible', () => {
    const cfg: KanbanViewConfig = { groupField: 'status', columns: BASE_CONFIG.columns };
    expect(cardTitle({}, cfg, schema)).toBe(CARD_NO_TITLE);
    expect(CARD_NO_TITLE).toBe('Sin título');
  });

  it('cardSubtitle: valor de config.subtitleField si lo hay, si no vacío', () => {
    expect(cardSubtitle({ slug: 't1', owner: 'Ana' }, BASE_CONFIG, schema)).toBe('Ana');
    expect(cardSubtitle({ slug: 't1' }, BASE_CONFIG, schema)).toBe('');
    const noSubtitle: KanbanViewConfig = {
      groupField: 'status',
      columns: BASE_CONFIG.columns,
      titleField: 'name',
    };
    expect(cardSubtitle({ slug: 't1', owner: 'Ana' }, noSubtitle, schema)).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

describe('KanbanView', () => {
  it('pinta las columnas declaradas en orden, con rótulo y conteo en texto', async () => {
    const { el } = await create({
      rows: [
        { slug: 't1', name: 'Deploy', status: 'done' },
        { slug: 't2', name: 'Diseño', owner: 'Ana', status: 'todo' },
        { slug: 't3', name: 'QA', status: 'todo' },
      ],
    });

    expect(columnValues(el)).toEqual(['todo', 'doing', 'done']);
    expect(el.querySelector('[data-column="todo"] h3')?.textContent).toBe('Por hacer');
    expect(cardTitles(el, 'todo')).toEqual(['Diseño', 'QA']);
    expect(cardTitles(el, 'done')).toEqual(['Deploy']);

    // el conteo es TEXTO, no color: va en el badge y en el aria-label
    const badge = el.querySelector('[data-column="todo"] header span')?.textContent ?? '';
    expect(badge).toContain('2');
    expect(badge).toContain('tarjetas');
    expect(el.querySelector('section[aria-label="Por hacer: 2 tarjetas"]')).not.toBeNull();
    expect(el.querySelector('section[aria-label="Hecho: 1 tarjeta"]')).not.toBeNull();
  });

  it('un valor no declarado se ve como columna propia al final', async () => {
    const { el } = await create({
      rows: [
        { slug: 't1', name: 'Bloqueada', status: 'blocked' },
        { slug: 't2', name: 'Diseño', status: 'todo' },
      ],
    });
    expect(columnValues(el)).toEqual(['todo', 'doing', 'done', 'blocked']);
    expect(el.querySelector('[data-column="blocked"] h3')?.textContent).toBe('blocked');
    expect(cardTitles(el, 'blocked')).toEqual(['Bloqueada']);
  });

  it('las filas sin grupo van a la columna «Sin valor» al final', async () => {
    const { el } = await create({
      rows: [
        { slug: 't1', name: 'Sin estado', status: '' },
        { slug: 't2', name: 'Sin clave' },
        { slug: 't3', name: 'Diseño', status: 'todo' },
      ],
    });
    expect(columnValues(el)).toEqual(['todo', 'doing', 'done', '__sin_valor__']);
    expect(el.querySelector('[data-column="__sin_valor__"] h3')?.textContent).toBe('Sin valor');
    expect(cardTitles(el, '__sin_valor__')).toEqual(['Sin estado', 'Sin clave']);
    expect(el.querySelector('section[aria-label="Sin valor: 2 tarjetas"]')).not.toBeNull();
  });

  it('pinta título y subtítulo con sus fallbacks (clave, sin segundo renglón)', async () => {
    const { el } = await create({
      rows: [
        { slug: 't1', name: 'Deploy', owner: 'Ana', status: 'todo' },
        { slug: 't2', name: '', owner: '', status: 'todo' },
      ],
    });
    const cards = [...el.querySelectorAll('[data-column="todo"] li')];
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('Deploy');
    expect(cards[0].textContent).toContain('Ana');
    // sin título legible ⇒ la clave; sin subtítulo ⇒ un solo renglón
    expect(cards[1].querySelector('p')?.textContent?.trim()).toBe('t2');
    expect(cards[1].querySelectorAll('p')).toHaveLength(1);
    expect(cards[1].textContent).not.toContain('[object Object]');
  });

  it('muestra «Sin tarjetas» en la columna declarada vacía', async () => {
    const { el } = await create({ rows: [{ slug: 't1', name: 'Diseño', status: 'todo' }] });
    expect(el.querySelector('[data-column="doing"]')?.textContent).toContain('Sin tarjetas');
    expect(el.querySelector('[data-column="todo"]')?.textContent).not.toContain('Sin tarjetas');
    // sin filas desconocidas NO se pinta la columna «Sin valor»
    expect(columnValues(el)).toEqual(['todo', 'doing', 'done']);
  });

  it('muestra el skeleton mientras la fuente no responde', async () => {
    const { el } = await create({ rows: 'pending' });
    expect(el.querySelector('app-skeleton')).not.toBeNull();
    expect(el.querySelector('section')?.getAttribute('aria-busy')).toBe('true');
  });

  it('pinta el estado de error con el mensaje mapeado', async () => {
    const { el } = await create({ rows: 'reject' });
    expect(el.querySelector('app-empty-state')?.textContent).toContain(
      'No se pudo cargar el tablero',
    );
    expect(el.textContent).toContain('Fallo del servidor');
    expect(columnValues(el)).toEqual([]);
  });

  it('pinta la config inválida como estado vacío, sin pedir filas', async () => {
    const { el, rowsMock } = await create({ config: null });
    expect(el.textContent).toContain('Configuración inválida');
    expect(rowsMock).not.toHaveBeenCalled();
  });

  it('resuelve el schema desde route data, sin ningún input', async () => {
    // The shell mounts views via `loadComponent` (no input bindings), so
    // there is NO input to set: the schema must come from route data.
    const { component, rowsMock } = await create({ rows: [] });
    expect(component.schema()?.id).toBe('kanban_tasks');
    expect(component.config()?.groupField).toBe('status');
    expect(rowsMock).toHaveBeenCalledWith({ resource: 'kanban_tasks' }, undefined);
  });

  it('resuelve el schema por resourceId en route data (la ruta de producción)', async () => {
    const { component, el, rowsMock } = await create({
      data: { uiView: 'list', resourceId: 'products' },
    });
    expect(component.schema()?.id).toBe('products');
    // products no declara una vista kanban usable ⇒ estado inválido, sin fetch
    expect(component.config()).toBeUndefined();
    expect(el.textContent).toContain('Configuración inválida');
    expect(rowsMock).not.toHaveBeenCalled();
  });

  it('sin schema ni resourceId en route data pinta «Configuración inválida»', async () => {
    // Regression the old spec missed: `input.required` never received a
    // schema in production. With neither `schema` nor `resourceId` there is
    // nothing to resolve, and the only honest render is the invalid-config
    // empty state (no board, no fetch).
    const rowsMock = vi.fn(() => Promise.resolve<SourceRow[]>([]));
    await TestBed.configureTestingModule({
      imports: [KanbanView],
      providers: [
        { provide: ActivatedRoute, useValue: { data: of({ uiView: 'board' }) } },
        { provide: DataSourceService, useValue: { rows: rowsMock } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(KanbanView);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Configuración inválida');
    expect(rowsMock).not.toHaveBeenCalled();
  });

  it('pide la fuente declarada y, sin source, el listado del propio recurso', async () => {
    const declared = await create({
      rows: [],
      config: { ...BASE_CONFIG, source: { resource: 'oth', view: 'por_estado' } },
    });
    expect(declared.rowsMock).toHaveBeenCalledWith(
      { resource: 'oth', view: 'por_estado' },
      undefined,
    );
  });
});

// ─────────────────────────────────────────────────────────────
// R9.9.4 · decision table — selection contract + load race
// ─────────────────────────────────────────────────────────────

describe('KanbanView — contrato de selección declarado (R9.9.4)', () => {
  const ROUTE: SelectionBinding = {
    on: 'open',
    mode: 'route',
    target: { resource: 'orders', view: 'detail', params: ['key'] },
  };
  const ROWS: SourceRow[] = [{ slug: 't-1', name: 'Tarea 1', status: 'todo' }];

  function boardData(extra: Record<string, unknown>): Record<string, unknown> {
    return { uiView: 'board', schema: kanbanSchema(), ...extra };
  }

  it("mode:'route' ⇒ la tarjeta emite con la acción declarada", async () => {
    const emit = vi.fn();
    const h = await create({ rows: ROWS, data: boardData({ select: ROUTE, emit }) });

    (h.el.querySelector('[data-column="todo"] li') as HTMLElement).click();

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      resource: 'kanban_tasks',
      key: 't-1',
      action: 'open',
    });
    expect(h.el.querySelector('[data-column="todo"] li')?.getAttribute('data-selectable')).toBe(
      'true',
    );
  });

  it("mode:'none' ⇒ la tarjeta es inerte aunque tenga emit disponible", async () => {
    const emit = vi.fn();
    const h = await create({
      rows: ROWS,
      data: boardData({ select: { on: 'open', mode: 'none' }, emit }),
    });

    (h.el.querySelector('[data-column="todo"] li') as HTMLElement).click();

    expect(emit).not.toHaveBeenCalled();
  });

  it('sin select declarado ⇒ el clic de tarjeta no emite nada (comportamiento actual)', async () => {
    const emit = vi.fn();
    const h = await create({ rows: ROWS, data: boardData({ emit }) });

    (h.el.querySelector('[data-column="todo"] li') as HTMLElement).click();

    expect(emit).not.toHaveBeenCalled();
    expect(h.el.querySelector('[data-column="todo"] li')?.hasAttribute('data-selectable')).toBe(
      false,
    );
  });

  // ── R9.8.7 — operabilidad con teclado ──

  it('la tarjeta seleccionable es focusable y Enter/Space activan la selección', async () => {
    const emit = vi.fn();
    const h = await create({ rows: ROWS, data: boardData({ select: ROUTE, emit }) });
    const card = h.el.querySelector('[data-column="todo"] li') as HTMLElement;

    expect(card.getAttribute('tabindex')).toBe('0');
    expect(card.getAttribute('role')).toBe('button');

    card.focus();
    expect(document.activeElement).toBe(card);

    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({ resource: 'kanban_tasks', key: 't-1', action: 'open' });

    card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('sin binding declarado la tarjeta no es focusable (comportamiento local intacto)', async () => {
    const emit = vi.fn();
    const h = await create({ rows: ROWS, data: boardData({ emit }) });
    const card = h.el.querySelector('[data-column="todo"] li') as HTMLElement;

    expect(card.hasAttribute('tabindex')).toBe(false);
    expect(card.hasAttribute('role')).toBe(false);

    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(emit).not.toHaveBeenCalled();
  });

  it('cargas fuera de orden ⇒ sólo la última respuesta se pinta (loadEpoch)', async () => {
    let resolverPrimera!: (rows: SourceRow[]) => void;
    let resolverSegunda!: (rows: SourceRow[]) => void;
    const primera = new Promise<SourceRow[]>((r) => (resolverPrimera = r));
    const segunda = new Promise<SourceRow[]>((r) => (resolverSegunda = r));
    const pendientes = [primera, segunda];
    let llamada = 0;

    const h = await create({
      rowsImpl: () => {
        const p = pendientes[llamada++];
        // Non-null: el harness sólo dispara dos cargas (load inicial + retry).
        return p ?? Promise.resolve<SourceRow[]>([]);
      },
    });
    expect(h.rowsMock).toHaveBeenCalledTimes(1);

    h.component.retry(); // segunda carga, epoch 2
    expect(h.rowsMock).toHaveBeenCalledTimes(2);

    // Responder la SEGUNDA primero…
    resolverSegunda([{ slug: 'nueva', name: 'Nueva', status: 'todo' }]);
    await h.fixture.whenStable();
    h.fixture.detectChanges();
    expect(h.el.textContent ?? '').toContain('Nueva');

    // …y la PRIMERA tarde: no debe pisar lo ya pintado.
    resolverPrimera([{ slug: 'vieja', name: 'Vieja', status: 'todo' }]);
    await h.fixture.whenStable();
    h.fixture.detectChanges();
    expect(h.el.textContent ?? '').toContain('Nueva');
    expect(h.el.textContent ?? '').not.toContain('Vieja');
  });
});
