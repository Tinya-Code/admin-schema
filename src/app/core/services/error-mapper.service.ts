import { Service } from '@angular/core';

import { ApiError } from '../models/api.model';

export interface MappedError {
  /** Errores por ruta de campo (ej. `faq[2].answer`); se pintan en el campo exacto. */
  fields: Record<string, string>;
  /** Mensaje general; presente cuando el error no tiene ruta de campo (base.md §10). */
  general?: string;
}

/**
 * Convierte un error recibido en el formato que consume la UI:
 * rutas de campo para pintar el error donde corresponde, o mensaje general.
 *
 * Un422 trae VARIOS issues con ruta (`error.errors[]`, auth.md §6); cada uno
 * se convierte en `fields[path] = mensaje`, que es exactamente la clave que
 * después resuelve el host como `serverErrors[prefix + key]`. Si al final no
 * hay ninguna ruta pintable (error sin `errors[]`, issue sin `path`), el
 * mensaje del sobre queda en `general` como hasta ahora (base.md §10).
 */
@Service()
export class ErrorMapperService {
  map(error: unknown): MappedError {
    if (error instanceof ApiError) {
      const fields: Record<string, string> = {};
      for (const issue of error.issues) {
        if (issue.path) {
          fields[issue.path] = issue.message;
        }
      }
      // Sobre con `path` suelto (sin `errors[]`): misma historia, un campo.
      if (error.fieldPath && fields[error.fieldPath] === undefined) {
        fields[error.fieldPath] = error.message;
      }
      if (Object.keys(fields).length > 0) {
        return { fields };
      }
    }
    return { fields: {}, general: this.messageOf(error) };
  }

  messageOf(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return 'Error inesperado';
  }
}
