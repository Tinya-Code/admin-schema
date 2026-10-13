// api/__tests__/create-idempotency — idempotencia recuperable del create
// (R9.5.2, B14 · otras capacidades).
//
// Lo que éste archivo cubre y ninguna otra parte cubre:
//
//  1. **Un solo libro para dos mecanismos**: el create usa
//     `_domain_operations`, el MISMO registro que los commands (32) — no
//     hay un segundo ledger que pudiera contradecir al primero.
//  2. **Sin clave nada cambia**: el create de siempre ni mira el libro.
//  3. **Misma clave + mismo payload ⇒ la respuesta ORIGINAL, sin fila
//     doble** (el replay sale del `result_json` guardado).
//  4. **Misma clave + otro payload ⇒ 409 `IDEMPOTENCY_CONFLICT`**; una
//     clave con estado `failed` ⇒ 409 `OPERATION_FAILED`.
//  5. **Reanudación**: el libro registra la intención ANTES del write
//     (Sheets no tiene transacciones). Si el create quedó a medias: fila ya
//     escrita ⇒ se devuelve sin duplicar; sin fila ⇒ se re-aplica el
//     payload GUARDADO, nunca el del reintento.
//  6. **Si el recurso DECLARA un campo `idempotencyKey`, el campo gana**
//     (aditividad): se guarda como cualquier otro dato y no hay libro.
//
// La hoja en memoria es `_sheets.js` (misma superficie que las reales).

import { createHmac } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';
import { fakeApp_, fakeSheet_ } from './_sheets.js';

const SHEET = '__idem_sheet__';
const RESOURCE_ID = '__idem__';
// Las cabeceras del libro salen del registro (AUX_SHEETS), que sólo existe
// DESPUÉS de loadBackend(): se resuelven dentro de scenario_.
const KEY = 'idem-key-0123456789abcdef'; // 26 chars: dentro del rango 16..128

let REGISTRY;
let OPERATION_HEADERS;
let map_;
let sheet;
let operationsSheet;
let ss;
let origOpenSpreadsheet_;
let origUtilities;
let origProps;

/** Recurso mínimo; `extraFields` permite declarar `idempotencyKey` como dato. */
function scenario_(extraFields) {
  const resource = {
    id: RESOURCE_ID,
    kind: 'collection',
    sheet: SHEET,
    keyField: 'key',
    titleField: 'name',
    ordering: 'none',
    policies: { access: { read: 'admin', write: 'admin' }, lock: false, audit: false },
    fields: [
      { key: 'key', type: 'text', required: true },
      { key: 'name', type: 'text', required: true },
    ].concat(extraFields || []),
  };
  OPERATION_HEADERS = globalThis.AUX_SHEETS._domain_operations.columns;
  sheet = fakeSheet_([['key', 'name', 'idempotencyKey']]);
  operationsSheet = fakeSheet_([OPERATION_HEADERS]);
  ss = fakeApp_({ [SHEET]: sheet, _domain_operations: operationsSheet });
  globalThis.openSpreadsheet_ = () => ss;
  // El mapa de storage y la caché se memorizan por id de recurso: cada
  // escenario declara campos distintos, así que se limpian antes de derivar.
  delete globalThis.STORAGE_MAPS_[RESOURCE_ID];
  globalThis.cacheInvalidate_(RESOURCE_ID);
  map_ = globalThis.storageMap_(resource);
  return resource;
}

const create_ = (resource, payload) =>
  globalThis.resourceCreate_(ss, resource, map_, { method: 'POST', payload });

/** Filas de datos (sin cabecera). */
const data_ = () => sheet.rows().slice(1);
/** Filas del libro (sin cabecera). */
const ops_ = () => operationsSheet.rows().slice(1);

/** Campo de la única operación registrada (undefined si no hay). */
const opField_ = (field) => (ops_()[0] ? ops_()[0][OPERATION_HEADERS.indexOf(field)] : undefined);

