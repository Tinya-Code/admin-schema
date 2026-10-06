import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChartLine } from './chart-line';

/**
 * jsdom no implementa el lienzo 2D: `getContext('2d')` devuelve `null` y
 * Chart.js revienta al primer trazo. Se stubbea por `beforeAll` para poder
 * montar el componente de verdad y se restaura en `afterAll`.
 */
const canvasStub = { width: 300, height: 150 } as HTMLCanvasElement;

const ctxStub = new Proxy({} as unknown as CanvasRenderingContext2D, {
  get(_target, prop) {
    if (prop === 'canvas') {
      return canvasStub;
    }
    if (prop === 'measureText') {
      return () => ({ width: 10 });
    }
    if (prop === 'createLinearGradient') {
      return () => ({ addColorStop: () => undefined });
    }
    return () => undefined;
  },
  set() {
    return true;
  },
});

describe('ChartLine', () => {
  let fixture: ComponentFixture<ChartLine>;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = (() =>
      ctxStub) as unknown as typeof originalGetContext;
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ChartLine] }).compileComponents();
    fixture = TestBed.createComponent(ChartLine);
  });

  it('sin datos muestra el estado vacío y no toca el lienzo', () => {
    fixture.componentRef.setInput('label', 'Entregas por día');
    fixture.componentRef.setInput('data', []);
    fixture.detectChanges();

    expect(root().querySelector('[data-testid="empty"]')?.textContent?.trim()).toBe('Sin datos.');
    expect(root().querySelector('canvas')).toBeNull();
  });

  it('con datos dibuja el lienzo y resume la serie en el aria-label', () => {
    fixture.componentRef.setInput('label', 'Entregas por día');
    fixture.componentRef.setInput('unit', ' u.');
    fixture.componentRef.setInput('data', [
      { label: 'Lun', value: 2 },
      { label: 'Mar', value: 5 },
    ]);
    fixture.detectChanges();

    const chart = root().querySelector('[role="img"]');
    expect(root().querySelector('canvas')).not.toBeNull();
    expect(chart?.getAttribute('aria-label')).toBe(
      'Serie de 2 puntos, de Lun (2 u.) a Mar (5 u.): sube.',
    );
    expect(root().textContent).toContain('Entregas por día');
  });
});
