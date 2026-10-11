import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { Button } from '../../shared/components/button/button';
import { Sidebar } from '../sidebar/sidebar';

/**
 * Esqueleto de la app autenticada: sidebar + área principal con outlet.
 *
 * Responsive: en pantallas chicas la sidebar es **offcanvas** (detrás de un
 * botón hamburguesa + backdrop); desde `lg` vuelve a ser estática y siempre
 * visible (clases `lg:*` del propio aside ganan sobre el estado `open`).
 */
@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, Sidebar, Button],
  template: `
    <div class="flex min-h-screen bg-neutral/5">
      <button
        app-button
        type="button"
        variant="outline"
        size="icon"
        class="fixed top-[calc(env(safe-area-inset-top)+0.75rem)] left-3 z-40 shadow-md lg:hidden"
        [attr.aria-expanded]="sidebarOpen()"
        aria-controls="main-sidebar"
        aria-label="Abrir menú"
        (click)="sidebarOpen.set(true)"
      >
        <svg
          aria-hidden="true"
          class="size-5"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      @if (sidebarOpen()) {
        <div
          class="fixed inset-0 z-30 bg-black/30 lg:hidden"
          aria-hidden="true"
          (click)="sidebarOpen.set(false)"
        ></div>
      }
      <app-sidebar id="main-sidebar" [(open)]="sidebarOpen" />
      <!-- pt reafirmado en sm: sin esto la variante sm:p-6 (va después en la
           cascada) pisa el pt-16 base y el contenido choca con la hamburguesa.
           base/sm dejan pasar el safe-area del notch; en lg no hay hamburguesa. -->
      <main
        class="min-w-0 flex-1 p-4 pt-[calc(4rem+env(safe-area-inset-top))] sm:p-6 sm:pt-[calc(4rem+env(safe-area-inset-top))] lg:p-8"
      >
        <router-outlet />
      </main>
    </div>
  `,
})
export class Layout {
  /** Estado del offcanvas en mobile; en `lg` la sidebar es estática (siempre visible). */
  readonly sidebarOpen = signal(false);
}
