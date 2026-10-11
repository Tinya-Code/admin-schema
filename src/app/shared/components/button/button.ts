import { Component, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'outline' | 'danger' | 'ghost';
export type ButtonSize = 'md' | 'sm' | 'icon';

const BASE =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-surface hover:bg-primary/90',
  outline: 'border border-neutral/40 bg-surface text-neutral hover:bg-neutral/10',
  danger: 'bg-danger text-surface hover:bg-danger/90',
  ghost: 'text-neutral hover:bg-neutral/10',
};

/**
 * Tamaño: el padding y el tip-size viven AQUÍ, no en `BASE`. Dos botones
 * con la misma propiedad (px-4 vs px-2) los resolvería el orden del CSS
 * generado, no el código — el motivo por el que los chips del textarea
 * acabaron con `!important`.
 *
 * Mobile-first: todas arrancan en `min-h-11` (44 px, objetivo táctil de la
 * guía mobile §8.2) y en `lg` relajan al tamaño de escritorio, así el mismo
 * componente cumple la guía táctil sin engordar la UI de escritorio.
 *  - `md`   → botón de texto (Guardar, Cancelar…)
 *  - `sm`   → chips y acciones compactas (texto `xs`)
 *  - `icon` → sólo glifo, cuadrado (toolbars de filas, arrastre)
 */
const SIZES: Record<ButtonSize, string> = {
  md: 'px-4 py-2 text-sm min-h-11 lg:min-h-0',
  sm: 'px-2 py-1 text-xs min-h-11 lg:min-h-0',
  icon: 'p-1 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0',
};

/**
 * Botón nativo (selector por atributo, patrón Material `button[mat-button]`):
 * conserva semántica y estilos de `<button>` y las clases del consumidor.
 */
@Component({
  selector: 'button[app-button]',
  host: {
    '[class]': 'classes()',
    '[type]': 'type()',
    '[disabled]': 'disabled() || loading()',
    '[attr.aria-busy]': 'loading() || null',
  },
  template: `
    @if (loading()) {
      <span
        class="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        aria-hidden="true"
      ></span>
    }
    <ng-content />
  `,
})
export class Button {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input(false);
  readonly loading = input(false);

  readonly classes = computed(() => `${BASE} ${VARIANTS[this.variant()]} ${SIZES[this.size()]}`);
}
