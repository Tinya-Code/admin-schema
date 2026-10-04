import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FOCUSABLE, isVisibleNow } from '../../utils/dialog-focus';
import { Modal } from './modal';

/**
 * Fase 9.3 — contrato de foco y cierre del diálogo.
 *
 * Mismo escenario que `drawer.spec.ts`: el disparador real está fuera del
 * diálogo, así que se puede comprobar que el foco vuelve a él — también
 * cuando el consumidor destruye el componente con el diálogo todavía abierto
 * (se monta bajo un `@if`).
 */
@Component({
  template: `
    <button type="button" data-testid="trigger">Abrir</button>
    <app-modal [open]="open()" [title]="title()" (close)="open.set(false)">
      <button type="button" data-testid="body-action">Dentro del diálogo</button>
      <button type="button" data-testid="secondary-action">Cancelar</button>
    </app-modal>
  `,
  imports: [Modal],
})
class ModalHost {
  readonly open = signal(false);
  readonly title = signal('Confirmar borrado');
}

describe('Modal — 9.3: foco, Escape y restauración', () => {
  let fixture: ComponentFixture<ModalHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ModalHost] }).compileComponents();
    fixture = TestBed.createComponent(ModalHost);
    fixture.detectChanges();
  });

  const dialog = (): HTMLElement | null => fixture.nativeElement.querySelector('[role="dialog"]');
  const trigger = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('[data-testid="trigger"]');

  const open = async (): Promise<void> => {
    trigger().focus();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('cerrado no hay diálogo; abierto hay uno con nombre y aria-modal', async () => {
    expect(dialog()).toBeNull();

    await open();

    const panel = dialog();
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('aria-modal')).toBe('true');
    const labelledBy = panel!.getAttribute('aria-labelledby');
    expect(document.getElementById(labelledBy!)?.textContent).toContain('Confirmar borrado');
  });

  it('Escape y el botón ✕ piden cerrar', async () => {
    await open();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.open()).toBe(false);

    await open();
    (fixture.nativeElement.querySelector('[aria-label="Cerrar"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('el clic en el fondo pide cerrar', async () => {
    await open();

    (fixture.nativeElement.querySelector('.absolute.inset-0') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('el foco entra al abrir y vuelve al disparador al cerrar', async () => {
    await open();
    expect(dialog()!.contains(document.activeElement)).toBe(true);

    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(trigger());
  });

  it('destruirse con el diálogo abierto devuelve el foco (no se pierde detrás del fondo)', async () => {
    await open();
    expect(document.activeElement).toBe(dialog());

    // Es lo que pasa cuando el consumidor lo monta bajo un `@if` y borra el
    // nodo sin que la señal pase por `false`: el effect no llega a correr.
    fixture.componentInstance.open.set(false);
    fixture.destroy();

    expect(document.activeElement).toBe(trigger());
  });

  it('el Tab queda atrapado: del último salta al primero', async () => {
    await open();

    const focusable = Array.from(
      dialog()!.querySelectorAll<HTMLElement>('button, [href], input, select, textarea'),
    );
    expect(focusable.length).toBeGreaterThan(1);

    const last = focusable[focusable.length - 1];
    last.focus();
    expect(document.activeElement).toBe(last);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(focusable[0]);
  });

  it('el Shift+Tab queda atrapado: del primero salta al último', async () => {
    await open();

    const focusable = Array.from(
      dialog()!.querySelectorAll<HTMLElement>('button, [href], input, select, textarea'),
    );
    expect(focusable.length).toBeGreaterThan(1);

    // Diagnóstico: la lista que ve el trap debe ser la misma que la del test
    // (si divergen, el selector de `FOCUSABLE` y el del test dejan de
    // describir el mismo conjunto de elementos).
    expect(
      Array.from(dialog()!.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisibleNow),
      'el selector del trap difiere del del test',
    ).toEqual(focusable);

    const first = focusable[0];
    first.focus();
    expect(document.activeElement).toBe(first);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, shiftKey: true }),
    );

    expect(document.activeElement).toBe(focusable[focusable.length - 1]);
  });
});
