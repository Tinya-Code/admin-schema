import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { apiErrorInterceptor } from './core/interceptors/api-error.interceptor';
import { ConfigService } from './core/services/config.service';
import { ADMIN_TOKEN, API_URL } from './core/tokens';
import { schemas } from './schemas/registry';
import { environment } from '../environments/environment';

/**
 * Singletons de configuración: los declara el registry, no el servicio.
 * Un singleton nuevo con `endpoint.get` se carga solo — `ConfigService`
 * no conoce ningún recurso concreto.
 */
const configEndpoints = () =>
  schemas.flatMap((schema) =>
    schema.kind === 'singleton' && schema.endpoint?.get ? [{ get: schema.endpoint.get }] : [],
  );

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // Sin `authInterceptor`: el token viaja en el cuerpo del envelope
    // (baseapi §2.3, criterio 11: ninguna cabecera custom).
    provideHttpClient(withInterceptors([apiErrorInterceptor])),
    // Carga de config en bootstrap (explícita, fuera del constructor del
    // servicio): un singleton que falle no rompe el arranque.
    provideAppInitializer(() => inject(ConfigService).load(configEndpoints())),
    // URL del Web App + token de admin (baseapi §2.3): viven en
    // `environments/environment.local.ts` (gitignored; ver ejemplo en
    // `environment.local.example.ts`). El token NUNCA se commitea.
    { provide: API_URL, useValue: environment.apiUrl },
    { provide: ADMIN_TOKEN, useValue: environment.adminToken },
  ],
};
