import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

let REGISTRY;
const RESOURCE_ID = '__command_fixture';
const originalGlobals = {};
const originalResourceSchema = globalThis.REGISTRY?.resources?.[RESOURCE_ID];

function preserveGlobal(name) {
  if (!Object.prototype.hasOwnProperty.call(originalGlobals, name)) {
    originalGlobals[name] = globalThis[name];
  }
}

function makeFixture() {
  const parentHeaders = ['id', 'state', 'updated_at'];
  const historyHeaders = ['record_id', 'action', 'detail', 'at'];
  const parentRows = [{ at: 2, values: ['record-1', 'PENDING', 'before'] }];
  const historyRows = [];
  const sheets = {
    _command_fixture: {
      getRange: (_row, _column, _rows, _columns) => ({
        setValues: (values) => {
          parentRows[0].values = values[0];
        },
      }),
    },
    _command_fixture_history: {
      getLastRow: () => historyRows.length + 1,
      getRange: (_row, _column, _rows, _columns) => ({
        setValues: (values) => {
          historyRows.splice(
            0,
            historyRows.length,
            ...values.map((valuesRow, index) => ({
              at: index + 2,
              values: valuesRow,
            })),
          );
        },
        clearContent: () => {},
      }),
    },
  };
  const resource = {
    id: RESOURCE_ID,
    kind: 'collection',
    route: '/p/command-fixture',
    sheet: '_command_fixture',
    keyField: 'id',
    ordering: 'none',
    fields: [
      { key: 'id', type: 'text', required: true, unique: true },
      { key: 'state', type: 'select', required: true, enum: ['PENDING', 'DONE'] },
      { key: 'updated_at', type: 'readonly-text', system: true, computed: 'now' },
      {
        key: 'history',
        type: 'list',
        sheet: '_command_fixture_history',
        fk: 'record_id',
        itemFields: [
          { key: 'action', type: 'select', required: true, enum: ['CHANGED'] },
          { key: 'detail', type: 'text' },
          { key: 'at', type: 'readonly-text', system: true, computed: 'now' },
        ],
      },
    ],
    commands: {
      changeState: {
        input: {
          detail: { type: 'text', required: true, maxLength: 50 },
        },
        output: {
          ok: { type: 'boolean', required: true },
          id: { type: 'text', required: true },
        },
        access: 'admin',
        idempotency: 'none',
        preconditions: [{ field: 'state', op: 'eq', value: 'PENDING' }],
        changes: { state: { value: 'DONE' } },
        events: [
          {
            appendTo: 'history',
            values: {
              action: { value: 'CHANGED' },
              detail: { from: 'input.detail' },
            },
          },
        ],
      },
    },
  };
  REGISTRY.resources[RESOURCE_ID] = resource;
  ['readSheetData_', 'openSpreadsheet_', 'cacheInvalidate_'].forEach(preserveGlobal);
  globalThis.readSheetData_ = (_ss, name) => {
    if (name === '_command_fixture')
      return { sheet: sheets[name], headers: parentHeaders, rows: parentRows };
    if (name === '_command_fixture_history') {
      return { sheet: sheets[name], headers: historyHeaders, rows: historyRows };
    }
    throw new Error('Unexpected sheet: ' + name);
  };
  globalThis.openSpreadsheet_ = () => ({
    getSheetByName: (name) => sheets[name] || null,
  });
  globalThis.cacheInvalidate_ = () => {};
  return { resource, parentRows, historyRows };
}

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
});

afterEach(() => {
  if (originalResourceSchema === undefined) delete REGISTRY.resources[RESOURCE_ID];
  else REGISTRY.resources[RESOURCE_ID] = originalResourceSchema;
  globalThis.ROUTE_TABLE_ = null;
  Object.keys(originalGlobals).forEach((key) => {
    globalThis[key] = originalGlobals[key];
    delete originalGlobals[key];
  });
});

describe('runtime genérico de commands', () => {
  it('resuelve el recurso, clave intermedia y comando desde la ruta declarada', () => {
    makeFixture();
    const route = globalThis.resolveRoute_('/p/command-fixture/record%2D1/commands/changeState');
    expect(route.kind).toBe('command');
    expect(route.command).toBe('changeState');
    expect(route.params.id).toBe('record-1');
    expect(route.policy.access.write).toBe('admin');
  });

  it('resuelve el comando público de orders desde su declaración, sin abrir el CRUD', () => {
    globalThis.ROUTE_TABLE_ = null;
    const route = globalThis.resolveRoute_('/p/orders/ORD-123/commands/register-pickup-person');
    expect(route.kind).toBe('command');
    expect(route.resource.id).toBe('orders');
    expect(route.command).toBe('register-pickup-person');
    expect(route.params.ref).toBe('ORD-123');
    expect(route.policy.access.write).toBe('public');
    expect(route.commandDecl.access).toBe('public');
    expect(globalThis.resourceRoute_(route.resource)).toBe('/admin/orders');
    expect(route.resource.audiences.public.operations).toEqual(['get']);
  });

  it('valida, serializa cambios y agrega eventos declarados sin mutar el evento previo', () => {
    const { resource, parentRows, historyRows } = makeFixture();
    const result = globalThis.dispatchDomainCommand_(resource, resource.commands.changeState, {
      method: 'POST',
      command: 'changeState',
      params: { id: 'record-1' },
      payload: { input: { detail: 'Autorización registrada' } },
      user: { id: 'user-1', active: true },
    });
    expect(result).toEqual({ ok: true, id: 'record-1' });
    expect(parentRows[0].values[1]).toBe('DONE');
    expect(parentRows[0].values[2]).not.toBe('before');
    expect(historyRows).toHaveLength(1);
    expect(historyRows[0].values).toEqual([
      'record-1',
      'CHANGED',
      'Autorización registrada',
      expect.any(String),
    ]);
  });

  it('rechaza inputs extra o inválidos antes de leer/escribir el registro', () => {
    const { resource, parentRows } = makeFixture();
    const before = parentRows[0].values.slice();
    expect(() =>
      globalThis.dispatchDomainCommand_(resource, resource.commands.changeState, {
        method: 'POST',
        command: 'changeState',
        params: { id: 'record-1' },
        payload: { input: { detail: 'ok', injected: true } },
        user: { id: 'user-1', active: true },
      }),
    ).toThrow(/Errores de validación/);
    expect(parentRows[0].values).toEqual(before);
  });

  it('devuelve 409 si la precondición ya no coincide y no escribe', () => {
    const { resource, parentRows } = makeFixture();
    parentRows[0].values[1] = 'DONE';
    const before = parentRows[0].values.slice();
    try {
      globalThis.dispatchDomainCommand_(resource, resource.commands.changeState, {
        method: 'POST',
        command: 'changeState',
        params: { id: 'record-1' },
        payload: { input: { detail: 'segunda vez' } },
        user: { id: 'user-1', active: true },
      });
      throw new Error('Expected precondition failure');
    } catch (error) {
      expect(error.apiStatus).toBe(409);
      expect(error.apiCode).toBe('COMMAND_PRECONDITION_FAILED');
    }
    expect(parentRows[0].values).toEqual(before);
  });
});
