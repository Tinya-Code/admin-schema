// api/__tests__/compute-rules — computeRules_ (engine/24-crud).
//
// Deriva valores declarados en resource.operations.create.computed, SÓLO
// al crear y SÓLO si el destino viene vacío. Es el camino que usa
// `products.slug` desde slugify, y el que va a usar el `ref` de orders con
// el transform `token`.
//
// Los errores son apiError_(500, …): Error plano con err.apiStatus = 500.

import { beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

let computeRules_;

beforeAll(() => {
  loadBackend();
  computeRules_ = globalThis.computeRules_;
});

/** Recurso mínimo sólo con la declaración que ejercita cada test. */
function recurso(computed) {
  return { id: 'demo', operations: { create: { computed } } };
}

function ejecuta(resource, payload, opts = { isNew: true }) {
  computeRules_(resource, payload, opts);
  return payload;
}

function expect500(fn, fragmento) {
  let error;
  try {
    fn();
  } catch (err) {
    error = err;
  }
  expect(error, 'esperaba un error de configuración').toBeDefined();
  expect(error.apiStatus).toBe(500);
  if (fragmento) expect(error.message).toContain(fragmento);
}

describe('computeRules_', () => {
  it('deriva el campo destino desde el origen con el transform declarado', () => {
    const payload = { name: 'Lomo Saltado Ñoño' };
    ejecuta(recurso([{ field: 'slug', transform: 'slugify', from: 'name' }]), payload);
    expect(payload.slug).toBe('lomo-saltado-nono');
  });

  it('no corre en update: los inmutables no se rederivan', () => {
    const payload = { name: 'Lomo Saltado Ñoño' };
    ejecuta(recurso([{ field: 'slug', transform: 'slugify', from: 'name' }]), payload, {
      isNew: false,
    });
    expect(payload.slug).toBeUndefined();
  });

  it('respeta el valor que definió el caller', () => {
    const payload = { name: 'Lomo Saltado Ñoño', slug: 'valor-manual' };
    ejecuta(recurso([{ field: 'slug', transform: 'slugify', from: 'name' }]), payload);
    expect(payload.slug).toBe('valor-manual');
  });

  it('no deriva si el origen viene vacío: lo dice 23-validate', () => {
    const payload = { name: '' };
    ejecuta(recurso([{ field: 'slug', transform: 'slugify', from: 'name' }]), payload);
    expect(payload.slug).toBeUndefined();
  });

  it('no deriva si el origen no está declarado en el payload', () => {
    const payload = {};
    ejecuta(recurso([{ field: 'slug', transform: 'slugify', from: 'name' }]), payload);
    expect(payload.slug).toBeUndefined();
  });

  it('no escribe si el transform devuelve cadena vacía', () => {
    const payload = { name: '   ' };
    ejecuta(recurso([{ field: 'slug', transform: 'slugify', from: 'name' }]), payload);
    expect(payload.slug).toBeUndefined();
  });

  it('ignora la declaración si no hay operations.create.computed', () => {
    const payload = { name: 'X' };
    ejecuta({ id: 'demo', operations: {} }, payload);
    expect(payload).toEqual({ name: 'X' });
  });

  it('tira 500 si falta `from`', () => {
    expect500(
      () => ejecuta(recurso([{ field: 'slug', transform: 'slugify' }]), {}),
      'computed mal declarado',
    );
  });

  it('tira 500 si `from` no es string', () => {
    expect500(
      () => ejecuta(recurso([{ field: 'slug', transform: 'slugify', from: 42 }]), {}),
      'computed mal declarado',
    );
  });

  it('tira 500 si falta `field` o `transform`', () => {
    expect500(
      () => ejecuta(recurso([{ transform: 'slugify', from: 'name' }]), {}),
      'mal declarado',
    );
    expect500(() => ejecuta(recurso([{ field: 'slug', from: 'name' }]), {}), 'mal declarado');
  });

  it('tira 500 si el transform no está registrado', () => {
    expect500(
      () => ejecuta(recurso([{ field: 'slug', transform: 'no-existe', from: 'name' }]), {}),
      'Transform no registrado',
    );
  });

  // El camino que va a usar `orders.ref` (PickPass §B1.1): `from` sólo
  // dispara la generación, no aporta el valor.
  const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  it('escribe `ref` con token, usando `from` sólo como trigger', () => {
    const payload = { customer_name: 'María Fernanda' };
    ejecuta(recurso([{ field: 'ref', transform: 'token', from: 'customer_name' }]), payload);
    expect(payload.ref).toMatch(new RegExp('^[' + ALFABETO + ']{6}$'));
  });

  it('no escribe `ref` si el origen viene vacío: lo dice 23-validate', () => {
    const payload = { customer_name: '' };
    ejecuta(recurso([{ field: 'ref', transform: 'token', from: 'customer_name' }]), payload);
    expect(payload.ref).toBeUndefined();
  });

  it('no rederiva `ref` en update', () => {
    const payload = { customer_name: 'María', ref: 'ABC234' };
    ejecuta(recurso([{ field: 'ref', transform: 'token', from: 'customer_name' }]), payload, {
      isNew: false,
    });
    expect(payload.ref).toBe('ABC234');
  });
});
