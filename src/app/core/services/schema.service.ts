import { inject, Service } from '@angular/core';
import { catchError, map, Observable, of, timeout } from 'rxjs';

import { parseSchemaResponse } from '../../schemas/schema-merge';
import { setRemoteSchema } from '../../schemas/registry';
import { ApiService } from './api.service';

/** Proyección pública del schema (baseapi §12): opcional, con timeout. */
const SCHEMA_PATH = '/admin/schema';
/** Nunca dejar la app colgada esperando el schema remoto. */
const SCHEMA_TIMEOUT_MS = 4000;

/**
 * Carga opcional de `/admin/schema` (baseapi §12): se fusiona por `key` con
 * la presentación local vía `setRemoteSchema`. CUALQUIER fallo (red, timeout,
 * shape inesperado) deja `remote = null` y manda el schema local — el merge
 * jamás rompe la app.
 *
 * Idempotente: sólo se pide una vez por sesión, en el initializer de
 * `app.config.ts` (antes del primer render, así las rutas ya ven el schema
 * fusionado y `buildFormSchema` construye con las reglas del backend).
 */
@Service()
export class SchemaService {
  private readonly api = inject(ApiService);
  private started = false;

  load(): Observable<void> {
    if (this.started) {
      return of(undefined);
    }
    this.started = true;
    return this.api.request<unknown>('GET', SCHEMA_PATH).pipe(
      timeout({ first: SCHEMA_TIMEOUT_MS }),
      map((response) => setRemoteSchema(parseSchemaResponse(response))),
      catchError(() => of(undefined)),
    );
  }
}
