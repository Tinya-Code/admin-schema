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
import { SchemaService } from './core/services/schema.service';
import { ADMIN_TOKEN, API_URL } from './core/tokens';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // Sin `authInterceptor`: el token viaja en el cuerpo del envelope
    // (baseapi §2.3, criterio 11: ninguna cabecera custom).
    provideHttpClient(withInterceptors([apiErrorInterceptor])),
    // URL del Web App + token de admin (baseapi §2.3): viven en
    // `environments/environment.local.ts` (gitignored; ver ejemplo en
    // `environment.local.example.ts`). El token NUNCA se commitea.
    { provide: API_URL, useValue: environment.apiUrl },
    { provide: ADMIN_TOKEN, useValue: environment.adminToken },
    // Schema remoto opcional ANTES del primer render (baseapi §12): al
    // fallar o tardar, manda el schema local (carga con timeout, jamás
    // bloquea el bootstrap).
    provideAppInitializer(() => inject(SchemaService).load()),
  ],
};
