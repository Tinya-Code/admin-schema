import { Component, computed, input } from '@angular/core';

export type BadgeKind = 'success' | 'danger' | 'info' | 'neutral';

const KINDS: Record<BadgeKind, string> = {
  success: 'bg-success text-white',
  danger: 'bg-danger text-white',
  info: 'bg-primary text-white',
  neutral: 'bg-neutral text-white',
};

/** Etiqueta compacta (booleanos, estados). Texto blanco: WCAG AA en los 4 tonos. */
@Component({
  selector: 'app-badge',
  host: { '[class]': 'classes()' },
  template: `{{ label() }}`,
})
export class Badge {
  readonly label = input.required<string>();
  readonly kind = input<BadgeKind>('neutral');

  readonly classes = computed(
    () =>
      `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${KINDS[this.kind()]}`,
  );
}
