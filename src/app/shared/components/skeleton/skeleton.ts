import { Component, computed, input } from '@angular/core';

/**
 * Bloque de carga decorativo: oculto para lectores (`aria-hidden`); la
 * región que lo contiene debe exponer `aria-busy="true"`.
 */
@Component({
  selector: 'app-skeleton',
  host: { class: 'block space-y-2', 'aria-hidden': 'true' },
  template: `
    @for (line of lineCount(); track line) {
      <div
        class="animate-pulse rounded bg-neutral/15"
        [style.height.px]="height()"
        [style.width]="width()"
      ></div>
    }
  `,
})
export class Skeleton {
  /** Cantidad de barras (mínimo 1). */
  readonly lines = input(1);
  readonly height = input(16);
  readonly width = input('100%');

  readonly lineCount = computed(() => {
    const lines = Math.floor(this.lines());
    const count = Number.isFinite(lines) && lines > 0 ? lines : 1;
    return Array.from({ length: count }, (_, index) => index);
  });
}
