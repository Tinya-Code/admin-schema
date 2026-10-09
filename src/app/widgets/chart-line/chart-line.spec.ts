import {
  DeferBlockBehavior,
  DeferBlockState,
  ComponentFixture,
  TestBed,
} from '@angular/core/testing';

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

  /**
   * `on viewport` necesita `IntersectionObserver`, que jsdom no implementa:
   * con `Manual` el bloque no evalúa su condición y lo pintamos a mano.
   */
  const pintarDefer = async (estado: DeferBlockState): Promise<void> => {
    const blocks = await fixture.getDeferBlocks();
    await blocks[0].render(estado);
    fixture.detectChanges();
  };

  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = (() =>
      ctxStub) as unknown as typeof originalGetContext;
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChartLine],
      deferBlockBehavior: DeferBlockBehavior.Manual,
    }).compileComponents();
    fixture = TestBed.createComponent(ChartLine);
  });

  it('sin datos muestra el estado vacío y no toca el lienzo', async () => {
    fixture.componentRef.setInput('label', 'Entregas por día');
    fixture.componentRef.setInput('data', []);
    fixture.detectChanges();

    expect(root().querySelector('[data-testid="empty"]')?.textContent?.trim()).toBe('Sin datos.');
    expect(root().querySelector('canvas')).toBeNull();
    // Sin datos no hay bloque que diferir: sólo existe el estado vacío.
    expect(await fixture.getDeferBlocks()).toHaveLength(0);
  });

  it('en placeholder dibuja la miniatura SVG y no monta el lienzo', async () => {
    fixture.componentRef.setInput('label', 'Entregas por día');
    fixture.componentRef.setInput('data', [
      { label: 'Lun', value: 2 },
      { label: 'Mar', value: 5 },
    ]);
    fixture.detectChanges();

    await pintarDefer(DeferBlockState.Placeholder);

    expect(root().querySelector('canvas')).toBeNull();
    expect(root().querySelector('[role="img"]')).toBeNull();
    expect(root().querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(2);
    expect(root().textContent).toContain('Entregas por día');
  });

  it('completado el defer dibuja el lienzo y resume la serie en el aria-label', async () => {
    fixture.componentRef.setInput('label', 'Entregas por día');
    fixture.componentRef.setInput('unit', ' u.');
    fixture.componentRef.setInput('data', [
      { label: 'Lun', value: 2 },
      { label: 'Mar', value: 5 },
    ]);
    fixture.detectChanges();

    await pintarDefer(DeferBlockState.Complete);

    const chart = root().querySelector('[role="img"]');
    expect(root().querySelector('canvas')).not.toBeNull();
    expect(chart?.getAttribute('aria-label')).toBe(
      'Serie de 2 puntos, de Lun (2 u.) a Mar (5 u.): sube.',
    );
    expect(root().textContent).toContain('Entregas por día');
  });
});
