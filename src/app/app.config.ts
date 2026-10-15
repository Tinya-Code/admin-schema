import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { API_URL, provideGasAdmin } from '@tinya-code/gas-admin-ui';

import { routes } from './app.routes';
import { authSchema } from './schemas/auth.schema';
import { schemas } from './schemas/registry';
import { environment } from '../environments/environment';

/**
 * Wiring de la app: el motor (@tinya-code/gas-admin-ui) absorbe HTTP con
 * el interceptor del envelope, los loaders de config y sesión, y el
 * catálogo; la app conserva router, environment y sus schemas de dominio.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideGasAdmin({ schemas, auth: authSchema }),
    // URL del Web App (baseapi §2.3): vive en `environments/environment.local.ts`
    // (gitignored; ver ejemplo en `environment.local.example.ts`).
    { provide: API_URL, useValue: environment.apiUrl },
  ],
};
