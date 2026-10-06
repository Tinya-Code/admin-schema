import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BarChart, type BarDatum } from './bar-chart';

const DATA: BarDatum[] = [
  { label: 'Lun', value: 3 },
  { label: 'Mar', value: 5 },
  { label: 'Mié', value: 1 },
];

describe('BarChart', () => {
  let fixture: ComponentFixture<BarChart>;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const bars = (): HTMLElement[] => [...root().querySelectorAll<HTMLElement>('[role="img"] > div')];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [BarChart] }).compileComponents();
    fixture = TestBed.createComponent(BarChart);
    fixture.componentRef.setInput('label', 'Entregas');
  });

  it('renderiza N barras con el resumen en aria-label', () => {
    fixture.componentRef.setInput('data', DATA);
    fixture.detectChanges();

    expect(bars().length).toBe(3);
    expect(root().textContent).toContain('Entregas');
    expect(root().textContent).toContain('Lun');

    const chart = root().querySelector('[role="img"]');
    expect(chart?.getAttribute('aria-label')).toContain('3 categorías');
    expect(chart?.getAttribute('aria-label')).toContain('Mayor: Mar con 5');
  });

  it('data vacía ⇒ «Sin datos» y sin grilla accesible', () => {
    fixture.componentRef.setInput('data', []);
    fixture.detectChanges();

    expect(root().querySelector('[data-testid="empty"]')?.textContent).toContain('Sin datos');
    expect(root().querySelector('[role="img"]')).toBeNull();
    expect(bars().length).toBe(0);
  });

  it('el unit se añade a las cifras del resumen', () => {
    fixture.componentRef.setInput('data', DATA);
    fixture.componentRef.setInput('unit', ' u.');
    fixture.detectChanges();

    expect(root().querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('con 5 u.');
  });

  it('con todos los valores en 0 no divide entre cero', () => {
    fixture.componentRef.setInput('data', [
      { label: 'A', value: 0 },
      { label: 'B', value: 0 },
    ]);
    fixture.detectChanges();

    expect(bars().length).toBe(2);
    const heights = bars().map(
      (bar) => bar.querySelector<HTMLElement>('div[style*="height"]')?.style.height,
    );
    expect(heights).toEqual(['0%', '0%']);
  });
});
