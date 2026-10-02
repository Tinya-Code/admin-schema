import { Component, input, output } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info';

/** Estructuralmente idéntico a `core`'s `Toast` — no importa `core`. */
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

/**
 * Contenedor visual de toasts: fijo arriba a la derecha, región `status`
 * viva (polite) para que se anuncien los mensajes. Recibe los toasts por
 * `input()` desde quien sí tiene `NotificationService` (Fase 7).
 */
@Component({
  selector: 'app-toast',
  host: {
    class: 'pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-2',
    role: 'status',
    'aria-live': 'polite',
  },
  template: `
    @for (toast of toasts(); track toast.id) {
      <div
        class="pointer-events-auto flex items-start gap-3 border-l-4 bg-white p-4 shadow-lg"
        [class.border-l-success]="toast.kind === 'success'"
        [class.border-l-danger]="toast.kind === 'error'"
        [class.border-l-primary]="toast.kind === 'info'"
      >
        <span
          class="mt-1.5 size-2 shrink-0 rounded-full"
          [class.bg-success]="toast.kind === 'success'"
          [class.bg-danger]="toast.kind === 'error'"
          [class.bg-primary]="toast.kind === 'info'"
          aria-hidden="true"
        ></span>
        <p class="flex-1 text-sm font-medium">{{ toast.message }}</p>
        <button
          type="button"
          class="rounded p-1 text-neutral hover:bg-neutral/10 focus-visible:outline-2 focus-visible:outline-primary"
          [attr.aria-label]="closeLabel()"
          (click)="dismissed.emit(toast.id)"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    }
  `,
})
export class Toast {
  readonly toasts = input<ToastItem[]>([]);
  readonly closeLabel = input('Close');
  readonly dismissed = output<number>();
}
