import { InjectionToken } from '@angular/core';

/**
 * URL base de la API (baseapi §2.3): es la URL directa del Web App de Apps
 * Script; ahí se hace el `POST` del envelope `{ token, method, path, payload }`.
 * OBLIGATORIO proporcionarlo en `app.config.ts`:
 * `{ provide: API_URL, useValue: 'https://…' }` (Fase 3). Vacío = mismo origen.
 */
export const API_URL = new InjectionToken<string>('API_URL');

/**
 * Token de administrador para rutas `/admin/*` (baseapi §2.3): viaja DENTRO
 * del cuerpo `text/plain` del envelope, jamás en una cabecera (criterio 11 de
 * §17). Vive en configuración, nunca en el repositorio. Se proporciona en
 * `app.config.ts` (Fase 3).
 */
export const ADMIN_TOKEN = new InjectionToken<string>('ADMIN_TOKEN');
