import {
  Component,
  ElementRef,
  OnDestroy,
  afterRenderEffect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { LucideX } from '@lucide/angular';

import { FOCUSABLE, isVisibleNow } from '../../utils/dialog-focus';

let titleCounter = 0;

/**
 * Diálogo modal accesible: `aria-modal` con nombre por `aria-labelledby`,
 * foco al abrirse y restaurado al cerrarse — también si el consumidor lo
 * destruye con el diálogo todavía abierto — Escape y botón ✕ cierran.
 *
 * ATRAPA el Tab dentro del diálogo: sin eso el foco se tabula hacia la página
 * de atrás y se pierde detrás del fondo oscuro. Mismo contrato que `drawer`,
 * con el que comparte el selector de elementos focables.
 *
 * El clic en el fondo es un atajo para puntero; el teclado usa ✕ o Escape.
 * Componente tonto: `open`/`title` entran por `input()`, el estado vive
 * fuera.
 */
@Component({
  selector: 'app-modal',
  imports: [LucideX],
  host: {
    '(document:keydown.escape)': 'onEscape()',
    // Angular arma la tecla CON sus modificadores y exige igualdad exacta:
    // sin esta segunda entrada, Shift+Tab llega como `shift.tab`, no casa con
    // `tab` y el foco escapa del diálogo hacia atrás.
    '(document:keydown.tab)': 'onTab($event)',
    '(document:keydown.shift.tab)': 'onTab($event)',
  },
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50" aria-hidden="true" (click)="close.emit()"></div>
        <div
          #dialog
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="titleId"
          tabindex="-1"
          class="relative w-full max-w-lg rounded-xl bg-surface-raised p-6 shadow-xl focus:outline-none"
        >
          <div class="mb-4 flex items-start justify-between gap-4">
            <h2 [id]="titleId" class="font-display text-section font-semibold">
              {{ title() }}
            </h2>
            <button
              type="button"
              class="flex min-h-11 min-w-11 items-center justify-center rounded text-neutral hover:bg-neutral/10 focus-visible:outline-2 focus-visible:outline-primary lg:min-h-0 lg:min-w-0"
              [attr.aria-label]="closeLabel()"
              (click)="close.emit()"
            >
              <svg lucideX size="18" />
            </button>
          </div>
          <ng-content />
        </div>
      </div>
    }
  `,
})
export class Modal implements OnDestroy {
  readonly open = input(false);
  readonly title = input.required<string>();
  readonly closeLabel = input('Cerrar');
  readonly close = output<void>();

  readonly titleId = `modal-title-${++titleCounter}`;

  private readonly dialogRef = viewChild<ElementRef<HTMLDivElement>>('dialog');
  private lastFocused: HTMLElement | null = null;

  private readonly focusEffect = afterRenderEffect(() => {
    const open = this.open();
    const dialog = this.dialogRef();
    if (open && dialog) {
      const active = document.activeElement;
      if (active !== dialog.nativeElement && this.lastFocused === null) {
        this.lastFocused = active instanceof HTMLElement ? active : null;
      }
      dialog.nativeElement.focus();
    } else if (!open && this.lastFocused !== null) {
      this.lastFocused.focus();
      this.lastFocused = null;
    }
  });

  /**
   * El consumidor puede destruir el componente con el diálogo todavía abierto
   * (se monta bajo un `@if`): entonces el effect nunca ve la transición a
   * `false` y el foco se quedaría perdido en el body.
   */
  ngOnDestroy(): void {
    if (this.lastFocused?.isConnected) {
      this.lastFocused.focus();
    }
    this.lastFocused = null;
  }

  onEscape(): void {
    if (this.open()) {
      this.close.emit();
    }
  }

  /**
   * Mantiene el Tab dentro del diálogo mientras está abierto. Recibe `Event`
   * porque los host listeners de Angular tipean `$event` así; el teclado se
   * relee acá dentro.
   */
  onTab(rawEvent: Event): void {
    const event = rawEvent as KeyboardEvent;
    const dialog = this.dialogRef()?.nativeElement;
    if (!this.open() || !dialog) {
      return;
    }
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => isVisibleNow(element),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
