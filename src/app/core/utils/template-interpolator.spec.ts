import { describe, expect, it } from 'vitest';
import { interpolateTemplate } from './template-interpolator';

describe('interpolateTemplate', () => {
  it('1. interpola variables simples en la plantilla', () => {
    const template = 'https://ejemplo.com/p/{ref}?cliente={customer_name}';
    const data = { ref: 'ORD-123', customer_name: 'Juan Perez' };

    const result = interpolateTemplate(template, data);

    expect(result).toBe('https://ejemplo.com/p/ORD-123?cliente=Juan Perez');
  });

  it('2. reemplaza variables nulas o indefinidas por cadena vacía', () => {
    const template = 'Pedido {ref} - Estado: {status}';
    const data = { ref: 'ORD-999' };

    const result = interpolateTemplate(template, data);

    expect(result).toBe('Pedido ORD-999 - Estado: ');
  });

  it('3. resuelve claves anidadas usando notación de punto', () => {
    const template = 'ID: {order.meta.id} - Nombre: {order.customer.name}';
    const data = {
      order: {
        meta: { id: 'M-55' },
        customer: { name: 'Maria' },
      },
    };

    const result = interpolateTemplate(template, data);

    expect(result).toBe('ID: M-55 - Nombre: Maria');
  });

  it('4. recurre al contexto adicional si la clave no está en data', () => {
    const template = '{public_base_url}/p/{ref}';
    const data = { ref: 'PED-404' };
    const extraContext = { public_base_url: 'https://retiro.tienda.com' };

    const result = interpolateTemplate(template, data, extraContext);

    expect(result).toBe('https://retiro.tienda.com/p/PED-404');
  });

  it('5. devuelve la misma plantilla si no contiene marcadores', () => {
    const template = 'Texto plano sin variables';
    const result = interpolateTemplate(template, { a: 1 });

    expect(result).toBe('Texto plano sin variables');
  });

  it('6. maneja plantillas vacías o nulas sin romper', () => {
    expect(interpolateTemplate('', { ref: '123' })).toBe('');
    // @ts-expect-error probando valor nulo
    expect(interpolateTemplate(null, { ref: '123' })).toBe('');
  });
});
