import { ComponentFixture, TestBed } from '@angular/core/testing';
import { convertToParamMap, ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import type { ResourceSchema } from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
import { schemas } from '../../schemas/registry';
import { ResourcePage } from './resource-page';

const DETAIL_SCHEMA: ResourceSchema = {
  id: 'test_orders',
  label: 'Pedido',
  labelPlural: 'Pedidos',
  kind: 'collection',
  endpoint: {
    list: '/admin/test_orders',
    get: '/admin/test_orders/{key}',
    create: '/admin/test_orders',
    update: '/admin/test_orders/{key}',
    remove: '/admin/test_orders/{key}',
  },
  keyField: 'ref',
  titleField: 'customer_name',
  listColumns: [{ key: 'ref', label: 'Ref' }],
  fields: [{ type: 'text', key: 'ref', label: 'Referencia' }],
  detail: {
    enabled: true,
    headerFields: ['ref'],
  },
};

const NO_ACCESS_SCHEMA: ResourceSchema = {
  id: 'no_access_res',
  label: 'Restringido',
  labelPlural: 'Restringidos',
  kind: 'collection',
  permissions: { create: false, update: false, remove: false },
  endpoint: { list: '/admin/no_access' },
  keyField: 'id',
  titleField: 'id',
  listColumns: [],
  fields: [],
};

describe('ResourcePage', () => {
  let fixture: ComponentFixture<ResourcePage>;
  let component: ResourcePage;
  let routerNavigate: ReturnType<typeof vi.fn>;
  let mockParamMap: any;

  beforeEach(async () => {
    // Subject (y no `of`) para poder emitir un `:key` tardío y verificar
    // que la ficha se abre también por URL, no sólo por clic en una fila.
    mockParamMap = new BehaviorSubject(convertToParamMap({ id: 'test_orders' }));
    routerNavigate = vi.fn();

    // Register synthetic schemas in mutable catalog
    const catalog = schemas as ResourceSchema[];
    if (!catalog.some((s) => s.id === 'test_orders')) {
      catalog.push(DETAIL_SCHEMA);
    }
    if (!catalog.some((s) => s.id === 'no_access_res')) {
      catalog.push(NO_ACCESS_SCHEMA);
    }

    await TestBed.configureTestingModule({
      imports: [ResourcePage],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: mockParamMap,
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: routerNavigate,
          },
        },
        {
          provide: ApiService,
          useValue: {
            request: () => of({ items: [], total: 0 }),
            list: () => of([]),
            get: () => of(null),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ResourcePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // El registry es un array de módulo compartido: sin esta limpieza los
  // schemas sintéticos filtraban a los demás specs (el sidebar empezó a
  // renderizar un «Pedidos» fantasma). Mismo patrón que form-view.spec.ts.
  afterEach(() => {
    const catalog = schemas as ResourceSchema[];
    [DETAIL_SCHEMA, NO_ACCESS_SCHEMA].forEach((synthetic) => {
      const index = catalog.findIndex((schema) => schema.id === synthetic.id);
      if (index >= 0) catalog.splice(index, 1);
    });
  });

  it('inicia mostrando la vista list por defecto para colecciones', () => {
    expect(component.currentView()).toBe('list');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-list-view')).not.toBeNull();
    expect(el.querySelector('app-detail-view')).toBeNull();
  });

  it('cambia a vista detail al seleccionar un registro', () => {
    const record = { ref: 'ORD-101', customer_name: 'Alejandro' };
    component.switchToDetail(record);
    fixture.detectChanges();

    expect(component.currentView()).toBe('detail');
    expect(component.selectedRecord()).toEqual(record);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-detail-view')).not.toBeNull();
    expect(el.querySelector('app-list-view')).toBeNull();
  });

  it('vuelve a la vista list al ejecutar switchToList', () => {
    component.switchToDetail({ ref: 'ORD-101' });
    fixture.detectChanges();

    component.switchToList();
    fixture.detectChanges();

    expect(component.currentView()).toBe('list');
    expect(component.selectedRecord()).toBeNull();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-list-view')).not.toBeNull();
  });

  it('navega al formulario de edición al invocar goEdit con el registro', () => {
    const record = { ref: 'ORD-202', customer_name: 'Carlos' };
    component.goEdit(record);

    expect(routerNavigate).toHaveBeenCalledWith(['/', 'test_orders', 'ORD-202', 'edit']);
  });

  it('abre el detalle cuando la ruta trae `:key` (enlace «Ver Ficha»)', () => {
    expect(component.currentView()).toBe('list');

    mockParamMap.next(convertToParamMap({ id: 'test_orders', key: 'ORD-404' }));
    fixture.detectChanges();

    expect(component.currentView()).toBe('detail');
    // La URL sólo trae la clave: DetailView carga el resto por `get`.
    expect(component.selectedRecord()).toEqual({ ref: 'ORD-404' });
    expect((fixture.nativeElement as HTMLElement).querySelector('app-detail-view')).not.toBeNull();
  });

  it('vuelve a list cuando la ruta pierde `:key` (botón atrás)', () => {
    mockParamMap.next(convertToParamMap({ id: 'test_orders', key: 'ORD-404' }));
    fixture.detectChanges();
    expect(component.currentView()).toBe('detail');

    mockParamMap.next(convertToParamMap({ id: 'test_orders' }));
    fixture.detectChanges();

    expect(component.currentView()).toBe('list');
    expect(component.selectedRecord()).toBeNull();
  });

  it('detecta correctamente permisos y renderiza estado sin permisos', () => {
    expect(component.hasNoAccess(NO_ACCESS_SCHEMA)).toBe(true);
    expect(component.hasNoAccess(DETAIL_SCHEMA)).toBe(false);
  });
});
