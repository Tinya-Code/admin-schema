import { TestBed } from '@angular/core/testing';

import { ThemeService } from './theme.service';

/**
 * jsdom no implementa `matchMedia`, así que se instala un doble controlable
 * antes de cualquier construcción del servicio: `matches` decide el estado
 * del sistema y `listeners` permite disparar el cambio en vivo.
 */
describe('ThemeService — 8.6 selector Sistema / Claro / Oscuro', () => {
  let matches = false;
  const listeners: Array<() => void> = [];

  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes('prefers-color-scheme') && matches,
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  });

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-mode');
    matches = false;
    listeners.length = 0;
  });

  const fireSystemChange = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  it('arranca en «system» cuando no hay elección guardada', () => {
    const theme = new ThemeService();

    expect(theme.mode()).toBe('system');
    expect(theme.resolved()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(document.documentElement.dataset['themeMode']).toBe('system');
  });

  it('una elección corrupta en localStorage vuelve a «system»', () => {
    localStorage.setItem('admin-theme', 'naranja');

    expect(new ThemeService().mode()).toBe('system');
  });

  it('aplica y persiste una elección concreta', () => {
    const theme = new ThemeService();

    theme.set('dark');

    expect(theme.mode()).toBe('dark');
    expect(theme.resolved()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(document.documentElement.dataset['themeMode']).toBe('dark');
    expect(localStorage.getItem('admin-theme')).toBe('dark');
  });

  it('recupera la elección guardada al arrancar y pinta ese modo', () => {
    matches = true;
    localStorage.setItem('admin-theme', 'light');

    const theme = new ThemeService();

    expect(theme.mode()).toBe('light');
    expect(theme.resolved()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('«system» reacciona en vivo a un cambio del tema del sistema', () => {
    const theme = new ThemeService();
    expect(theme.resolved()).toBe('light');

    matches = true;
    fireSystemChange();

    expect(theme.resolved()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('ignora el SO cuando la elección es concreta', () => {
    const theme = new ThemeService();
    theme.set('light');

    matches = true;
    fireSystemChange();

    expect(theme.resolved()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('queda disponible por DI como servicio raíz', () => {
    expect(TestBed.inject(ThemeService)).toBeTruthy();
  });
});
