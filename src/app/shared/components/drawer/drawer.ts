import {
  Component,
  ElementRef,
  OnDestroy,
  afterRenderEffect,
  computed,
  input,
  output,
  viewChild,
} from '@angular/core';
import { LucideX } from '@lucide/angular';

import { FOCUSABLE, isVisibleNow } from '../../utils/dialog-focus';

/** Ancho del panel: `sm` para 1–3 campos, `md`/`lg` para formularios. */
export type DrawerSize = 'sm' | 'md' | 'lg';

const WIDTHS: Record<DrawerSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

let titleCounter = 0;

/**
 * Panel lateral (drawer) — guía §5: «edición rápida de pocos campos: panel
 * lateral en lugar de pantalla nueva, para no perder contexto».
 *
 * Sigue el mismo contrato que `modal`: `role="dialog"` con nombre por
 * `aria-labelledby`, foco al abrirse y restaurado al cerrarse, Escape y el
 * fondo cierran. Además ATRAPA el Tab dentro del panel: sin eso un modal se
 * puede tabular hacia la página de atrás y el foco se pierde detrás del
 * fondo oscuro.
 *
 * Componente tonto: `open`/`title` entran por `input()` y el estado vive
 * fuera. El cuerpo se proyecta en el área con scroll y el pie con el
 * atributo `drawer-actions`.
 */
@Component({
  selector: 'app-drawer',
  imports: [LucideX],
  host: {
    '(document:keydown.escape)': 'onEscape()',
    // Angular arma la tecla CON sus modificadores y exige igualdad exacta:
    // sin esta segunda entrada, Shift+Tab llega como `shift.tab`, no casa con
    // `tab` y el foco escapa del panel hacia atrás.
    '(document:keydown.tab)': 'onTab($event)',
    '(document:keydown.shift.tab)': 'onTab($event)',
  },
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50">
        <div class="absolute inset-0 bg-black/50" aria-hidden="true" (click)="close.emit()"></div>
        <section
          #dialog
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="titleId"
          tabindex="-1"
          class="absolute inset-y-0 right-0 flex w-full flex-col bg-surface-raised shadow-2xl focus:outline-none"
          [class]="widthClass()"
        >
          <header
            class="flex items-start justify-between gap-4 border-b border-neutral/20 px-5 py-4"
          >
            <div>
              <h2 [id]="titleId" class="font-display text-section font-semibold">{{ title() }}</h2>
              @if (subtitle(); as subtitleText) {
                <p class="mt-1 text-sm text-neutral/70">{{ subtitleText }}</p>
              }
            </div>
            <button
              type="button"
              class="rounded p-1 text-neutral hover:bg-neutral/10 focus-visible:outline-2 focus-visible:outline-primary"
              [attr.aria-label]="closeLabel()"
              (click)="close.emit()"
            >
              <svg lucideX size="18" />
            </button>
          </header>

          <div class="flex-1 overflow-y-auto px-5 py-4">
            <ng-content />
          </div>

          <div class="border-t border-neutral/20 px-5 py-4">
            <ng-content select="[drawer-actions]" />
          </div>
        </section>
      </div>
    }
  `,
})
export class Drawer implements OnDestroy {
  readonly open = input(false);
  readonly title = input('Editar');
  readonly subtitle = input<string | null>(null);
  readonly size = input<DrawerSize>('md');
  readonly closeLabel = input('Cerrar');
  readonly close = output<void>();

  readonly titleId = `drawer-title-${++titleCounter}`;
  readonly widthClass = computed(() => WIDTHS[this.size()]);

  private readonly dialogRef = viewChild<ElementRef<HTMLElement>>('dialog');
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
   * El consumidor puede destruir el componente con el panel todavía abierto
   * (se monta bajo un `@if`): en ese caso el effect nunca ve la transición a
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
   * Mantiene el Tab dentro del panel mientras el diálogo está abierto.
   * Recibe `Event` porque los host listeners de Angular tipean `$event` así;
   * el teclado se relee acá dentro.
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
