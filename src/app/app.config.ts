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
import { AuthService } from './core/services/auth.service';
import { ConfigService } from './core/services/config.service';
import { API_URL } from './core/tokens';
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
    // Sesión (R2.12): revalida contra `/auth/me` el token que restauró el
    // AuthService de `sessionStorage`. Corre ANTES del primer guard, así
    // que un usuario desactivado mientras la pestaña estaba abierta cae a
    // login en el arranque, no en mitad de una edición. Sin token no hay
    // viaje, y un fallo no puede romper el bootstrap (`restore` traga).
    provideAppInitializer(() => inject(AuthService).restore()),
    // URL del Web App (baseapi §2.3): vive en `environments/environment.local.ts`
    // (gitignored; ver ejemplo en `environment.local.example.ts`).
    { provide: API_URL, useValue: environment.apiUrl },
  ],
};