/** Parchea la única operación registrada (simula una interrupción). */
function patchOp_(fields) {
  const values = operationsSheet.rows()[1].slice();
  Object.keys(fields).forEach((field) => {
    values[OPERATION_HEADERS.indexOf(field)] = fields[field];
  });
  operationsSheet.getRange(2, 1, 1, values.length).setValues([values]);
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

beforeAll(() => {
  REGISTRY = loadBackend();
});

beforeEach(() => {
  origOpenSpreadsheet_ = globalThis.openSpreadsheet_;
  origUtilities = globalThis.Utilities;
  origProps = globalThis.Props;
  // El libro firma con HMAC y genera uuids: el stub inerte del harness no
  // sirve acá (mismo criterio que domain-ledger.spec).
  const properties = {};
  globalThis.Props = {
    get: (name) => properties[name] || null,
    setAll: (values) => Object.assign(properties, values),
    generateToken: () => 'test-secret-token',
    isDev: () => true,
  };
  let uuid = 0;
  globalThis.Utilities = {
    Charset: { UTF_8: 'utf8' },
    getUuid: () => 'uuid-' + ++uuid,
    computeHmacSha256Signature: (value, key) =>
      Array.from(createHmac('sha256', key).update(String(value)).digest()),
  };
});

afterEach(() => {
  globalThis.openSpreadsheet_ = origOpenSpreadsheet_;
  globalThis.Utilities = origUtilities;
  globalThis.Props = origProps;
  delete REGISTRY.resources[RESOURCE_ID];
});

describe('R9.5.2 — aditividad: sin clave nada cambia', () => {
  it('crea igual que siempre y no escribe ni una fila en el libro', () => {
    const s = scenario_();

    const out = create_(s, { key: 'k1', name: 'Ana' });

    expect(out).toBeDefined();
    expect(data_()).toHaveLength(1);
    expect(ops_()).toHaveLength(0);
  });

  it('un campo declarado `idempotencyKey` es DATO, no control (el campo gana)', () => {
    const s = scenario_([{ key: 'idempotencyKey', type: 'text' }]);

    create_(s, { key: 'k1', name: 'Ana', idempotencyKey: 'corta' });

    expect(data_()).toHaveLength(1);
    expect(data_()[0][2]).toBe('corta'); // quedó en su columna
    expect(ops_()).toHaveLength(0); // sin libro: no hay semántica de replay
  });
});

describe('R9.5.2 — misma clave, mismo payload', () => {
  it('devuelve la respuesta ORIGINAL y no crea una segunda fila', () => {
    const s = scenario_();
    const payload = { key: 'k1', name: 'Ana', idempotencyKey: KEY };

    const first = create_(s, payload);
    const second = create_(s, payload);

    expect(second).toEqual(first); // el replay sale del result_json guardado
    expect(data_()).toHaveLength(1); // sin fila doble
    expect(ops_()).toHaveLength(1); // UN libro, el de los commands
    expect(opField_('status')).toBe('completed');
    expect(opField_('command')).toBe('create');
    expect(opField_('resource_key')).toBe('k1');
  });

  it('la clave no se filtra a la fila ni a la respuesta', () => {
    const s = scenario_();

    const out = create_(s, { key: 'k1', name: 'Ana', idempotencyKey: KEY });

    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(data_()[0][0]).toBe('k1');
    expect(data_()[0][1]).toBe('Ana');
  });
});

describe('R9.5.2 — conflictos', () => {
  it('misma clave con OTRO payload ⇒ 409 IDEMPOTENCY_CONFLICT', () => {
    const s = scenario_();
    create_(s, { key: 'k1', name: 'Ana', idempotencyKey: KEY });

    const err = expectStatus_(
      () => create_(s, { key: 'k2', name: 'Otro', idempotencyKey: KEY }),
      409,
      'La clave idempotente ya se usó con otra solicitud',
    );

    expect(err.apiCode).toBe('IDEMPOTENCY_CONFLICT');
    expect(data_()).toHaveLength(1); // el intento conflictivo no escribe
  });

  it('una operación fallida no se reintenta ⇒ 409 OPERATION_FAILED', () => {
    const s = scenario_();
    create_(s, { key: 'k1', name: 'Ana', idempotencyKey: KEY });
    patchOp_({ status: 'failed' });

    const err = expectStatus_(
      () => create_(s, { key: 'k1', name: 'Ana', idempotencyKey: KEY }),
      409,
      'La operación falló',
    );

    expect(err.apiCode).toBe('OPERATION_FAILED');
  });

  it('clave mal formada ⇒ 422 VALIDATION_IDEMPOTENCY_KEY (mismas reglas que commands)', () => {
    const s = scenario_();

    for (const bad of ['corta', 'x'.repeat(129), 12345, null]) {
      const err = expectStatus_(
        () => create_(s, { key: 'k1', name: 'Ana', idempotencyKey: bad }),
        422,
      );
      expect(err.apiErrors[0].path).toBe('idempotencyKey');
      expect(err.apiErrors[0].code).toBe('VALIDATION_IDEMPOTENCY_KEY');
      expect(err.apiErrors[0].message).toContain('16 a 128');
    }

    expect(data_()).toHaveLength(0); // nada se escribió
    expect(ops_()).toHaveLength(0);
  });
});

describe('R9.5.2 — reanudación desde el libro', () => {
  it('fila ya escrita ⇒ replay sin duplicar', () => {
    const s = scenario_();
    const payload = { key: 'k1', name: 'Ana', idempotencyKey: KEY };
    const first = create_(s, payload);
    // Interrupción simulada: el write de la fila PASÓ, el libro quedó a medias.
    patchOp_({ status: 'recoverable', stage: 'record_written', result_json: '' });

    const again = create_(s, payload);

    expect(again).toEqual(first);
    expect(data_()).toHaveLength(1); // sin fila doble
    expect(opField_('status')).toBe('completed'); // el libro se cerró
  });

  it('sin la fila ⇒ re-aplica el payload GUARDADO en el libro', () => {
    const s = scenario_();
    const payload = { key: 'k1', name: 'Ana', idempotencyKey: KEY };
    const first = create_(s, payload);
    sheet.rows().splice(1, 1); // la fila se perdió antes del commit del libro
    patchOp_({ status: 'recoverable', stage: 'applying', result_json: '' });

    const again = create_(s, { key: 'k1', name: 'Ana', idempotencyKey: KEY });

    expect(again).toEqual(first);
    expect(data_()).toHaveLength(1); // se re-aplicó, una sola vez
    expect(opField_('status')).toBe('completed');
    expect(opField_('stage')).toBe('completed');
  });

  it('una clave nunca vista registra la intención ANTES de escribir', () => {
    const s = scenario_();

    create_(s, { key: 'k1', name: 'Ana', idempotencyKey: KEY });

    expect(ops_()).toHaveLength(1);
    expect(opField_('status')).toBe('completed');
    expect(String(opField_('idempotency_hash'))).toHaveLength(64); // HMAC-SHA256
    expect(String(opField_('request_hash'))).toHaveLength(64);
  });
});
