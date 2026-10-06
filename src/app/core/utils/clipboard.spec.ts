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

  it('recorta el shareText pero nunca la URL', () => {
    expect(buildShareMessage(URL, '  Hola Ana  ')).toBe(`Hola Ana ${URL}`);
    expect(buildShareMessage('', 'Hola Ana')).toBe('Hola Ana');
  });
});
