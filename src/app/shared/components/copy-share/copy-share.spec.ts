import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { NotificationService } from '../../../core/services/notification.service';
import { CopyShare } from './copy-share';

const URL_UNDER_TEST = 'https://ejemplo.test/p/abc123';

/**
 * `navigator.clipboard` / `navigator.share` no existen en el DOM de prueba y
 * son propiedades del prototipo en los navegadores reales: se tapan con una
 * propiedad propia configurable y se restaura el descriptor original.
 */
const OWN = new Map<string, PropertyDescriptor | undefined>();

function stubNavigator(key: 'clipboard' | 'share', value: unknown): void {
  if (!OWN.has(key)) {
    OWN.set(key, Object.getOwnPropertyDescriptor(navigator, key));
  }
  Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
}

function clearNavigator(key: 'clipboard' | 'share'): void {
  if (!OWN.has(key)) {
    OWN.set(key, Object.getOwnPropertyDescriptor(navigator, key));
  }
  Object.defineProperty(navigator, key, { value: undefined, configurable: true, writable: true });
}

function restoreNavigator(): void {
  for (const [key, descriptor] of OWN) {
    if (descriptor) {
      Object.defineProperty(navigator, key, descriptor);
    } else {
      delete (navigator as unknown as Record<string, unknown>)[key];
    }
  }
  OWN.clear();
}

describe('CopyShare', () => {
  let fixture: ComponentFixture<CopyShare>;
  let notifications: NotificationService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CopyShare] }).compileComponents();
    fixture = TestBed.createComponent(CopyShare);
    // `canShare()` es un computed SIN dependencias reactivas: se cachea en el
    // primer render. Los tests tapan `navigator` ANTES del primer detectChanges.
    fixture.componentRef.setInput('url', URL_UNDER_TEST);
    notifications = TestBed.inject(NotificationService);
  });

  afterEach(() => restoreNavigator());

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const button = (text: string): HTMLButtonElement =>
    [...root().querySelectorAll<HTMLButtonElement>('button')].find((el) =>
      el.textContent.trim().startsWith(text),
    )!;

  const messages = (): string[] => notifications.toasts().map((toast) => toast.message);

  it('copia el enlace al portapapeles y dispara la notificación de éxito', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator('clipboard', { writeText });
    fixture.detectChanges();

    button('Copiar enlace').click();
    await fixture.whenStable();

    expect(writeText).toHaveBeenCalledWith(URL_UNDER_TEST);
    expect(messages()).toContain('Mensaje copiado.');
  });

  it('copia el MENSAJE formateado completo cuando hay shareText', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator('clipboard', { writeText });
    const message = `Hola Ana, puede retirar su pedido A-100 aquí: ${URL_UNDER_TEST}`;
    fixture.componentRef.setInput('shareText', message);
    fixture.detectChanges();

    button('Copiar enlace').click();
    await fixture.whenStable();

    // El bug: sólo se escribía la URL y el saludo/referencia/PIN se perdían.
    expect(writeText).toHaveBeenCalledWith(message);
    expect(writeText).not.toHaveBeenCalledWith(URL_UNDER_TEST);
  });

  it('sin clipboard no revienta: cae al fallback y avisa si tampoco funciona', async () => {
    clearNavigator('clipboard');
    fixture.detectChanges();

    expect(() => button('Copiar enlace').click()).not.toThrow();
    await fixture.whenStable();

    expect(messages()).toContain('No se pudo copiar el mensaje.');
  });

  it('sin navigator.share no se muestra la acción de compartir nativa', () => {
    clearNavigator('share');
    fixture.detectChanges();

    const labels = [...root().querySelectorAll('button')].map((el) => el.textContent.trim());
    expect(labels).toContain('WhatsApp');
    expect(labels).not.toContain('Compartir');
  });

  it('con navigator.share se ofrece Compartir y delega en la API nativa', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator('share', share);
    fixture.detectChanges();

    button('Compartir').click();
    await fixture.whenStable();

    expect(share).toHaveBeenCalledWith({ url: URL_UNDER_TEST, text: '' });
    expect(button('WhatsApp')).toBeUndefined();
  });
});
