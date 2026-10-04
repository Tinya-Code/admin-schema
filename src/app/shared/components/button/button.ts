import { Component, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'outline' | 'danger' | 'ghost';

const BASE =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-surface hover:bg-primary/90',
  outline: 'border border-neutral/40 bg-surface text-neutral hover:bg-neutral/10',
  danger: 'bg-danger text-surface hover:bg-danger/90',
  ghost: 'text-neutral hover:bg-neutral/10',
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
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input(false);
  readonly loading = input(false);

  readonly classes = computed(() => `${BASE} ${VARIANTS[this.variant()]}`);
}
