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
 */
@Service()
export class ErrorMapperService {
  map(error: unknown): MappedError {
    if (error instanceof ApiError && error.fieldPath) {
      return { fields: { [error.fieldPath]: error.message } };
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
