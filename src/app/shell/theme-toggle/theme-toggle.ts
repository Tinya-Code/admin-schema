import { Component, inject } from '@angular/core';
import { LucideMonitor, LucideMoon, LucideSun } from '@lucide/angular';

import { ThemeService, type ThemeMode } from '../../core/services/theme.service';

const BASE =
  'rounded-md p-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const ACTIVE = 'bg-primary/10 text-primary';
const IDLE = 'text-neutral hover:bg-neutral/10';

/**
 * Selector de tema de tres posiciones: Sistema / Claro / Oscuro (§8.6).
 *
 * Van tres `<button>` con `aria-pressed` y no un `role="radiogroup"`: un
 * radiogroup exige navegación con flechas para cumplir su contrato, mientras
 * que tres botones ya son operables con Tab + Enter/Space y el lector de
 * pantalla anuncia "presionado / no presionado" en cada uno. Es la opción
 * con menos JS y sin degradar el teclado.
 *
 * Sólo icono, con `aria-label` y `title` para no ocupar ancho en la cabecera
 * de la sidebar (240 px).
 */
@Component({
  selector: 'app-theme-toggle',
  imports: [LucideMonitor, LucideSun, LucideMoon],
  template: `
    <div
      role="group"
      aria-label="Tema del panel"
      class="inline-flex items-center gap-0.5 rounded-lg border border-neutral/20 bg-surface p-0.5"
    >
      <button
        type="button"
        [class]="classes('system')"
        [attr.aria-pressed]="theme.mode() === 'system'"
        aria-label="Tema: seguir al sistema"
        title="Seguir al sistema"
        (click)="theme.set('system')"
      >
        <svg lucideMonitor size="16" />
      </button>
      <button
        type="button"
        [class]="classes('light')"
        [attr.aria-pressed]="theme.mode() === 'light'"
        aria-label="Tema: claro"
        title="Tema claro"
        (click)="theme.set('light')"
      >
        <svg lucideSun size="16" />
      </button>
      <button
        type="button"
        [class]="classes('dark')"
        [attr.aria-pressed]="theme.mode() === 'dark'"
        aria-label="Tema: oscuro"
        title="Tema oscuro"
        (click)="theme.set('dark')"
      >
        <svg lucideMoon size="16" />
      </button>
    </div>
  `,
})
export class ThemeToggle {
  readonly theme = inject(ThemeService);

  classes(mode: ThemeMode): string {
    return `${BASE} ${this.theme.mode() === mode ? ACTIVE : IDLE}`;
  }
}
