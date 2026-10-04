import { Component, input, output } from '@angular/core';
import { LucideCircleCheck, LucideCircleX, LucideInfo, LucideX } from '@lucide/angular';

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
  imports: [LucideCircleCheck, LucideCircleX, LucideInfo, LucideX],
  host: {
    class: 'pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-2',
    role: 'status',
    'aria-live': 'polite',
  },
  template: `
    @for (toast of toasts(); track toast.id) {
      <div
        class="pointer-events-auto flex items-start gap-3 border-l-4 bg-surface-raised p-4 shadow-lg"
        [class.border-l-success]="toast.kind === 'success'"
        [class.border-l-danger]="toast.kind === 'error'"
        [class.border-l-primary]="toast.kind === 'info'"
      >
        @if (toast.kind === 'success') {
          <svg lucideCircleCheck size="18" class="mt-0.5 shrink-0 text-success" />
        } @else if (toast.kind === 'error') {
          <svg lucideCircleX size="18" class="mt-0.5 shrink-0 text-danger" />
        } @else {
          <svg lucideInfo size="18" class="mt-0.5 shrink-0 text-primary" />
        }
        <p class="flex-1 text-sm font-medium">{{ toast.message }}</p>
        <button
          type="button"
          class="rounded p-1 text-neutral hover:bg-neutral/10 focus-visible:outline-2 focus-visible:outline-primary"
          [attr.aria-label]="closeLabel()"
          (click)="dismissed.emit(toast.id)"
        >
          <svg lucideX size="18" />
        </button>
      </div>
    }
  `,
})
export class Toast {
  readonly toasts = input<ToastItem[]>([]);
  readonly closeLabel = input('Cerrar');
  readonly dismissed = output<number>();
}
