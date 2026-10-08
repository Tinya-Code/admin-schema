import { Component, input } from '@angular/core';

import { LucideInfo } from '@lucide/angular';

/**
 * Degradación controlada de un tipo de campo sin renderizador (R1.10).
 *
 * El `@switch` de `field-host` NO tiene `@default`: un `type` fuera de
 * `SUPPORTED_FIELD_TYPE_LIST` no revienta el template, simplemente no pinta
 * nada. Eso cumple «nunca pantalla rota», pero deja el formulario con un
 * hueco mudo donde el operador no sabe si le falta un campo o si lo escribió
 * mal.
 *
 * Este componente es el aviso de **desarrollo**: se renderiza sólo con
 * `isDevMode()`, nombra el tipo y el campo, y deja claro que el VALOR existe
 * en el schema y se conserva — no se pierde, sólo no se pinta. En producción
 * `field-host` lo omite y deja un `console.warn`.
 *
 * No dibuja control ni etiqueta asociada: no hay `id` al que apuntar un
 * `<label for>` (mismo criterio que el bloque de `composite()` en el host).
 */
@Component({
  selector: 'app-unknown-render',
  imports: [LucideInfo],
  template: `
    <div
      class="mb-4 rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-2"
      data-field-unknown
    >
      <p class="flex items-center gap-1.5 text-xs font-medium text-amber-600">
        <svg lucideInfo size="14" class="shrink-0" aria-hidden="true" />
        Campo sin renderizador en esta versión
      </p>
      <p class="mt-1 text-help text-neutral">
        Tipo <code class="rounded bg-amber-500/20 px-1 font-mono">{{ type() }}</code>
        @if (label()) {
          del campo «{{ label() }}»
        }
        — el valor existe en el schema y se conserva; sólo no se dibuja.
      </p>
    </div>
  `,
})
export class UnknownRender {
  /** `type` declarado en el schema y fuera de `SUPPORTED_FIELD_TYPE_LIST`. */
  readonly type = input.required<string>();
  /** Rótulo del campo, para que el aviso sea ubicable en el formulario. */
  readonly label = input('');
}
