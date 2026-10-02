import { Component, input } from '@angular/core';

/**
 * Estado vacío universal (structure.md §6). El contenido proyectado es la
 * acción opcional (normalmente un `button[app-button]`).
 */
@Component({
  selector: 'app-empty-state',
  host: { role: 'status' },
  template: `
    <div
      class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-neutral/30 px-6 py-12 text-center"
    >
      <h2 class="font-display text-base font-semibold">{{ title() }}</h2>
      @if (message()) {
        <p class="text-sm text-neutral">{{ message() }}</p>
      }
      <div class="mt-2">
        <ng-content />
      </div>
    </div>
  `,
})
export class EmptyState {
  readonly title = input.required<string>();
  readonly message = input('');
}
