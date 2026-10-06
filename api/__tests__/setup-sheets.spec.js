// api/__tests__/setup-sheets — getSheetSpecs_ (setup/02-setup-sheets).
//
// M1 de motor-plan: el guard que evita crear hoja a un recurso sin storage.
// Necesario porque el descriptor del dashboard vive en `registry.ts`
// (decisión explícita) y `contract-check.mjs:229` exige paridad back ↔ front,
// pero un dashboard NO tiene filas que persistir.
//
// Sin el guard, `specs.push({ name: resource.sheet … })` empuja `undefined`
// y `setupSheets`/`setupDrift` terminarían en `getSheetByName(undefined)`.

import { beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

let getSheetSpecs_;

beforeAll(() => {
  loadBackend();
  getSheetSpecs_ = globalThis.getSheetSpecs_;
});

function nombres() {
  return getSheetSpecs_().map((spec) => spec.name);
}

describe('getSheetSpecs_', () => {
  it('empuja la hoja principal de los 4 recursos existentes', () => {
    const names = nombres();
    for (const id of ['categories', 'products', 'site', 'legal']) {
      const hoja = globalThis.REGISTRY.resources[id].sheet;
      expect(names, `falta la hoja de ${id}`).toContain(hoja);
    }
  });

  it('empuja siempre las hojas auxiliares', () => {
    expect(getSheetSpecs_().some((s) => s.kind === 'aux')).toBe(true);
  });

  it('empuja las hojas hijas de un recurso CON storage', () => {
    expect(getSheetSpecs_().some((s) => s.kind === 'child')).toBe(true);
  });

  it('NO empuja un recurso sin `sheet` (descriptor de dashboard)', () => {
    globalThis.REGISTRY.resources.__demo_dashboard = {
      id: '__demo_dashboard',
      kind: 'dashboard',
      // deliberadamente SIN `sheet`
      fields: [
        { key: 'title', type: 'text' },
        {
          key: 'events',
          type: 'list',
          sheet: '__demo_child',
          itemFields: [{ key: 'at', type: 'text' }],
        },
      ],
    };
    try {
      const names = nombres();
      expect(names).not.toContain(undefined);
      expect(names).not.toContain(null);
      expect(names).not.toContain('__demo_child'); // las hijas tampoco
    } finally {
      delete globalThis.REGISTRY.resources.__demo_dashboard;
    }
  });

  it('al retirar `sheet` no queda ningún spec sin nombre', () => {
    const recurso = globalThis.REGISTRY.resources.site;
    const original = recurso.sheet;
    try {
      delete recurso.sheet;
      const names = nombres();
      expect(names).not.toContain(undefined);
      expect(names).not.toContain(original);
    } finally {
      recurso.sheet = original;
    }
    expect(nombres()).toContain(original);
  });
});
