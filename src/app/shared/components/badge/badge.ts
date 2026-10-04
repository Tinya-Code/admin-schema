import { Component, computed, input } from '@angular/core';

export type BadgeKind = 'success' | 'danger' | 'info' | 'neutral';

const KINDS: Record<BadgeKind, string> = {
  success: 'bg-success text-surface',
  danger: 'bg-danger text-surface',
  info: 'bg-primary text-surface',
  neutral: 'bg-neutral text-surface',
};

/**
 * Etiqueta compacta (booleanos, estados).
 *
 * El texto va con `text-surface` y no `text-white` porque el fondo lo da
 * el token y en oscuro se aclara: blanco sobre `--color-danger` oscuro
 * sería 2,8:1. `--color-surface` vale #fff en claro, así que el render
 * actual no cambia, y en oscuro el texto se vuelve oscuro sobre el tono
 * aclarado (6,4–9,2:1).
 */
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
