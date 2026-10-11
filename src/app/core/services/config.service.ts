import { inject, Service, signal } from '@angular/core';
import { catchError, firstValueFrom, forkJoin, of } from 'rxjs';

import { ApiService } from './api.service';
import type { ResourceEndpoints } from '../models/schema.model';

/**
 * Servicio global de configuración: reúne los singletons declarativos y los
 * deja disponibles para interpolación de plantillas (enlaces públicos,
 * mensajes para compartir).
 *
 * Es genérico a propósito: NO conoce ningún singleton concreto. Los
 * endpoints los inyecta `app.config.ts` con `provideAppInitializer`,
 * derivándolos del registry — agregar un singleton de configuración nuevo
 * = declarar su schema, sin tocar este fichero (refactormotor.md §1 — el
 * schema es el único plano de control).
 *
 * No hay efectos en el constructor: la carga es explícita (`load`), así un
 * TestBed que sólo provee un ApiService parcial no recibe una llamada
 * síncrona a `get` durante la construcción.
 */
@Service()
export class ConfigService {
  private readonly api = inject(ApiService, { optional: true });

  /** Mapa reactivo de configuración global (p. ej. `public_base_url`). */
  readonly globalConfig = signal<Record<string, unknown>>({
    // Fallback genérico: el origen actual. Lo que declare el singleton
    // (p. ej. `share_message_template`) lo pone el backend, no el front.
    public_base_url: typeof window !== 'undefined' ? window.location.origin : '',
  });

  /** Endpoints conocidos; los guarda `load` para que `ensureLoaded` pueda reintentar. */
  private endpoints: readonly ResourceEndpoints[] = [];

  /**
   * `true` cuando la última carga terminó SIN fallos. Si algún singleton
   * falló (o ninguno respondió), queda `false` y el próximo punto crítico
   * vuelve a intentar: no hay estado «cargado a medias para siempre».
   */
  private loaded = false;

  /** Carga en curso: `ensureLoaded` la reutiliza en vez de duplicar viajes. */
  private inFlight: Promise<void> | null = null;

  /**
   * Carga todos los endpoints de configuración recibidos. Silenciosa: un
   * singleton que falle o que devuelva vacío no rompe nada, simplemente no
   * aporta claves (y deja `loaded = false` para poder reintentar).
   */
  load(endpoints: readonly ResourceEndpoints[]): void {
    this.endpoints = endpoints;
    void this.ensure();
  }

  /**
   * Garantiza la config global antes de un punto que la necesita.
   *
   * El load del bootstrap NO es bloqueante y sólo intenta una vez: si la app
   * arrancó sin sesión (el 401 de los singletons se traga en el `catchError`)
   * o la red tardó, la sesión seguía con la config vacía y, por ejemplo, el
   * mensaje de `copy-share` degradaba a «sólo la URL» (R8.7). Acá el reintento
   * corre con la sesión ya iniciada y responde bien; si ya se cargó, es un
   * no-op síncrono.
   */
  ensureLoaded(): Promise<void> {
    return this.ensure();
  }

  private ensure(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    if (!this.api || typeof this.api.get !== 'function' || this.endpoints.length === 0) {
      return Promise.resolve();
    }

    this.inFlight = firstValueFrom(
      forkJoin(
        this.endpoints.map((endpoint) =>
          this.api!.get<Record<string, unknown>>(endpoint).pipe(
            // `null` marca el fallo: con `of({})` un singleton caído era
            // indistinguible de uno realmente vacío y la carga quedaría
            // «hecha» sin datos.
            catchError(() => of(null)),
          ),
        ),
      ),
    ).then((blocks) => {
      this.inFlight = null;
      blocks.forEach((data) => {
        if (data && typeof data === 'object' && Object.keys(data).length > 0) {
          this.globalConfig.update((current) => ({ ...current, ...data }));
        }
      });
      this.loaded = blocks.every((data) => data !== null);
    });

    return this.inFlight;
  }

  /**
   * Contexto de datos para interpolar plantillas del schema
   * (`urlTemplate`, `shareTextTemplate`, `postCreate.description`, …).
   *
   * Sólo aporta datos y la base pública — la FORMA de la URL pública
   * (`/p/{ref}`) la declara el propio schema en su `urlTemplate`; este
   * servicio no decide cómo se arma el enlace.
   */
  buildInterpolationContext(record: Record<string, unknown>): Record<string, unknown> {
    const config = this.globalConfig();
    const baseUrl = String(config['public_base_url'] || window.location.origin).replace(/\/+$/, '');

    return {
      ...config,
      ...record,
      public_base_url: baseUrl,
    };
  }
}
