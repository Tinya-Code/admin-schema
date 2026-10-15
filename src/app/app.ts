import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { NotificationService } from '@tinya-code/gas-admin-ui';
import { ConfirmDialog } from '@tinya-code/gas-admin-ui';
import { Toast } from '@tinya-code/gas-admin-ui';

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
