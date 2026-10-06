import { beforeAll, describe, it, expect } from 'vitest';
import { loadBackend } from './_harness.js';

let REGISTRY;

beforeAll(() => {
  REGISTRY = loadBackend();
});

describe('REGISTRY.checks - PickPass checks', () => {
  const getHistoryCheck = () => REGISTRY.checks['history-append-only'];
  const getNoAuthCheck = () => REGISTRY.checks['no-auth-after-delivered'];

  describe('history-append-only', () => {
    it('en creación acepta cualquier historial inicial', () => {
      const fn = getHistoryCheck();
      const scope = {
        ctx: {
          isNew: true,
          children: {
            history: [{ action: 'PEDIDO_CREADO', detail: 'Inicio' }],
          },
        },
      };
      expect(fn(scope)).toEqual([]);
    });

    it('en actualización permite agregar elementos conservando los existentes', () => {
      const fn = getHistoryCheck();
      const scope = {
        ctx: {
          isNew: false,
          currentChildren: {
            history: [{ action: 'PEDIDO_CREADO', detail: 'Inicio' }],
          },
          children: {
            history: [
              { action: 'PEDIDO_CREADO', detail: 'Inicio' },
              { action: 'AUTORIZADO', detail: 'Juan Pérez' },
            ],
          },
        },
      };
      expect(fn(scope)).toEqual([]);
    });

    it('rechaza si se elimina o altera un elemento del historial existente', () => {
      const fn = getHistoryCheck();
      const scopeTruncated = {
        ctx: {
          isNew: false,
          currentChildren: {
            history: [
              { action: 'PEDIDO_CREADO', detail: 'Inicio' },
              { action: 'AUTORIZADO', detail: 'Juan Pérez' },
            ],
          },
          children: {
            history: [{ action: 'PEDIDO_CREADO', detail: 'Inicio' }],
          },
        },
      };
      expect(fn(scopeTruncated).length).toBeGreaterThan(0);
      expect(fn(scopeTruncated)[0].path).toBe('history');

      const scopeAltered = {
        ctx: {
          isNew: false,
          currentChildren: {
            history: [{ action: 'PEDIDO_CREADO', detail: 'Inicio' }],
          },
          children: {
            history: [{ action: 'PEDIDO_CREADO', detail: 'Modificado' }],
          },
        },
      };
      expect(fn(scopeAltered).length).toBeGreaterThan(0);
    });

    it('si la entrada no incluye history en el payload, no emite error', () => {
      const fn = getHistoryCheck();
      const scopeNoHistoryInPayload = {
        ctx: {
          isNew: false,
          currentChildren: {
            history: [{ action: 'PEDIDO_CREADO', detail: 'Inicio' }],
          },
          children: {},
        },
      };
      expect(fn(scopeNoHistoryInPayload)).toEqual([]);
    });
  });

  describe('no-auth-after-delivered', () => {
    it('permite cambiar datos cuando el pedido no está ENTREGADO', () => {
      const fn = getNoAuthCheck();
      const scope = {
        ctx: {
          current: { status: 'PENDIENTE', authorized_name: 'Carlos' },
          incoming: { authorized_name: 'María' },
        },
      };
      expect(fn(scope)).toEqual([]);
    });

    it('rechaza cambiar autorizados cuando el pedido ya está ENTREGADO', () => {
      const fn = getNoAuthCheck();
      const scope = {
        ctx: {
          current: { status: 'ENTREGADO', authorized_name: 'Carlos', auth_state: 'ACTIVA' },
          incoming: { authorized_name: 'María' },
        },
      };
      const res = fn(scope);
      expect(res.length).toBeGreaterThan(0);
      expect(res[0].path).toBe('auth_state');
    });

    it('permite actualizar otros campos no relacionados en pedido ENTREGADO (ej: customer_notes)', () => {
      const fn = getNoAuthCheck();
      const scope = {
        ctx: {
          current: { status: 'ENTREGADO', authorized_name: 'Carlos', auth_state: 'ACTIVA' },
          incoming: { customer_notes: 'Nota adicional' },
        },
      };
      expect(fn(scope)).toEqual([]);
    });
  });
});
