import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { Sidebar } from '../sidebar/sidebar';

/** Esqueleto de la app autenticada: sidebar + área principal con outlet. */
@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, Sidebar],
  template: `
    <div class="flex min-h-screen bg-neutral/5">
      <app-sidebar />
      <main class="min-w-0 flex-1 p-6 lg:p-8">
        <router-outlet />
      </main>
    </div>
  `,
})
export class Layout {}
