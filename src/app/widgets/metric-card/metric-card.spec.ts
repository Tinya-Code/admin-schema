import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MetricCard } from './metric-card';

describe('MetricCard', () => {
  let fixture: ComponentFixture<MetricCard>;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const value = (): HTMLElement | null => root().querySelector('[data-testid="value"]');
  const empty = (): HTMLElement | null => root().querySelector('[data-testid="value-empty"]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MetricCard] }).compileComponents();
    fixture = TestBed.createComponent(MetricCard);
    fixture.componentRef.setInput('label', 'Pendientes');
  });

  it('renderiza la etiqueta y la cifra', () => {
    fixture.componentRef.setInput('value', 3);
    fixture.detectChanges();

    expect(root().textContent).toContain('Pendientes');
    expect(value()?.textContent?.trim()).toBe('3');
    expect(empty()).toBeNull();
  });

  it('value null ⇒ estado vacío con el placeholder', () => {
    fixture.componentRef.setInput('value', null);
    fixture.detectChanges();

    expect(empty()).not.toBeNull();
    expect(value()).toBeNull();
  });

  it('0 es un valor, no un vacío', () => {
    fixture.componentRef.setInput('value', 0);
    fixture.detectChanges();

    expect(value()?.textContent?.trim()).toBe('0');
    expect(empty()).toBeNull();
  });

  it('sin hint no pinta la línea secundaria', () => {
    fixture.componentRef.setInput('value', 3);
    fixture.detectChanges();
    expect(root().textContent).not.toContain('hint');

    fixture.componentRef.setInput('hint', 'de 12 totales');
    fixture.detectChanges();
    expect(root().textContent).toContain('de 12 totales');
  });
});
