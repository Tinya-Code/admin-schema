import { describe, expect, it } from 'vitest';

import { get, isSupported, register, resolve, type RenderDescriptor } from './render-registry';

/** Los 20 tipos de campo que la UI sabe dibujar (R3.3). */
const CAMPOS = [
  'text',
  'textarea',
  'slug',
  'number',
  'currency',
  'boolean',
  'select',
  'multiselect',
  'url',
  'email',
  'phone',
  'date',
  'time',
  'readonly-text',
  'group',
  'list',
  'string-list',
  'key-value',
  'relation',
  'image',
] as const;

/** Componente que sólo puede salir si el registro no resuelve. */
class SinRenderizador {}

describe('render-registry', () => {
  it('registra y devuelve el descriptor por (kind, type)', () => {
    const descriptor: RenderDescriptor = {
      kind: 'view',
      type: 'ficha-de-prueba',
      since: '9.9',
      load: async () => SinRenderizador,
    };

    register('view', descriptor);

    expect(get('view', 'ficha-de-prueba')).toBe(descriptor);
    expect(get('field', 'ficha-de-prueba')).toBeUndefined();
  });

  it('isSupported sólo mira dentro de su kind', () => {
    expect(isSupported('field', 'texto-que-no-existe')).toBe(false);
    expect(isSupported('widget', 'text')).toBe(false);
  });

  it('los 20 tipos de campo están en el catálogo', () => {
    for (const type of CAMPOS) {
      expect(isSupported('field', type), `falta el descriptor de "${type}"`).toBe(true);
    }
  });

  // Son 20 imports dinámicos de componentes reales: con el suite completo
  // compitiendo por el hilo, el default de 10 s se queda corto y el gate se
  // pone rojo por reloj, no por código.
  it('los 20 tipos de campo resuelven su componente real', async () => {
    for (const type of CAMPOS) {
      const component = await resolve('field', type, SinRenderizador);
      expect(component, `"${type}" resolvió el fallback`).not.toBe(SinRenderizador);
    }
  }, 30_000);

  it('devuelve el fallback cuando el tipo no está registrado', async () => {
    await expect(resolve('field', 'no-existe', SinRenderizador)).resolves.toBe(SinRenderizador);
  });

  it('el descriptor declara kind, since y carga perezosa', () => {
    for (const type of CAMPOS) {
      const descriptor = get('field', type)!;
      expect(descriptor.kind, type).toBe('field');
      expect(descriptor.type, type).toBe(type);
      expect(descriptor.since, type).toBeTruthy();
      expect(typeof descriptor.load, type).toBe('function');
      expect(descriptor.surfaces, type).toContain('form');
    }
  });
});
