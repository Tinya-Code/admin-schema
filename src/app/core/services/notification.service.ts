import { Service, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * Notificaciones de la app: toasts (señales, se renderizan en `app-toast`,
 * Fase 5) y un diálogo de confirmación con respuesta como `Promise`
 * (base.md §10: borrado con confirmación, aviso de cambios sin guardar).
 */
@Service()
export class NotificationService {
  readonly toasts = signal<Toast[]>([]);
  /** Confirmación en curso; `null` = sin diálogo. */
  readonly confirmation = signal<ConfirmOptions | null>(null);

  private nextId = 1;
  private pendingResolve: ((accepted: boolean) => void) | null = null;

  success(message: string): void {
    this.push('success', message);
  }

  error(message: string): void {
    this.push('error', message);
  }

  info(message: string): void {
    this.push('info', message);
  }

  dismiss(id: number): void {
    this.toasts.update((toasts) => toasts.filter((toast) => toast.id !== id));
  }

  /** Abre el diálogo de confirmación y espera la respuesta del usuario. */
  confirm(options: ConfirmOptions): Promise<boolean> {
    // Solo una confirmación a la vez: la anterior se responde como rechazo.
    this.pendingResolve?.(false);
    this.confirmation.set(options);
    return new Promise<boolean>((resolve) => {
      this.pendingResolve = resolve;
    });
  }

  /** Resuelve la confirmación pendiente (lo llama el componente de diálogo, Fase 5). */
  resolveConfirmation(accepted: boolean): void {
    this.confirmation.set(null);
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    resolve?.(accepted);
  }

  private push(kind: ToastKind, message: string): void {
    const id = this.nextId++;
    this.toasts.update((toasts) => [...toasts, { id, kind, message }]);
    if (kind !== 'error') {
      setTimeout(() => this.dismiss(id), 4000);
    }
  }
}
