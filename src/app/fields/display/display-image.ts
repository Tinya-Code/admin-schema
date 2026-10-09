import { Component, computed, input } from '@angular/core';

import { LucideExternalLink } from '@lucide/angular';

import { Badge } from '../../shared/components/badge/badge';
import type { FieldSchema } from '../../core/models/schema.model';

/**
 * Display por defecto de `image` (R4.1 · modo `display`).
 *
 * Mismo maquetado que la rama `kind === 'image'` de `detail-view` antes de
 * R4.2: miniatura de 7×7 con enlace a la imagen completa y overlay con el
 * icono de «abrir». El `alt` sigue siendo la etiqueta del campo.
 *
 * El host ya se encarga del valor vacío (pinta `—`), así que acá la URL
 * siempre existe.
 */
@Component({
  selector: 'app-field-display-image',
  imports: [Badge, LucideExternalLink],
  template: `
    @if (chip()) {
      <!-- Paridad R4.2: la cabecera siempre mostró el valor formateado
           como chip, y para una imagen ese valor era la URL. -->
      <app-badge [label]="url()" />
    } @else {
      <a
        [href]="url()"
        target="_blank"
        rel="noopener noreferrer"
        class="group relative inline-block overflow-hidden rounded-xl border border-neutral/20 shadow-xs transition hover:border-primary"
      >
        <img
          [src]="url()"
          [alt]="field().label"
          class="h-28 w-28 object-cover transition duration-300 group-hover:scale-105"
        />
        <div
          class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100"
        >
          <svg lucideExternalLink size="18" class="text-white" />
        </div>
      </a>
    }
  `,
})
export class FieldDisplayImage {
  readonly field = input.required<FieldSchema>();
  readonly value = input<unknown>(null);
  /** `true` en la cabecera: la URL se pinta como chip compacto. */
  readonly chip = input(false);

  protected readonly url = computed(() => String(this.value()));
}
