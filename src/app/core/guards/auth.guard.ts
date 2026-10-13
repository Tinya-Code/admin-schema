import { inject } from '@angular/core';
import type { CanActivateFn } from '@angular/router';
import { Router } from '@angular/router';

import { getSchema } from '../../schemas/registry';
import { AuthService, LOGIN_PATH } from '../services/auth.service';

/**
 * Guards de sesión (auth.md §5.3).
 *
 * Dos puertas y ninguna es una barrera de seguridad: el back re-verifica
 * `accessLevel` en **cada** petición desde R2.6. Éstas sólo evitan pintar
 * una pantalla que no le toca al usuario — enseñarle un formulario que va
 * a recibir 403 es mala UX, no un agujero.
 *
 * `authGuard` va en la ruta madre (todo el shell); `roleGuard` en cada
 * `:id`, que es donde aparece el recurso que puede tener `access`.
 */

/** Sin sesión → login. Corre ANTES que cualquier ruta del shell. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (auth.isAuthenticated()) return true;
  return inject(Router).createUrlTree([LOGIN_PATH]);
};

/**
 * El recurso declara `access` y esta sesión no lo cumple → se cancela la
 * navegación. No hay pantalla de 403 (tampoco la pide §5.3) y el menú ya
 * oculta la entrada, así que queda sólo el caso de alguien tecleando la URL.
 */
export const roleGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Redundante con `authGuard` (la madre ya filtra) pero barato: un hijo
  // nunca debe dejar una sesión muerta navegando sola.
  if (!auth.isAuthenticated()) return router.createUrlTree([LOGIN_PATH]);

  const id = route.data?.['resourceId'] ?? route.paramMap.get('id');
  // Ruta sin recurso declarado, o id que no existe en el registry → que
  // responda el back (404). No inventar una política sobre datos ajenos.
  if (id === null) return true;
  const schema = getSchema(String(id));
  if (schema === undefined) return true;

  return auth.canAccess(schema.access);
};
