import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

let REGISTRY;
let storageMap_;
let resourceDelete_;
const PARENT_ID = '__relation_parent__';
const CHILD_ID = '__relation_child__';
const PARENT_SHEET = '__relation_parent_sheet__';
const CHILD_SHEET = '__relation_child_sheet__';

let originalParent;
let originalChild;
let originalRecorder;
let fired;

function resource_(id, sheet, fields, onDelete, hooks) {
  return {
    id,
    kind: 'collection',
    sheet,
    keyField: 'key',
    titleField: 'name',
    ordering: 'none',
    activeField: null,
    onDelete,
    dependents: id === PARENT_ID ? [CHILD_ID] : [],
    listProjection: null,
    imageFolder: null,
    views: {},
    policies: { access: { read: 'admin', write: 'admin' }, audit: false, lock: false },
    exposeToFront: false,
    operations: { remove: true },
    fields,
    hooks,
  };
}

function scenario_(parentPolicy, required) {
  const parent = resource_(
    PARENT_ID,
    PARENT_SHEET,
    [
      { key: 'key', type: 'text', required: true },
      { key: 'name', type: 'text', required: true },
    ],
    parentPolicy,
    { delete: ['relationRecorder'] },
  );
  const child = resource_(
    CHILD_ID,
    CHILD_SHEET,
    [
      { key: 'key', type: 'text', required: true },
      {
        key: 'parent_key',
        type: 'relation',
        required,
        source: { resource: PARENT_ID },
      },
      { key: 'name', type: 'text', required: true },
    ],
    'none',
    {
      delete: ['relationRecorder'],
      afterUpdate: ['relationRecorder'],
    },
  );
  REGISTRY.resources[PARENT_ID] = parent;
  REGISTRY.resources[CHILD_ID] = child;
  const parentMap = storageMap_(parent);
  const childMap = storageMap_(child);
  const parentSheet = fakeSheet_([
    parentMap.columns.map((column) => column.flatKey),
    ['p1', 'Padre'],
  ]);
  const childSheet = fakeSheet_([
    childMap.columns.map((column) => column.flatKey),
    ['c1', 'p1', 'Hijo'],
  ]);
  return {
    parent,
    child,
    parentMap,
    parentSheet,
    childSheet,
    ss: fakeApp_({
      [PARENT_SHEET]: parentSheet,
      [CHILD_SHEET]: childSheet,
    }),
  };
}

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
  storageMap_ = globalThis.storageMap_;
  resourceDelete_ = globalThis.resourceDelete_;
  originalParent = REGISTRY.resources[PARENT_ID];
  originalChild = REGISTRY.resources[CHILD_ID];
  originalRecorder = REGISTRY.hooks.relationRecorder;
});

beforeEach(() => {
  fired = [];
  REGISTRY.hooks.relationRecorder = (context) => fired.push(context);
});

afterEach(() => {
  if (originalParent === undefined) delete REGISTRY.resources[PARENT_ID];
  else REGISTRY.resources[PARENT_ID] = originalParent;
  if (originalChild === undefined) delete REGISTRY.resources[CHILD_ID];
  else REGISTRY.resources[CHILD_ID] = originalChild;
  if (originalRecorder === undefined) delete REGISTRY.hooks.relationRecorder;
  else REGISTRY.hooks.relationRecorder = originalRecorder;
});

describe('onDelete relacional', () => {
  it('restrict rechaza el borrado con 409 y conserva ambas filas', () => {
    const state = scenario_('restrict', false);
    let error;
    try {
      resourceDelete_(
        state.ss,
        state.parent,
        state.parentMap,
        { method: 'DELETE', params: { key: 'p1' } },
        true,
      );
    } catch (caught) {
      error = caught;
    }

    expect(error?.apiStatus).toBe(409);
    expect(state.parentSheet.rows()).toHaveLength(2);
    expect(state.childSheet.rows()).toHaveLength(2);
    expect(fired).toEqual([]);
  });

  it('cascade elimina dependientes antes del padre y emite hooks de delete', () => {
    const state = scenario_('cascade', false);

    resourceDelete_(
      state.ss,
      state.parent,
      state.parentMap,
      { method: 'DELETE', params: { key: 'p1' } },
      true,
    );

    expect(
      state.parentSheet
        .rows()
        .slice(1)
        .every((row) => row.every((value) => value === '')),
    ).toBe(true);
    expect(
      state.childSheet
        .rows()
        .slice(1)
        .every((row) => row.every((value) => value === '')),
    ).toBe(true);
    expect(fired.map((context) => context.resource.id)).toEqual([CHILD_ID, PARENT_ID]);
    expect(fired.map((context) => context.action)).toEqual(['delete', 'delete']);
  });

  it('nullify limpia una relación opcional y emite afterUpdate', () => {
    const state = scenario_('nullify', false);

    resourceDelete_(
      state.ss,
      state.parent,
      state.parentMap,
      { method: 'DELETE', params: { key: 'p1' } },
      true,
    );

    expect(
      state.parentSheet
        .rows()
        .slice(1)
        .every((row) => row.every((value) => value === '')),
    ).toBe(true);
    expect(state.childSheet.rows().slice(1)).toEqual([['c1', '', 'Hijo']]);
    expect(fired.map((context) => [context.resource.id, context.action])).toEqual([
      [CHILD_ID, 'afterUpdate'],
      [PARENT_ID, 'delete'],
    ]);
    expect(fired[0].payload).toEqual({ parent_key: '' });
  });
});
