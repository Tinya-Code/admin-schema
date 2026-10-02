import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { apiErrorInterceptor } from './core/interceptors/api-error.interceptor';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { ADMIN_TOKEN, API_URL } from './core/tokens';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor, apiErrorInterceptor])),
    // URL del Web App de Apps Script (api.md §6, Opción A). Vacío = mismo origen.
    // OBLIGATORIO configurar al desplegar el backend.
    { provide: API_URL, useValue: '' },
    // Token de admin (api.md §7): se inyecta en runtime/despliegue, nunca en el repo.
    { provide: ADMIN_TOKEN, useValue: '' },
  ],
};
