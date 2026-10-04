import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { Drawer } from './drawer';

/** Disparador real: el foco tiene que volver a él al cerrar. */
@Component({
  template: `
    <button type="button" data-testid="trigger">Abrir</button>
    <app-drawer [open]="open()" [title]="title()" (close)="open.set(false)">
      <button type="button" data-testid="body-action">Dentro del cuerpo</button>
      <div drawer-actions>
        <button type="button" data-testid="footer-action">Guardar</button>
      </div>
    </app-drawer>
  `,
  imports: [Drawer],
})
class DrawerHost {
  readonly open = signal(false);
  readonly title = signal('Panel de prueba');
}

describe('Drawer', () => {
  let fixture: ComponentFixture<DrawerHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DrawerHost] }).compileComponents();
    fixture = TestBed.createComponent(DrawerHost);
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
    expect(document.getElementById(labelledBy!)?.textContent).toContain('Panel de prueba');
  });

  it('Escape y el clic en el fondo piden cerrar', async () => {
    await open();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.open()).toBe(false);

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

  it('destruirse con el panel abierto devuelve el foco (no se pierde detrás del fondo)', async () => {
    await open();
    expect(dialog()!.contains(document.activeElement)).toBe(true);

    // Es lo que pasa cuando el consumidor lo monta bajo un @if y borra el
    // nodo sin que la señal pase por `false`.
    fixture.componentInstance.open.set(false);
    fixture.destroy();

    expect(document.activeElement).toBe(trigger());
  });

  it('el Tab queda atrapado: del último salta al primero', async () => {
    await open();

    const focusable = Array.from(
      dialog()!.querySelectorAll<HTMLElement>('button, [href], input, select, textarea'),
    );
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

    // Angular iguala `fullKey` contra la tecla armada con los modificadores:
    // sin el binding `keydown.shift.tab` este evento no llega al trap.
    const first = focusable[0];
    first.focus();
    expect(document.activeElement).toBe(first);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, shiftKey: true }),
    );
    expect(document.activeElement).toBe(focusable[focusable.length - 1]);
  });
});
