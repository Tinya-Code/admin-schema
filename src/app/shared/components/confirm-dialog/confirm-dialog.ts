import { Component, input, output } from '@angular/core';

import { Button } from '../button/button';
import { Modal } from '../modal/modal';

/**
 * Opciones del diálogo. Es estructuralmente compatible con
 * `core.NotificationService['confirmation']` (mismos campos) — `shared` no
 * importa `core`, quien une ambos lados es el shell (Fase 7).
 */
export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

@Component({
  selector: 'app-confirm-dialog',
  imports: [Modal, Button],
  template: `
    @if (options(); as opts) {
      <app-modal [open]="true" [title]="opts.title" (close)="cancelled.emit()">
        <p class="text-sm text-neutral">{{ opts.message }}</p>
        <div class="mt-6 flex justify-end gap-3">
          <button app-button variant="outline" type="button" (click)="cancelled.emit()">
            {{ opts.cancelLabel ?? 'Cancel' }}
          </button>
          <button
            app-button
            type="button"
            [variant]="danger() ? 'danger' : 'primary'"
            (click)="confirmed.emit()"
          >
            {{ opts.confirmLabel ?? 'Confirm' }}
          </button>
        </div>
      </app-modal>
    }
  `,
})
export class ConfirmDialog {
  /** `null` = oculto (viene de `NotificationService.confirmation`). */
  readonly options = input<ConfirmDialogOptions | null>(null);
  readonly danger = input(false);
  readonly confirmed = output<void>();
  readonly cancelled = output<void>();
}
