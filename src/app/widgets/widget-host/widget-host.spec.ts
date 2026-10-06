import { provideRouter } from '@angular/router';
import {
  DeferBlockBehavior,
  DeferBlockState,
  ComponentFixture,
  TestBed,
} from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import type { WidgetSchema } from '../../core/models/schema.model';
import { isSupportedWidgetType, WidgetHost } from './widget-host';

describe('WidgetHost', () => {
  let fixture: ComponentFixture<WidgetHost>;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const bars = (): HTMLElement[] => [...root().querySelectorAll<HTMLElement>('[role="img"] > div')];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WidgetHost],
      providers: [provideRouter([])],
      deferBlockBehavior: DeferBlockBehavior.Manual,
    }).compileComponents();
    fixture = TestBed.createComponent(WidgetHost);
  });

  it('mismo contrato que field-host: fuera del catálogo no se dibuja', () => {
    expect(isSupportedWidgetType('metric-card')).toBe(true);
    expect(isSupportedWidgetType('bar-chart')).toBe(true);
    expect(isSupportedWidgetType('chart-line')).toBe(true);
    expect(isSupportedWidgetType('record-list')).toBe(true);
    expect(isSupportedWidgetType('quick-actions')).toBe(true);
    expect(isSupportedWidgetType('status-progress')).toBe(true);
    expect(isSupportedWidgetType('pie-chart')).toBe(false);

    fixture.componentRef.setInput('widget', {
      type: 'pie-chart',
      key: 'x',
      label: 'X',
    } as unknown as WidgetSchema);
    fixture.detectChanges();

    expect(root().querySelector('app-metric-card')).toBeNull();
    expect(root().querySelector('app-bar-chart')).toBeNull();
    expect(root().querySelector('app-record-list')).toBeNull();
    expect(root().querySelector('app-quick-actions')).toBeNull();
    expect(root().querySelector('app-status-progress')).toBeNull();
  });

  it('despacha metric-card a la tarjeta con el dato recibido', () => {
    fixture.componentRef.setInput('widget', {
      type: 'metric-card',
      key: 'pendientes',
      label: 'Pendientes',
    });
    fixture.componentRef.setInput('data', 3);
    fixture.detectChanges();

    expect(root().querySelector('app-metric-card')).not.toBeNull();
    expect(root().textContent).toContain('Pendientes');
    expect(root().querySelector('[data-testid="value"]')?.textContent?.trim()).toBe('3');
  });

  it('despacha record-list con datos tabulares', () => {
    fixture.componentRef.setInput('widget', {
      type: 'record-list',
      key: 'pedidos',
      label: 'Pedidos Activos',
      resource: 'orders',
      columns: ['ref', 'status'],
    });
    fixture.componentRef.setInput('data', [{ ref: 'ORD-10', status: 'PENDIENTE' }]);
    fixture.detectChanges();

    expect(root().querySelector('app-record-list')).not.toBeNull();
    expect(root().textContent).toContain('Pedidos Activos');
    expect(root().textContent).toContain('ORD-10');
  });

  it('despacha quick-actions con botones de atajo', () => {
    fixture.componentRef.setInput('widget', {
      type: 'quick-actions',
      key: 'accesos',
      label: 'Acciones Rápidas',
      actions: [{ label: 'Nuevo Pedido', navigateTo: '/orders/new' }],
    });
    fixture.detectChanges();

    expect(root().querySelector('app-quick-actions')).not.toBeNull();
    expect(root().textContent).toContain('Acciones Rápidas');
    expect(root().textContent).toContain('Nuevo Pedido');
  });

  it('despacha status-progress con barra porcentual', () => {
    fixture.componentRef.setInput('widget', {
      type: 'status-progress',
      key: 'balance',
      label: 'Balance Diario',
      segments: [{ key: 'ok', label: 'Completado', color: 'success' }],
    });
    fixture.componentRef.setInput('data', { ok: 10 });
    fixture.detectChanges();

    expect(root().querySelector('app-status-progress')).not.toBeNull();
    expect(root().textContent).toContain('Balance Diario');
    expect(root().textContent).toContain('Completado');
  });

  it('calcula la clase de ancho de columna en la grilla', () => {
    fixture.componentRef.setInput('widget', {
      type: 'metric-card',
      key: 'kpi',
      label: 'KPI',
      width: 8,
    });
    fixture.detectChanges();

    expect(root().className).toContain('col-span-12 lg:col-span-8');
  });

  it('bar-chart descarta las series que no sean { label: string, value: number }', () => {
    fixture.componentRef.setInput('widget', {
      type: 'bar-chart',
      key: 'por_dia',
      label: 'Entregas',
    });
    fixture.componentRef.setInput('data', [
      { label: 'Lun', value: 2 },
      { label: 'Mal', value: 'no-numérico' },
      'no-objeto',
      { label: 'Mar', value: 5 },
    ]);
    fixture.detectChanges();

    expect(bars().length).toBe(2);
    expect(root().textContent).toContain('Lun');
    expect(root().textContent).toContain('Mar');
    expect(root().textContent).not.toContain('Mal');
  });

  it('chart-line: mientras no se carga el chunk hay fallback CSS y nada revienta', async () => {
    fixture.componentRef.setInput('widget', {
      type: 'chart-line',
      key: 'serie',
      label: 'Entregas por día',
    });
    fixture.componentRef.setInput('data', [
      { label: 'Lun', value: 2 },
      { label: 'Mar', value: 5 },
    ]);
    fixture.detectChanges();

    const blocks = await fixture.getDeferBlocks();
    await blocks[0].render(DeferBlockState.Placeholder);

    expect(root().querySelector('app-chart-line')).toBeNull();
    expect(root().querySelector('canvas')).toBeNull();
    expect(root().querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(2);
    expect(root().textContent).toContain('Entregas por día');
  });

  it('chart-line: al completarse el defer monta el componente', async () => {
    fixture.componentRef.setInput('widget', {
      type: 'chart-line',
      key: 'serie',
      label: 'Entregas por día',
    });
    fixture.componentRef.setInput('data', []);
    fixture.detectChanges();

    const blocks = await fixture.getDeferBlocks();
    await blocks[0].render(DeferBlockState.Complete);

    expect(root().querySelector('app-chart-line')).not.toBeNull();
    expect(root().querySelector('[data-testid="empty"]')?.textContent?.trim()).toBe('Sin datos.');
  });
});
