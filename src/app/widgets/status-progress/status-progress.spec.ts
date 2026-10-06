import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import type { StatusProgressWidget } from '../../core/models/schema.model';
import { StatusProgress } from './status-progress';

describe('StatusProgress', () => {
  let fixture: ComponentFixture<StatusProgress>;

  const widget: StatusProgressWidget = {
    type: 'status-progress',
    key: 'balance_dia',
    label: 'Progreso de Pedidos del Día',
    segments: [
      { key: 'entregados', label: 'Entregados', color: 'success' },
      { key: 'pendientes', label: 'Pendientes', color: 'warning' },
      { key: 'cancelados', label: 'Cancelados', color: 'danger' },
    ],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusProgress],
    }).compileComponents();
    fixture = TestBed.createComponent(StatusProgress);
  });

  it('1. calcula y muestra los valores y porcentajes correctamente', () => {
    const data = { entregados: 5, pendientes: 3, cancelados: 2 };

    fixture.componentRef.setInput('widget', widget);
    fixture.componentRef.setInput('data', data);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Progreso de Pedidos del Día');
    expect(root.textContent).toContain('Total: 10');
    expect(root.textContent).toContain('5 (50%)');
    expect(root.textContent).toContain('3 (30%)');
    expect(root.textContent).toContain('2 (20%)');
  });

  it('2. maneja total en 0 sin dividir por cero', () => {
    const data = { entregados: 0, pendientes: 0, cancelados: 0 };

    fixture.componentRef.setInput('widget', widget);
    fixture.componentRef.setInput('data', data);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Total: 0');
    expect(root.textContent).toContain('0 (0%)');
  });

  it('3. maneja datos nulos asignando 0%', () => {
    fixture.componentRef.setInput('widget', widget);
    fixture.componentRef.setInput('data', null);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Total: 0');
  });
});
