import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { NotificationService } from './core/services/notification.service';
import { ConfirmDialog } from './shared/components/confirm-dialog/confirm-dialog';
import { Toast } from './shared/components/toast/toast';

@Component({
  selector: 'app-root',
  imports: [ConfirmDialog, RouterOutlet, Toast],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  /** Notificaciones globales: toasts + confirmación (cualquier vista). */
  readonly notifications = inject(NotificationService);
}
