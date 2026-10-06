import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import type { ResourceSchema } from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
import { Dashboard } from './dashboard';

/**
 * Schema sintético con datos fixture — el criterio de salida de la Etapa 1
 * (motor-plan): «un schema sintético declara y dibuja sin errores de
 * render». Si esto dibuja, el problema no es del renderizador.
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

  const render = (data: Record<string, unknown> | null): void => {
    fixture.componentRef.setInput('schema', SCHEMA);
    if (data !== null) {
      fixture.componentRef.setInput('data', data);
    }
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Dashboard],
      providers: [
        {
          provide: ApiService,
          useValue: {
            request: () => of(FIXTURE),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Dashboard);
  });

  it('declara y dibuja los dos widgets con datos fixture', () => {
    render(FIXTURE);

    // metric-card
    expect(text()).toContain('Pendientes');
    expect(root().querySelector('[data-testid="value"]')?.textContent?.trim()).toBe('3');
    expect(text()).toContain('actualizados hoy');

    // bar-chart
    expect(text()).toContain('Entregas por día');
    expect(root().querySelectorAll('[role="img"] > div').length).toBe(2);
  });

  it('obtiene los datos de forma reactiva desde ApiService cuando no se pasa input data', () => {
    render(null);

    expect(text()).toContain('Pendientes');
    expect(root().querySelector('[data-testid="value"]')?.textContent?.trim()).toBe('3');
  });

  it('sin widgets declarados ⇒ estado vacío', () => {
    fixture.componentRef.setInput('schema', { ...SCHEMA, widgets: [] });
    fixture.componentRef.setInput('data', {});
    fixture.detectChanges();

    expect(text()).toContain('Sin widgets declarados');
    expect(root().querySelector('app-widget-host')).toBeNull();
  });

  it('sin datos el render no falla: cada widget muestra su estado vacío', () => {
    render({});

    expect(root().querySelector('app-metric-card')).not.toBeNull();
    expect(root().querySelector('[data-testid="value-empty"]')).not.toBeNull();
    expect(text()).toContain('Sin datos.');
  });
});
