import { Component, computed, input } from '@angular/core';

import type { WidgetSchema } from '../../core/models/schema.model';
import { RenderHost } from '../../core/registry/render-host';

/**
 * Adaptador de widgets (R3.6 · `doc/plan-refactor-motor.md` §3.6).
 *
 * Ya no despacha: `WidgetHost` era un `@switch` de seis ramas con los seis
 * componentes importados a mano, exactamente lo que el registro viene a
 * eliminar. Hoy sólo conserva lo que es **suyo** — traducir el contrato
 * histórico `widget`/`data` al contrato genérico del motor
 * (`type`/`config`/`data`) y pintar la clase de ancho en la grilla, que es
 * una decisión del panel y no del motor de render.
 *
 * El `@switch`, los seis imports y `SUPPORTED_WIDGET_TYPES` desaparecieron:
 * el tipo sale por `[type]`, el registro devuelve el componente y el
 * `<app-render-host>` lo monta. Añadir un widget ⇒ carpeta + descriptor +
 * una línea en `widgets/descriptors.ts` (R3.8).
 *
 * Nota sobre la accesibilidad: los widgets no llevan `aria-live`. Cada uno
 * ya publica su propio estado (`role="img"` con resumen, `data-testid`,
 * texto visible) y envolver el outlet entero en un `aria-live` anunciaría
 * el panel completo con cada actualización de datos.
 */
@Component({
  selector: 'app-widget-host',
  imports: [RenderHost],
  host: {
    '[class]': 'gridSpanClass()',
  },
  template: `
    <app-render-host kind="widget" [type]="widget().type" [config]="widget()" [data]="data()" />
  `,
})
export class WidgetHost {
  readonly widget = input.required<WidgetSchema>();
  readonly data = input<unknown>(null);

  /** `sm:col-span-*` del panel: ancho en la grilla de 12 columnas (literales: Tailwind v4 es JIT). */
  protected readonly gridSpanClass = computed(() => {
    const w = this.widget().width;
    switch (w) {
      case 12:
        return 'col-span-12 block';
      case 8:
        return 'col-span-12 lg:col-span-8 block';
      case 6:
        return 'col-span-12 sm:col-span-6 block';
      case 4:
        return 'col-span-12 sm:col-span-6 lg:col-span-4 block';
      case 3:
        return 'col-span-12 sm:col-span-6 lg:col-span-3 block';
      default:
        return 'col-span-12 sm:col-span-6 lg:col-span-4 block';
    }
  });
}
