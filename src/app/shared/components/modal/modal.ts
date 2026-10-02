import { Component, ElementRef, afterRenderEffect, input, output, viewChild } from '@angular/core';

let titleCounter = 0;

/**
 * Diálogo modal accesible: `aria-modal` con nombre por `aria-labelledby`,
 * foco al abrirse, foco restaurado al cerrarse, Escape y botón ✕ cierran.
 * El clic en el fondo es un atajo para puntero; el teclado usa ✕ o Escape.
 * Componente tonto: `open`/`title` entran por `input()`, el estado vive fuera.
 */
@Component({
  selector: 'app-modal',
  host: { '(document:keydown.escape)': 'onEscape()' },
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
          class="relative w-full max-w-lg rounded-xl bg-white p-6 shadow-xl focus:outline-none"
        >
          <div class="mb-4 flex items-start justify-between gap-4">
            <h2 [id]="titleId" class="font-display text-lg font-semibold">
              {{ title() }}
            </h2>
            <button
              type="button"
              class="rounded p-1 text-neutral hover:bg-neutral/10 focus-visible:outline-2 focus-visible:outline-primary"
              [attr.aria-label]="closeLabel()"
              (click)="close.emit()"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <ng-content />
        </div>
      </div>
    }
  `,
})
export class Modal {
  readonly open = input(false);
  readonly title = input.required<string>();
  readonly closeLabel = input('Close');
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

  onEscape(): void {
    if (this.open()) {
      this.close.emit();
    }
  }
}
