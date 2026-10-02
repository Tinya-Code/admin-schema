import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { ADMIN_TOKEN } from '../tokens';

/**
 * Adjunta el token de admin (api.md §6, archivo `Auth`: rutas `/admin/*` y
 * `/upload`). Como la API es una sola URL con `?path=/…`, las rutas admin
 * no son visibles en la URL: se adjunta el token a toda petición a la API
 * cuando hay token configurado.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(ADMIN_TOKEN);
  if (!token) {
    return next(req);
  }
  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
