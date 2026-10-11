import { describe, expect, it } from 'vitest';

import { buildShareMessage } from './clipboard';

const URL = 'https://ejemplo.test/p/abc123';

/**
 * `buildShareMessage` es el único sitio que decide QUÉ se copia. Aquí vive el
 * bug que motivó la función: `copy()` y la acción del listado escribían sólo
 * `url`, dejando afuera el `shareTextTemplate` formateado (saludo, ref, PIN y
 * el propio enlace) que sí viajaban por WhatsApp.
 */
describe('buildShareMessage', () => {
  it('sin shareText devuelve sólo la URL', () => {
    expect(buildShareMessage(URL)).toBe(URL);
    expect(buildShareMessage(URL, '')).toBe(URL);
    expect(buildShareMessage(URL, '   ')).toBe(URL);
  });

  it('con shareText que YA trae la URL no duplica el enlace', () => {
    // Este es el caso de `orders.shareTextTemplate`: el mensaje ya incluye
    // el link escrito dentro. Un `join` a ciegas lo pegaba DOS veces.
    const template = `Hola Ana, puede retirar su pedido A-100 aquí: ${URL}`;
    expect(buildShareMessage(URL, template)).toBe(template);
  });

  it('con shareText SIN la URL completa el enlace al final', () => {
    const text = 'Hola Ana, su pedido A-100 está listo';
    expect(buildShareMessage(URL, text)).toBe(`${text} ${URL}`);
  });

  it('un mensaje que sólo menciona la base del sitio NO recibe el enlace', () => {
    // Caso real reportado: la plantilla interpola `{public_base_url}` (la
    // base, sin `/p/{ref}`) y el motor le pegaba la URL con código al final
    // aunque el mensaje YA apuntaba al sitio. El criterio es el origin,
    // no la URL exacta.
    const text = '🔗 Consulta tu pedido en https://ejemplo.test';
    expect(buildShareMessage(URL, text)).toBe(text);
  });

  it('un mensaje que apunta a OTRO sitio sí recibe el enlace', () => {
    const text = 'Sigue el pedido en https://otro-sitio.test/pedidos';
    expect(buildShareMessage(URL, text)).toBe(`${text} ${URL}`);
  });

  it('con URL relativa sólo casa la coincidencia exacta', () => {
    expect(buildShareMessage('/p/abc123', 'Ver en /p/abc123')).toBe('Ver en /p/abc123');
    expect(buildShareMessage('/p/abc123', 'Ver tu pedido')).toBe('Ver tu pedido /p/abc123');
  });

  it('recorta el shareText pero nunca la URL', () => {
    expect(buildShareMessage(URL, '  Hola Ana  ')).toBe(`Hola Ana ${URL}`);
    expect(buildShareMessage('', 'Hola Ana')).toBe('Hola Ana');
  });
});
