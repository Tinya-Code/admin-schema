import { Directive, InjectionToken, computed, inject, type Signal } from '@angular/core';

/**
 * Contexto de accesibilidad que `app-field-host` expone a los controles.
 *
 * El host conoce la ayuda y el error (ambos viven en SU plantilla), pero el
 * `<input>` real vive dentro de un componente hijo distinto por cada tipo de
 * campo. En lugar de pasar dos inputs por cada uno de los 14 controles, el
 * host provee este contexto y cada control importa `FieldAria`, que lo lee
 * por DI y lo vuelca en el elemento.
 *
 * Selector por `[id]`: casa sólo con el elemento que ya recibe el `for` de la
 * etiqueta, así el mismo id es ancla de label y de `aria-describedby`. Los
 * controles fuera de un `app-field-host` inyectan `null` y no emiten nada.
 */
export interface FieldAriaContext {
  /** `id` del texto de ayuda y/o del error, separados por espacio. */
  readonly describedBy: Signal<string | null>;
  /** `true` cuando el campo muestra error visible (mismo criterio que el mensaje). */
  readonly invalid: Signal<boolean>;
  /**
   * Requerido por schema. Necesario porque la marca visual `*` desaparece en
   * los recursos donde mandan los `(opcional)` (§2): sin este atributo el
   * requerimiento quedaría sólo en pantalla.
   */
  readonly required: Signal<boolean>;
}

export const FIELD_ARIA = new InjectionToken<FieldAriaContext>('FIELD_ARIA');

/**
 * Vincula `aria-invalid` y `aria-describedby` a un control de formulario.
 *
 * `aria-invalid` se emite SIEMPRE (`"true"`/`"false"`, nunca ausente) para
 * que el atributo sea inspeccionable en cualquier estado; `aria-describedby`
 * se omite cuando no hay ni ayuda ni error, que es el caso por defecto.
 * `aria-required` sigue la misma regla que `aria-invalid`.
 *
 * Convención con `role="alert"` en el mensaje de error: el `alert` anuncia el
 * error en el momento en que aparece (fallo de submit), mientras que
 * `aria-describedby` lo lee al enfocar el campo. Son momentos distintos; no
 * compiten.
 */
@Directive({
  selector: 'input[id], select[id], textarea[id], output[id]',
  host: {
    '[attr.aria-invalid]': 'ariaInvalid()',
    '[attr.aria-required]': 'ariaRequired()',
    '[attr.aria-describedby]': 'ariaDescribedBy()',
  },
})
export class FieldAria {
  private readonly ctx = inject(FIELD_ARIA, { optional: true });

  protected readonly ariaInvalid = computed(() => (this.ctx ? String(this.ctx.invalid()) : null));

  protected readonly ariaRequired = computed(() => (this.ctx ? String(this.ctx.required()) : null));

  protected readonly ariaDescribedBy = computed(() => this.ctx?.describedBy() ?? null);
}
