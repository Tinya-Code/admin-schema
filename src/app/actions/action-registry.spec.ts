import { describe, expect, it } from 'vitest';

import {
  actionType,
  actionsFor,
  getAction,
  registerAction,
  type ActionDescriptor,
} from './action-registry';

function descriptor(
  type: string,
  surfaces: ActionDescriptor['surfaces'] = ['row'],
): ActionDescriptor {
  return { type, surfaces, run: async () => ({ ok: true }) };
}

describe('action-registry', () => {
  it('registra un descriptor y lo devuelve por su tipo', () => {
    registerAction(descriptor('compartir'));
    expect(getAction('compartir')?.type).toBe('compartir');
  });

  it('devuelve undefined para un tipo sin registrar', () => {
    expect(getAction('sin-registrar')).toBeUndefined();
  });

  it('al re-registrar un tipo reemplaza el descriptor anterior', () => {
    registerAction(descriptor('navegar', ['detail']));
    registerAction(descriptor('navegar', ['row', 'detail']));
    expect(getAction('navegar')?.surfaces).toEqual(['row', 'detail']);
  });

  it('lista sólo los descriptores cuya superficie coincide', () => {
    registerAction(descriptor('cabecera', ['header']));
    expect(actionsFor('header').map((d) => d.type)).toEqual(['cabecera']);
    expect(actionsFor('bulk')).toEqual([]);
  });
});

describe('actionType', () => {
  it('usa el tipo declarado', () => {
    expect(actionType({ id: 'x', label: 'X', type: 'trigger' })).toBe('trigger');
    expect(actionType({ id: 'x', label: 'X', type: 'copy-share', urlTemplate: '/p/{ref}' })).toBe(
      'copy-share',
    );
  });

  it('una acción sin type es una navegación (NavigateAction.type es opcional)', () => {
    expect(actionType({ id: 'x', label: 'X', urlTemplate: '/p/{ref}' })).toBe('navigate');
  });
});
