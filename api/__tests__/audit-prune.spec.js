// api/__tests__/audit-prune — endpoint y handler de poda de `_audit_log`
// (R9.5.1, B14 · auditoría configurable).
//
// Lo que éste archivo cubre y ninguna otra parte cubre:
//
//  1. **Sólo poda lo que declara `retention`.** La traza de `auth`, de
//     `setup` y la propia fila de poda no tienen plazo ⇒ no se tocan. La
//     poda es la única operación IRREVERSIBLE del sistema: destruye
//     historia, así que el sesgo es «conservar».
//  2. **Una fecha ilegible jamás se borra** (`sin-fecha`, texto raro): si
//     no se pudo datar, no se poda — nunca.
//  3. **Dry-run cuenta y no toca; `apply` borra y deja su rastro** en la
//     misma hoja (action `prune`), que a su vez no es podable.
//  4. **El endpoint está declarado** (ruta/método/acceso/límites, R5.1) y
//     el handler llega por la puerta única de capacidades (R3.14).
//
// La hoja en memoria es `_sheets.js` (misma superficie que las hojas
// reales, más `deleteRows` que es el único método nuevo que la poda usa).

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

const AUDIT_HEADERS = ['timestamp', 'actor', 'action', 'entity', 'entity_key', 'summary'];
const RESOURCE_ID = '__prune_test__';
const OTHER_ID = '__prune_other__';

let REGISTRY;
let auditSheet;
let origOpenSpreadsheet_;
let origSession;

/** Recurso mínimo: la poda sólo mira `policies.audit.retention`. */
function registerResource_(id, policies) {
  REGISTRY.resources[id] = {
    id,
    kind: 'collection',
    sheet: '__prune_sheet__' + id,
    keyField: 'key',
    titleField: 'name',
    policies,
    fields: [
      { key: 'key', type: 'text', required: true },
      { key: 'name', type: 'text' },
    ],
  };
}

function seed_(rows) {
  auditSheet = fakeSheet_([AUDIT_HEADERS, ...rows]);
}

/** Filas de datos (sin cabecera). */
function data_() {
  return auditSheet.rows().slice(1);
}

/** [timestamp, actor, action, entity, entity_key, summary] */
function row_(timestamp, entity, action = 'update', summary = 'x') {
  return [timestamp, 'tester@x.com', action, entity, 'k1', summary];
}

/** Falla si NO lanza; devuelve el error para seguir inspeccionando. */
function expectStatus_(fn, status, fragmento) {
  let error;
  try {
    fn();
  } catch (err) {
    error = err;
  }
  expect(error, 'esperaba que tirara').toBeDefined();
  expect(error.apiStatus).toBe(status);
  if (fragmento) expect(error.message).toContain(fragmento);
  return error;
}

const handle_ = (payload) =>
  REGISTRY.handlers.handleAuditPrune(payload, { path: '/admin/audit-prune' });

beforeAll(() => {
  REGISTRY = loadBackend();
});

beforeEach(() => {
  origOpenSpreadsheet_ = globalThis.openSpreadsheet_;
  origSession = globalThis.Session;
  globalThis.openSpreadsheet_ = () => fakeApp_({ _audit_log: auditSheet });
  // appendAuditRow_ pide el actor a Session: con la sesión de prueba el
  // actor es estable y no depende del stub inerte del harness.
  globalThis.Session = { getActiveUser: () => ({ getEmail: () => 'tester@x.com' }) };
  registerResource_(RESOURCE_ID, { audit: { fields: ['name'], retention: 30 } });
});

afterEach(() => {
  globalThis.openSpreadsheet_ = origOpenSpreadsheet_;
  globalThis.Session = origSession;
  delete REGISTRY.resources[RESOURCE_ID];
  delete REGISTRY.resources[OTHER_ID];
  vi.restoreAllMocks();
});

describe('R9.5.1 — endpoint declarado (B2 · R5.1)', () => {
  it('está en REGISTRY.endpoints con ruta, método, acceso y límites', () => {
    const endpoint = REGISTRY.endpoints.auditPrune;
    expect(endpoint).toBeDefined();
    expect(endpoint.route).toBe('/admin/audit-prune');
    expect(endpoint.method).toBe('POST');
    expect(endpoint.access).toBe('admin');
    expect(endpoint.limits).toBe('1/min');
    expect(endpoint.handler).toBe('handleAuditPrune');
    expect(endpoint.since).toBe('1.0');
  });

  it('el handler llega por la puerta única de capacidades (R3.14)', () => {
    expect(typeof REGISTRY.handlers.handleAuditPrune).toBe('function');
  });
});

