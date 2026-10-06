import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import type { RecordListWidget } from '../../core/models/schema.model';
import { RecordList } from './record-list';

describe('RecordList', () => {
  let fixture: ComponentFixture<RecordList>;

  const widget: RecordListWidget = {
    type: 'record-list',
    key: 'pedidos_pendientes',
    label: 'Pedidos que Requieren Atención',
    resource: 'orders',
    columns: ['ref', 'customer_name', 'status'],
    action: {
      label: 'Ver Ficha',
      routeTemplate: '/admin/orders?id={ref}',
    },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecordList],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(RecordList);
  });

  it('1. renderiza las filas y columnas declaradas', () => {
    const data = [
      { ref: 'ORD-001', customer_name: 'Cliente Uno', status: 'PENDIENTE' },
      { ref: 'ORD-002', customer_name: 'Cliente Dos', status: 'PENDIENTE' },
    ];

    fixture.componentRef.setInput('widget', widget);
    fixture.componentRef.setInput('data', data);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Pedidos que Requieren Atención');
    expect(root.textContent).toContain('ORD-001');
    expect(root.textContent).toContain('Cliente Uno');
    expect(root.textContent).toContain('ORD-002');
    expect(root.textContent).toContain('Cliente Dos');
  });

  it('2. renderiza estado vacío cuando no hay datos', () => {
    fixture.componentRef.setInput('widget', widget);
    fixture.componentRef.setInput('data', []);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Sin registros pendientes');
  });

  it('3. genera el enlace de acción con la ruta interpolada', () => {
    const data = [{ ref: 'ORD-777', customer_name: 'Carlos', status: 'PENDIENTE' }];

    fixture.componentRef.setInput('widget', widget);
    fixture.componentRef.setInput('data', data);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const link = root.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/admin/orders?id=ORD-777');
    expect(link?.textContent?.trim()).toBe('Ver Ficha');
  });

  it('4. maneja datos nulos sin romper', () => {
    fixture.componentRef.setInput('widget', widget);
    fixture.componentRef.setInput('data', null);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Sin registros pendientes');
  });
});
