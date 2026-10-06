import { inject, Service, signal } from '@angular/core';
import { catchError, forkJoin, of } from 'rxjs';

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
 * = declarar su schema, sin tocar este fichero (motor-plan: el schema es el
 * único plano de control).
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

  /**
   * Carga todos los endpoints de configuración recibidos. Idempotente y
   * silenciosa: un singleton que falle o que devuelva vacío no rompe nada,
   * simplemente no aporta claves.
   */
  load(endpoints: readonly ResourceEndpoints[]): void {
    if (!this.api || typeof this.api.get !== 'function' || endpoints.length === 0) return;

    forkJoin(
      endpoints.map((endpoint) =>
        this.api!.get<Record<string, unknown>>(endpoint).pipe(
          catchError(() => of<Record<string, unknown>>({})),
        ),
      ),
    ).subscribe((blocks) => {
      blocks.forEach((data) => {
        if (data && typeof data === 'object' && Object.keys(data).length > 0) {
          this.globalConfig.update((current) => ({ ...current, ...data }));
        }
      });
    });
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
