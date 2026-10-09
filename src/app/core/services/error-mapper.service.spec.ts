import { ApiError } from '../models/api.model';
import { ErrorMapperService } from './error-mapper.service';

/**
 * D42 — el422 con `errors[]` tiene que llegar PINTADO campo a campo.
 *
 * La clave que devuelve `map` es exactamente la que después resuelve el
 * host como `serverErrors[prefix + key]` (render-host:529), así que aquí se
 * comprueba la forma entera: varias rutas a la vez, el fallback a `general`
 * cuando ninguna ruta es pintable y el caso viejo del `path` del sobre.
 */
describe('ErrorMapperService — errores de validación con ruta', () => {
  const mapper = new ErrorMapperService();

  it('varios issues con ruta → un campo por ruta, con su mensaje', () => {
    const error = new ApiError(422, 'Errores de validación', undefined, undefined, [
      { path: 'sku', message: 'Debe tener al menos 5 caracteres.', code: 'VALIDATION_MIN_LENGTH' },
      { path: 'faq[2].answer', message: 'Campo obligatorio.', code: 'VALIDATION_REQUIRED' },
    ]);
    expect(mapper.map(error)).toEqual({
      fields: {
        sku: 'Debe tener al menos 5 caracteres.',
        'faq[2].answer': 'Campo obligatorio.',
      },
    });
  });

  it('sin ninguna ruta pintable, el mensaje del sobre queda en general', () => {
    const sinRutas = new ApiError(422, 'Errores de validación', undefined, undefined, [
      { path: '', message: 'Esto no es pintable' },
    ]);
    expect(mapper.map(sinRutas)).toEqual({ fields: {}, general: 'Errores de validación' });

    const sinIssues = new ApiError(409, 'El registro cambió o ya existe.');
    expect(mapper.map(sinIssues)).toEqual({
      fields: {},
      general: 'El registro cambió o ya existe.',
    });
  });

  it('conserva el caso viejo: `path` suelto en el sobre → un campo', () => {
    const error = new ApiError(422, 'Ya existe un registro con este valor', 'name');
    expect(mapper.map(error)).toEqual({ fields: { name: 'Ya existe un registro con este valor' } });
  });

  it('un error que no es de la API cae en general', () => {
    expect(mapper.map(new Error('boom'))).toEqual({ fields: {}, general: 'boom' });
    expect(mapper.map('¿esto?')).toEqual({ fields: {}, general: 'Error inesperado' });
  });
});