describe('R9.5.1 — dry-run: cuenta y NO toca', () => {
  it('clasifica vencidas sin borrar una sola fila', () => {
    seed_([
      row_('2020-01-01 00:00:00', RESOURCE_ID), // vencida (30 días)
      row_(globalThis.nowStamp_(), RESOURCE_ID), // vigente
      row_('2020-01-01 00:00:00', 'auth'), // entity sin retention ⇒ no se poda
      row_('sin-fecha', RESOURCE_ID), // ilegible ⇒ no se poda
      row_(new Date('2019-06-01T00:00:00'), RESOURCE_ID), // vencida (celda Date)
    ]);

    const out = handle_({});

    expect(out.ok).toBe(true);
    expect(out.dryRun).toBe(true);
    expect(out.checked).toBe(5);
    expect(out.stale).toBe(2);
    expect(out.removed).toBe(0);
    expect(out.resources).toEqual([RESOURCE_ID]);
    expect(data_()).toHaveLength(5); // intactas, incluida la vencida
  });

  it('sin retention declarada no hay nada vencido', () => {
    registerResource_(RESOURCE_ID, { audit: true }); // forma histórica
    seed_([row_('2020-01-01 00:00:00', RESOURCE_ID)]);

    const out = handle_({});

    expect(out.ok).toBe(true);
    expect(out.resources).toEqual([]);
    expect(out.stale).toBe(0);
    expect(data_()).toHaveLength(1);
  });
});

describe('R9.5.1 — apply: borra lo vencido y deja su rastro', () => {
  it('sólo las vencidas de recursos con retention, y audita la poda', () => {
    seed_([
      row_('2020-01-01 00:00:00', RESOURCE_ID, 'create', 'Alta: A1'), // va
      row_(globalThis.nowStamp_(), RESOURCE_ID, 'update', 'Edición: A2'), // queda
      row_('2020-01-01 00:00:00', 'auth', 'login_ok', 'login_ok'), // queda
      row_('sin-fecha', RESOURCE_ID, 'update', 'Edición: A3'), // queda
      row_(new Date('2019-06-01T00:00:00'), RESOURCE_ID, 'delete', 'Baja: A4'), // va
    ]);

    const out = handle_({ apply: true });

    expect(out.ok).toBe(true);
    expect(out.dryRun).toBe(false);
    expect(out.stale).toBe(2);
    expect(out.removed).toBe(2);

    const restantes = data_();
    // 3 originales que sobreviven (vigente, auth, fecha ilegible) + la fila
    // de auditoría de la propia poda.
    expect(restantes).toHaveLength(4);
    expect(restantes.slice(0, 3).map((r) => r[5])).toEqual([
      'Edición: A2',
      'login_ok',
      'Edición: A3',
    ]);

    const traza = restantes[3];
    expect(traza[2]).toBe('prune');
    expect(traza[3]).toBe('_audit_log');
    expect(traza[4]).toBe('*');
    expect(traza[5]).toContain('Poda: 2 fila(s)');
  });

  it('acotado a un recurso, no toca las filas de otro', () => {
    registerResource_(OTHER_ID, { audit: { retention: 30 } });
    seed_([
      row_('2020-01-01 00:00:00', RESOURCE_ID),
      row_('2020-01-01 00:00:00', OTHER_ID),
      row_('2020-01-01 00:00:00', RESOURCE_ID),
    ]);

    const out = handle_({ apply: true, resource: RESOURCE_ID });

    expect(out.removed).toBe(2);
    expect(out.resources).toEqual([RESOURCE_ID]);
    const restantes = data_();
    expect(restantes).toHaveLength(2);
    expect(restantes[0][3]).toBe(OTHER_ID); // la del otro recurso sigue
    expect(restantes[1][3]).toBe('_audit_log'); // + la traza de la poda
  });
});

describe('R9.5.1 — entradas mal declaradas son ruidosas (400)', () => {
  it('recurso inexistente', () => {
    seed_([]);
    expectStatus_(() => handle_({ resource: 'nope' }), 400, 'Recurso desconocido');
  });

  it('recurso existente sin retention declarada', () => {
    registerResource_(OTHER_ID, { audit: true });
    seed_([]);
    expectStatus_(
      () => handle_({ resource: OTHER_ID }),
      400,
      'no declara policies.audit.retention',
    );
  });

  it('la hoja que el schema declara no existe ⇒ ok: false (drift, no «nada que podar»)', () => {
    globalThis.openSpreadsheet_ = () => fakeApp_({});
    const out = handle_({});
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('_audit_log');
  });

  it('hoja sólo con la cabecera ⇒ 0 revisadas', () => {
    seed_([]);
    const out = handle_({ apply: true });
    expect(out.ok).toBe(true);
    expect(out.checked).toBe(0);
    expect(out.removed).toBe(0);
  });
});
