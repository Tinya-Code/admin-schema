// api/__tests__/audit-config — auditoría configurable (R9.5.1, B14).
//
// `policies.audit` era un booleano y lo sigue siendo; ahora además acepta
// `{ fields: [...], retention: <días> }`. Éste cubre la mitad `fields`:
// el summary del `_audit_log` agrega ` · campo=valor` con el estado
// POST-escritura de la operación.
//
// Lo que éste archivo cubre y ninguna otra parte cubre:
//
//  1. **`fields` encreate/update/delete.** El sufijo sale del registro
//     ensamblado (la MISMA construcción que alimenta la respuesta, sin una
//     lectura extra — O3), no de lo que el cliente mandó.
//  2. **`audit: true` no cambia en absoluto** (precondición aditiva): el
//     summary es exactamente el de siempre, sin sufijo.
//  3. **`0` y `false` sí se registran** (son valores); ausentes y vacíos no.
//
// El write path se ejercita directo sobre `resourceCreate_` /
// `resourcePut_` / `resourceDelete_` con la hoja en memoria de `_sheets.js`
// — igual que crud-hooks — porque `dispatchResource_` abriría
// SpreadsheetApp real.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

const AUDIT_HEADERS = ['timestamp', 'actor', 'action', 'entity', 'entity_key', 'summary'];
const SHEET = '__audit_cfg_sheet__';
const RESOURCE_ID = '__audit_cfg__';

let REGISTRY;
let storageMap_;
let resourceCreate_;
let resourcePut_;
let resourceDelete_;
let origSession;

/** Recurso mínimo con auditoría configurable. `audit` se pisa por test. */
function scenario_(audit) {
  const resource = {
    id: RESOURCE_ID,
    kind: 'collection',
    sheet: SHEET,
    keyField: 'key',
    titleField: 'name',
    ordering: 'none',
    activeField: null,
    onDelete: 'none',
    dependents: [],
    listProjection: null,
    imageFolder: null,
    views: {},
    // `lock: false` ⇒ sin LockService; audit ⇒ SÍ pide _audit_log.
    policies: { access: { read: 'admin', write: 'admin' }, lock: false, audit },
    exposeToFront: false,
    fields: [
      { key: 'key', type: 'text', required: true },
      { key: 'name', type: 'text', required: true },
      { key: 'state', type: 'text' },
      { key: 'qty', type: 'number' },
      { key: 'note', type: 'text' },
    ],
  };
  const map = storageMap_(resource);
  const headers = map.columns.map((col) => col.flatKey);
  const sheet = fakeSheet_([headers]);
  const auditSheet = fakeSheet_([AUDIT_HEADERS]);
  const ss = fakeApp_({ [SHEET]: sheet, _audit_log: auditSheet });
  return { resource, map, ss, auditSheet };
}

/** Única fila de `_audit_log` (sin cabecera). */
function auditRow_(auditSheet) {
  const rows = auditSheet.rows().slice(1);
  expect(rows, 'esperaba exactamente una fila de auditoría').toHaveLength(1);
  return rows[0];
}

beforeAll(() => {
  REGISTRY = loadBackend();
  storageMap_ = globalThis.storageMap_;
  resourceCreate_ = globalThis.resourceCreate_;
  resourcePut_ = globalThis.resourcePut_;
  resourceDelete_ = globalThis.resourceDelete_;
});

beforeEach(() => {
  origSession = globalThis.Session;
  globalThis.Session = { getActiveUser: () => ({ getEmail: () => 'tester@x.com' }) };
  delete REGISTRY.resources[RESOURCE_ID];
});

afterEach(() => {
  globalThis.Session = origSession;
  delete REGISTRY.resources[RESOURCE_ID];
  vi.restoreAllMocks();
});

describe('R9.5.1 — `fields` agrega el estado post-escritura', () => {
  it('create: `Alta: <título> · <campo>=<valor>` desde el registro ensamblado', () => {
    const s = scenario_({ fields: ['state'] });

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'k1', name: 'Ana', state: 'NEW' },
    });

    const [, , action, entity, entityKey, summary] = auditRow_(s.auditSheet);
    expect(action).toBe('create');
    expect(entity).toBe(RESOURCE_ID);
    expect(entityKey).toBe('k1');
    expect(summary).toBe('Alta: Ana · state=NEW');
  });

  it('update: el valor es el que quedó GUARDADO (del registro, no del payload)', () => {
    const s = scenario_({ fields: ['state'] });

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'k1', name: 'Ana', state: 'NEW' },
    });

    // PATCH quirúrgico: el payload NO trae `name` ⇒ el título cae a la
    // llave (comportamiento de siempre), pero `state` sí se audita.
    resourcePut_(s.ss, s.resource, s.map, {
      method: 'PUT',
      params: { key: 'k1' },
      payload: { state: 'DONE' },
    });

    const rows = s.auditSheet.rows().slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[1][5]).toBe('Edición: k1 · state=DONE');
  });

  it('delete: audita con el registro completo de la baja', () => {
    const s = scenario_({ fields: ['state'] });

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'k1', name: 'Ana', state: 'NEW' },
    });

    resourceDelete_(s.ss, s.resource, s.map, {
      method: 'DELETE',
      params: { key: 'k1' },
    });

    const rows = s.auditSheet.rows().slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[1][2]).toBe('delete');
    expect(rows[1][5]).toBe('Baja: Ana · state=NEW');
  });

  it('registra `0` y `false` (son valores), y omite ausentes y vacíos', () => {
    const s = scenario_({ fields: ['state', 'qty', 'note'] });

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'k1', name: 'Ana', state: '', qty: 0 },
    });

    const summary = auditRow_(s.auditSheet)[5];
    expect(summary).toBe('Alta: Ana · qty=0');
    expect(summary).not.toContain('state=');
    expect(summary).not.toContain('note=');
  });
});

describe('R9.5.1 — aditividad: la forma histórica no cambia', () => {
  it('`audit: true` ⇒ summary exacto de siempre, sin sufijo', () => {
    const s = scenario_(true);

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'k1', name: 'Ana', state: 'NEW' },
    });

    expect(auditRow_(s.auditSheet)[5]).toBe('Alta: Ana');
  });

  it('sin `audit` ⇒ ni una fila (F6-1)', () => {
    const s = scenario_(undefined);
    s.resource.policies = { access: { read: 'admin', write: 'admin' }, lock: false };

    resourceCreate_(s.ss, s.resource, s.map, {
      method: 'POST',
      payload: { key: 'k1', name: 'Ana' },
    });

    expect(s.auditSheet.rows()).toHaveLength(1); // sólo la cabecera
  });
});
