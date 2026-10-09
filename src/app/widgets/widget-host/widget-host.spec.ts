import { provideRouter } from '@angular/router';
import { DeferBlockBehavior, ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { isSupported } from '../../core/registry/render-registry';
import type { WidgetSchema } from '../../core/models/schema.model';
import { WidgetHost } from './widget-host';

describe('WidgetHost', () => {
  let fixture: ComponentFixture<WidgetHost>;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const bars = (): HTMLElement[] => [...root().querySelectorAll<HTMLElement>('[role="img"] > div')];

  /**
   * El componente sale del registro con un `import()`, igual que los campos:
   * `whenStable()` sólo lo cubre porque `RenderHost` lo registra como tarea
   * pendiente (D28). Sin este ciclo el outlet todavía muestra el skeleton.
   */
  const pintar = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WidgetHost],
      providers: [provideRouter([])],
      // `chart-line` lleva su propio `@defer (on viewport)` y jsdom no tiene
      // `IntersectionObserver`: sin Manual el bloque reventaría al evaluarse.
      deferBlockBehavior: DeferBlockBehavior.Manual,
    }).compileComponents();
    fixture = TestBed.createComponent(WidgetHost);
  });

  it('mismo contrato que field-host: fuera del catálogo no se dibuja', async () => {
    expect(isSupported('widget', 'metric-card')).toBe(true);
    expect(isSupported('widget', 'bar-chart')).toBe(true);
    expect(isSupported('widget', 'chart-line')).toBe(true);
    expect(isSupported('widget', 'record-list')).toBe(true);
    expect(isSupported('widget', 'quick-actions')).toBe(true);
    expect(isSupported('widget', 'status-progress')).toBe(true);
    expect(isSupported('widget', 'pie-chart')).toBe(false);

    fixture.componentRef.setInput('widget', {
      type: 'pie-chart',
      key: 'x',
      label: 'X',
    } as unknown as WidgetSchema);
    await pintar();

    expect(root().querySelector('app-metric-card')).toBeNull();
    expect(root().querySelector('app-bar-chart')).toBeNull();
    expect(root().querySelector('app-record-list')).toBeNull();
    expect(root().querySelector('app-quick-actions')).toBeNull();
    expect(root().querySelector('app-status-progress')).toBeNull();
  });

  it('despacha metric-card a la tarjeta con el dato recibido', async () => {
    fixture.componentRef.setInput('widget', {
      type: 'metric-card',
      key: 'pendientes',
      label: 'Pendientes',
    });
    fixture.componentRef.setInput('data', 3);
    await pintar();

    expect(root().querySelector('app-metric-card')).not.toBeNull();
    expect(root().textContent).toContain('Pendientes');
    expect(root().querySelector('[data-testid="value"]')?.textContent?.trim()).toBe('3');
  });

  it('despacha record-list con datos tabulares', async () => {
    fixture.componentRef.setInput('widget', {
      type: 'record-list',
      key: 'pedidos',
      label: 'Pedidos Activos',
      resource: 'orders',
      columns: ['ref', 'status'],
    });
    fixture.componentRef.setInput('data', [{ ref: 'ORD-10', status: 'PENDIENTE' }]);
    await pintar();

    expect(root().querySelector('app-record-list')).not.toBeNull();
    expect(root().textContent).toContain('Pedidos Activos');
    expect(root().textContent).toContain('ORD-10');
  });

  it('despacha quick-actions con botones de atajo', async () => {
    fixture.componentRef.setInput('widget', {
      type: 'quick-actions',
      key: 'accesos',
      label: 'Acciones Rápidas',
      actions: [{ label: 'Nuevo Pedido', navigateTo: '/orders/new' }],
    });
    await pintar();

    expect(root().querySelector('app-quick-actions')).not.toBeNull();
    expect(root().textContent).toContain('Acciones Rápidas');
    expect(root().textContent).toContain('Nuevo Pedido');
  });

  it('despacha status-progress con barra porcentual', async () => {
    fixture.componentRef.setInput('widget', {
      type: 'status-progress',
      key: 'balance',
      label: 'Balance Diario',
      segments: [{ key: 'ok', label: 'Completado', color: 'success' }],
    });
    fixture.componentRef.setInput('data', { ok: 10 });
    await pintar();

    expect(root().querySelector('app-status-progress')).not.toBeNull();
    expect(root().textContent).toContain('Balance Diario');
    expect(root().textContent).toContain('Completado');
  });

  it('despacha chart-line con su serie (el defer lo decide el propio widget)', async () => {
    fixture.componentRef.setInput('widget', {
      type: 'chart-line',
      key: 'serie',
      label: 'Entregas por día',
    });
    fixture.componentRef.setInput('data', []);
    await pintar();

    expect(root().querySelector('app-chart-line')).not.toBeNull();
    expect(root().querySelector('[data-testid="empty"]')?.textContent?.trim()).toBe('Sin datos.');
  });

  it('calcula la clase de ancho de columna en la grilla', async () => {
    fixture.componentRef.setInput('widget', {
      type: 'metric-card',
      key: 'kpi',
      label: 'KPI',
      width: 8,
    });
    await pintar();

    expect(root().className).toContain('col-span-12 lg:col-span-8');
  });

  it('bar-chart descarta las series que no sean { label: string, value: number }', async () => {
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
    await pintar();

    expect(bars().length).toBe(2);
    expect(root().textContent).toContain('Lun');
    expect(root().textContent).toContain('Mar');
    expect(root().textContent).not.toContain('Mal');
  });
});
