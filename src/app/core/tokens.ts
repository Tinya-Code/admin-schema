import { InjectionToken } from '@angular/core';

/**
 * URL base única de la API (api.md §6, Opción A: `?path=/…`).
 * OBLIGATORIO proporcionarlo en `app.config.ts`:
 * `{ provide: API_URL, useValue: 'https://…' }` (Fase 3).
 */
export const API_URL = new InjectionToken<string>('API_URL');

/**
 * Token de administrador para rutas `/admin/*` y `/upload` (api.md §7).
 * Vive en configuración, nunca en el repositorio. Se proporciona en
 * `app.config.ts` (Fase 3).
 */
export const ADMIN_TOKEN = new InjectionToken<string>('ADMIN_TOKEN');
