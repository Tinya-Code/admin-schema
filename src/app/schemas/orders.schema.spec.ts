import { describe, expect, it } from 'vitest';

import { interpolateTemplate } from '../core/utils/template-interpolator';
import { ordersSchema } from './orders.schema';

/**
 * Contrato del formulario de pedidos.
 *
 * El caso de `ref` viene de un bug real: el back lo genera solo
 * (`operations.create.computed`, transform `token` — ver
 * `api/primitives/transforms.js`), pero el schema de acá lo declaraba
 * editable al crear. El operador veía un campo que no sabía qué poner y el
 * motor descartaba lo que escribiera. De ahí `readonlyOn: 'create'` + `help`.
 *
 * `required` + `unique` SÍ se declaran: tienen que coincidir con el back
 * (`contract-check.mjs` compara `required` campo a campo) y NO bloquean el
 * guardado en alta, porque Signal Forms deja fuera de la validación a un nodo
 * readonly: `shouldSkipValidation = hidden || disabled || readonly`
 * (@angular/forms, _validation_errors-chunk.mjs:778). El nombre del nodo
 * readonly no deshabilita el control — no hace falta: lo salta al validar.
 *
 * El campo `pin` viene del mismo circuito, un paso más allá: el transform
 * `pin` lo genera y el hook `pinHash` hashea en `_pin`, así que el front sólo
 * lo expone para copiarlo en el mensaje y jamás lo edita.
 */
function field(key: string) {
  const found = ordersSchema.fields.find((f) => f.key === key);
  if (!found) throw new Error(`El schema de orders no declara el campo "${key}"`);
  return found;
}

/**
 * `shareTextTemplate` de la acción `copy-share`.
 *
 * `ResourceAction` es unión discriminada (navigate, remove…) y
 * `shareTextTemplate` sólo existe en una de ellas, así que `find` no estrecha
 * por sí solo y el acceso directo no compila.
 */
function shareTextOf(actions: readonly unknown[] | undefined): string | undefined {
  const list = (actions ?? []) as { type?: string; shareTextTemplate?: string }[];
  return list.find((a) => a.type === 'copy-share')?.shareTextTemplate;
}

describe('ordersSchema — creación de pedidos', () => {
  it('el código del pedido no es una entrada del operador', () => {
    const ref = field('ref');

    expect(ref.label).toBe('Código del Pedido');
    // En alta ni se dibuja (no existe hasta que el back llena el `computed`);
    // en edición sí se ve, pero `immutableKey` del back lo hace inmutable, así
    // que es de solo-lectura en TODOS los modos.
    expect(ref.hiddenOn).toBe('create');
    expect(ref.readonlyOn).toBe('always');
    // Declara lo mismo que el back sin bloquear la alta (ver el docblock).
    expect(ref.required).toBe(true);
    expect(ref.validators?.unique).toBe(true);
    // Y el campo explica por qué no tiene nada que escribir.
    expect(ref.help).toContain('Se genera solo al guardar');
  });

  it('el PIN lo genera el back y nunca se edita', () => {
    const pin = field('pin');

    expect(pin.label).toBe('PIN de Autorización');
    // En alta no existe todavía; en edición SÍ se ve, que es donde le sirve
    // al operador para dictarlo por teléfono.
    expect(pin.hiddenOn).toBe('create');
    // Siempre readonly: cambiarlo a mano dejaría la fila sin correspondencia
    // en `_pin`, que es lo que compara `pin-verify`.
    expect(pin.readonlyOn).toBe('always');
    expect(pin.validators?.maxLength).toBe(12);
    expect(pin.help).toContain('Se genera solo al guardar');
    // Opcional en los dos lados: si el computed no corriera, el hook `pinHash`
    // tira a consola y `pin-verify` responde 404 (seguro), sin tumbar el alta.
    expect(pin.required).toBeUndefined();
    expect(pin.validators?.unique).toBeUndefined();
  });

  it('todo campo declara label (anatomía fija: label → control → help → error)', () => {
    for (const f of ordersSchema.fields) {
      expect(f.label, `campo "${f.key}" sin label`).toBeTruthy();
    }
    for (const f of ordersSchema.fields.filter((f) => f.type === 'list')) {
      if (f.type !== 'list') continue;
      for (const item of f.itemFields ?? []) {
        expect(item.label, `ítem "${item.key}" sin label`).toBeTruthy();
      }
    }
  });

  it('los campos de texto con ejemplo declaran placeholder', () => {
    expect(field('customer_name').placeholder).toBe('Ej. Ana Pérez');
    expect(field('customer_notes').placeholder).toBeTruthy();
  });

  // El bug original: el PIN no llegaba al cliente porque el mensaje no lo
  // traía. Los DOS templates (alta y detalle/lista) tienen que llevarlo: son
  // la misma acción vista desde dos contextos.
  it('el mensaje de compartir trae el PIN en los dos contextos', () => {
    const templates = [
      shareTextOf(ordersSchema.postCreate?.actions),
      shareTextOf(ordersSchema.actions),
    ];

    for (const [i, template] of templates.entries()) {
      expect(template, `template ${i} ausente`).toBeTruthy();
      expect(template, `template ${i} sin {pin}`).toContain('{pin}');
      expect(template, `template ${i} sin {ref}`).toContain('{ref}');
      expect(template, `template ${i} sin la URL pública`).toContain('{public_base_url}');
    }

    // El de la vista de detalle/lista se interpola SOBRE LA FILA PROYECTADA,
    // por eso `pin` tiene que estar en `listProjection` (orders.js). Acá se
    // comprueba el extremo que sí importa: el texto copiado con el PIN puesto.
    const rendered = interpolateTemplate(templates[1]!, {
      ref: 'ORD-0001',
      pin: '482913',
      customer_name: 'Ana Pérez',
      public_base_url: 'https://example.test',
    });
    expect(rendered).toBe(
      'Hola Ana Pérez, puede retirar su pedido ORD-0001 aquí: ' +
        'https://example.test/p/ORD-0001. Su PIN es 482913.',
    );
  });

  it('los dos mensajes de compartir dicen exactamente lo mismo', () => {
    expect(shareTextOf(ordersSchema.postCreate?.actions)).toBe(shareTextOf(ordersSchema.actions));
  });
});
