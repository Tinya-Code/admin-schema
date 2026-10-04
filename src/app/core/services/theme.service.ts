import { Service, signal } from '@angular/core';

/** Los tres estados del selector (§8.6). */
export type ThemeMode = 'system' | 'light' | 'dark';

/** Lo que acaba pintado en `<html data-theme>`. */
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'admin-theme';
const QUERY = '(prefers-color-scheme: dark)';
const MODES: string[] = ['system', 'light', 'dark'];

/** Lee la elección guardada; cualquier basura vuelve a `system`. */
function storedMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw !== null && MODES.includes(raw) ? (raw as ThemeMode) : 'system';
  } catch {
    // localStorage puede tirar en modo privado o con cuota agotada.
    return 'system';
  }
}

/**
 * `system` → lo que diga el sistema operativo.
 * jsdom no implementa `matchMedia`: sin él se asume claro, que es además
 * el estado por defecto antes de que corra el script de `index.html`.
 */
function prefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

function resolve(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? (prefersDark() ? 'dark' : 'light') : mode;
}

/**
 * Selector de tema con tres estados: `system`, `light`, `dark` (Fase 8.6).
 *
 * `system` NO se traduce en CSS con una media query sino que se resuelve a
 * un valor concreto, porque con tres estados un único `prefers-color-scheme`
 * no alcanza para distinguir "oscuro elegido a mano" de "oscuro heredado".
 *
 * El arranque sin flash vive en `index.html`: un script síncrono en el
 * `<head>` escribe `data-theme` y `data-theme-mode` antes del primer
 * pintado. Este servicio toma el relevo después y además escucha cambios
 * en vivo del sistema, para que cambiar el tema del SO con la app abierta
 * la recoloree — pero sólo mientras la elección siga siendo `system`: si el
 * usuario eligió un modo concreto, el SO deja de mandar.
 */
@Service()
export class ThemeService {
  /** Elección persistida. */
  readonly mode = signal<ThemeMode>(storedMode());
  /** Lo que está pintado ahora mismo. */
  readonly resolved = signal<ResolvedTheme>(resolve(this.mode()));

  constructor() {
    this.apply();

    const media = typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
    media?.addEventListener('change', () => {
      if (this.mode() === 'system') {
        this.apply();
      }
    });
  }

  set(mode: ThemeMode): void {
    this.mode.set(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Sin persistencia el tema sigue funcionando durante la sesión.
    }
    this.apply();
  }

  /** Escribe el resultado en `<html>`; es lo que lee `theme.css`. */
  private apply(): void {
    const resolved = resolve(this.mode());
    this.resolved.set(resolved);
    document.documentElement.dataset['theme'] = resolved;
    document.documentElement.dataset['themeMode'] = this.mode();
  }
}
