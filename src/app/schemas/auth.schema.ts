import type { AuthSchema } from '../core/models/schema.model';

/**
 * Pantalla de login (auth.md §5.1) — **declaración, no componente**.
 *
 * El back no conoce estas etiquetas ni este layout: sólo declara el
 * `input` de `/auth/login`. `scripts/contract-check.mjs` (R2.11, check 10)
 * verifica que las claves de `loginFields` existan en ese `input`, así que
 * renombrar `email` acá sin tocar el backend rompe `npm run api:check`.
 *
 * Los `type` son primitivos (`email`, `password`), no tipos del motor de
 * render: el descriptor `password` es una pieza nueva de Fase 3 (R3.3) y
 * hoy no existe en `FieldSchema`. Cuando llegue, `login.ts` cambia de
 * `@switch` a `FieldHost` — ése es el único punto de contacto.
 */
export const authSchema: AuthSchema = {
  /** §9.1 eligió B: autenticación por contraseña, sin OAuth. */
  providers: ['password'],
  loginFields: [
    { key: 'email', type: 'email', required: true },
    { key: 'password', type: 'password', required: true },
  ],
  /** Tras el login, y también el destino de `returnUrl` si la hay. */
  redirectAfterLogin: '/dashboard',
  /** D10-3 → `false` SIEMPRE: el token vive en `sessionStorage`. */
  rememberMe: false,
};
