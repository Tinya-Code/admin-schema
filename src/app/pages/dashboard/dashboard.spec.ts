import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';

import type { ResourceSchema } from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
import { getSchema } from '../../schemas/registry';
import { Dashboard } from './dashboard';

/**
 * Schema sintético con datos fixture — el criterio de salida de la primera
 * etapa (histórico: motor-plan): «un schema sintético declara y dibuja sin
 * errores de render». Si esto dibuja, el problema no es del renderizador.
 */
const SCHEMA: ResourceSchema = {
  id: 'pickpass',
  label: 'PickPass',
  labelPlural: 'PickPass',
  kind: 'dashboard',
  endpoint: { get: '/admin/dashboard' },
  keyField: 'id',
  titleField: 'id',
  listColumns: [],
  fields: [],
  widgets: [
    { key: 'pendientes', type: 'metric-card', label: 'Pendientes', hint: 'actualizados hoy' },
    { key: 'por_dia', type: 'bar-chart', label: 'Entregas por día', unit: ' u.' },
  ],
};

const FIXTURE: Record<string, unknown> = {
  pendientes: 3,
  por_dia: [
    { label: 'Lun', value: 2 },
    { label: 'Mar', value: 5 },
  ],
};

describe('Dashboard', () => {
  let fixture: ComponentFixture<Dashboard>;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => root().textContent ?? '';

  /** Filas que piden los widgets con `source` (F8 · R6.5). */
  const listSpy = vi.fn((endpoint?: unknown, payload?: unknown) => of([{ value: 42 }]));

  /**
   * Los componentes salen del registro con un `import()`, que `RenderHost`
   * registra como tarea pendiente para que `whenStable()` lo cubra (D28).
   * Sin este ciclo el outlet sigue en skeleton y no hay nada que assertar.
   */
  const render = async (data: Record<string, unknown> | null): Promise<void> => {
    fixture.componentRef.setInput('schema', SCHEMA);
    if (data !== null) {
      fixture.componentRef.setInput('data', data);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    listSpy.mockClear();
    listSpy.mockImplementation(() => of([{ value: 42 }]));
    await TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [
        {
          provide: ApiService,
          useValue: {
            request: () => of(FIXTURE),
            list: listSpy,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Dashboard);
  });

  it('declara y dibuja los dos widgets con datos fixture', async () => {
    await render(FIXTURE);

    // metric-card
    expect(text()).toContain('Pendientes');
    expect(root().querySelector('[data-testid="value"]')?.textContent?.trim()).toBe('3');
    expect(text()).toContain('actualizados hoy');

    // bar-chart
    expect(text()).toContain('Entregas por día');
    expect(root().querySelectorAll('[role="img"] > div').length).toBe(2);
  });

  it('obtiene los datos de forma reactiva desde ApiService cuando no se pasa input data', async () => {
    await render(null);

    expect(text()).toContain('Pendientes');
    expect(root().querySelector('[data-testid="value"]')?.textContent?.trim()).toBe('3');
  });

  it('un widget con source pide SUS filas y el de payload sigue leyendo data', async () => {
    // F8 · R6.5: el panel ya no depende de que un handler arme
    // `data[widget.key]` — la fuente declarada trae la fila agregada y la
    // tarjeta lee su `value`.
    fixture.componentRef.setInput('schema', {
      ...SCHEMA,
      widgets: [
        {
          key: 'categorias',
          type: 'metric-card',
          label: 'Categorías',
          source: { resource: 'categories', view: 'activos' },
        },
        { key: 'pendientes', type: 'metric-card', label: 'Pendientes', hint: 'actualizados hoy' },
      ],
    });
    fixture.componentRef.setInput('data', { pendientes: 7 });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // La fuente declarada se pide UNA vez, por el endpoint del recurso…
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy.mock.calls[0][0]).toEqual(getSchema('categories')!.endpoint);
    expect(listSpy.mock.calls[0][1]).toEqual({ view: 'activos' });

    // …la tarjeta con `source` mide lo que trajeron SUS filas (42) aunque
    // `data` no traiga la clave `categorias`, y la de payload sigue midiendo
    // `data` (7): las dos formas conviven en el mismo panel.
    const valores = Array.from(root().querySelectorAll('[data-testid="value"]')).map((node) =>
      node.textContent?.trim(),
    );
    expect(valores).toEqual(['42', '7']);
  });

  it('sin widgets declarados ⇒ estado vacío', () => {
    fixture.componentRef.setInput('schema', { ...SCHEMA, widgets: [] });
    fixture.componentRef.setInput('data', {});
    fixture.detectChanges();

    expect(text()).toContain('Sin widgets declarados');
    expect(root().querySelector('app-widget-host')).toBeNull();
  });

  it('sin datos el render no falla: cada widget muestra su estado vacío', async () => {
    await render({});

    expect(root().querySelector('app-metric-card')).not.toBeNull();
    expect(root().querySelector('[data-testid="value-empty"]')).not.toBeNull();
    expect(text()).toContain('Sin datos.');
  });
});
