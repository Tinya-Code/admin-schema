import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

let REGISTRY;
const RESOURCE_ID = '__ledger_fixture';
const PROFILE_ID = '__ledger_grant';
const UPLOAD_PROFILE_ID = '__ledger_upload';
const savedGlobals = {};
const originalResource = globalThis.REGISTRY?.resources?.[RESOURCE_ID];
const originalProfile = globalThis.REGISTRY?.grantProfiles?.[PROFILE_ID];
const originalUploadProfile = globalThis.REGISTRY?.uploadProfiles?.[UPLOAD_PROFILE_ID];
const originalAdapter = globalThis.REGISTRY?.capabilities?.adapters?.[UPLOAD_PROFILE_ID];

function keep(name) {
  if (!Object.prototype.hasOwnProperty.call(savedGlobals, name)) {
    savedGlobals[name] = globalThis[name];
  }
}

function makeFixture({ simulateJournalFailure = true } = {}) {
  const parentHeaders = ['id', 'state', 'updated_at', 'photo'];
  const historyHeaders = ['record_id', 'action', 'detail', 'at', 'operation_id'];
  const operationHeaders = globalThis.AUX_SHEETS._domain_operations.columns;
  const grantHeaders = globalThis.AUX_SHEETS._domain_grants.columns;
  const uploadHeaders = globalThis.AUX_SHEETS._domain_uploads.columns;
  const parentRows = [{ at: 2, values: ['record-1', 'PENDING', 'before', ''] }];
  const historyRows = [];
  const operationRows = [];
  const grantRows = [];
  const uploadRows = [];
  let failEventsWritten = simulateJournalFailure;

  function makeSheet(rows, onSetValues) {
    return {
      getLastRow: () => rows.length + 1,
      appendRow: (values) => rows.push({ at: rows.length + 2, values: values.slice() }),
      getRange: (row, _column, _numRows, _numColumns) => ({
        setValues: (values) => onSetValues(row, values),
        clearContent: () => {},
      }),
    };
  }

  const sheets = {
    _ledger_fixture: makeSheet(parentRows, (row, values) => {
      parentRows[row - 2].values = values[0].slice();
    }),
    _ledger_fixture_history: makeSheet(historyRows, (_row, values) => {
      historyRows.splice(
        0,
        historyRows.length,
        ...values.map((valuesRow, index) => ({ at: index + 2, values: valuesRow.slice() })),
      );
    }),
    _domain_operations: makeSheet(operationRows, (row, values) => {
      if (failEventsWritten && values[0][operationHeaders.indexOf('stage')] === 'events_written') {
        failEventsWritten = false;
        throw new Error('simulated journal interruption');
      }
      operationRows[row - 2].values = values[0].slice();
    }),
    _domain_grants: makeSheet(grantRows, (row, values) => {
      grantRows[row - 2].values = values[0].slice();
    }),
    _domain_uploads: makeSheet(uploadRows, (row, values) => {
      uploadRows[row - 2].values = values[0].slice();
    }),
  };

  const resource = {
    id: RESOURCE_ID,
    kind: 'collection',
    route: '/p/ledger-fixture',
    sheet: '_ledger_fixture',
    keyField: 'id',
    ordering: 'none',
    fields: [
      { key: 'id', type: 'text', required: true, unique: true },
      { key: 'state', type: 'select', required: true, enum: ['PENDING', 'DONE'] },
      { key: 'updated_at', type: 'readonly-text', system: true, computed: 'now' },
      { key: 'photo', type: 'image' },
      {
        key: 'history',
        type: 'list',
        sheet: '_ledger_fixture_history',
        fk: 'record_id',
        itemFields: [
          { key: 'action', type: 'select', required: true, enum: ['CHANGED'] },
          { key: 'detail', type: 'text' },
          { key: 'at', type: 'readonly-text', system: true, computed: 'now' },
          { key: 'operation_id', type: 'readonly-text', system: true },
        ],
      },
    ],
    policies: { audit: false, lock: true },
    commands: {
      changeState: {
        input: {
          detail: { type: 'text', required: true, maxLength: 50 },
          photo: { type: 'upload', profile: UPLOAD_PROFILE_ID, required: false },
        },
        output: {
          ok: { type: 'boolean', required: true },
          id: { type: 'text', required: true },
        },
        access: 'public',
        grant: PROFILE_ID,
        idempotency: 'required',
        preconditions: [{ field: 'state', op: 'eq', value: 'PENDING' }],
        changes: { state: { value: 'DONE' }, photo: { from: 'input.photo' } },
        events: [
          {
            appendTo: 'history',
            operationIdField: 'operation_id',
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
  REGISTRY.grantProfiles[PROFILE_ID] = {
    purpose: 'test-state-change',
    resource: RESOURCE_ID,
    command: 'changeState',
    ttlSeconds: 900,
    maxUses: 1,
  };
  REGISTRY.uploadProfiles[UPLOAD_PROFILE_ID] = {
    provider: UPLOAD_PROFILE_ID,
    resource: RESOURCE_ID,
    grant: PROFILE_ID,
    mimeTypes: ['image/png'],
    maxBytes: 1024,
    ttlSeconds: 900,
    namespace: 'fixture',
  };
  REGISTRY.capabilities.adapters[UPLOAD_PROFILE_ID] = {
    signUpload: (_profile, upload) => ({
      cloud_name: 'fixture-cloud',
      api_key: 'public-test-key',
      timestamp: 123,
      signature: 'signature',
      folder: 'fixture',
      public_id: 'fixture/' + upload.id,
      allowed_formats: ['png'],
      upload_url: 'https://upload.example.test',
    }),
    verifyUpload: (profile, response, expectedPublicId) => {
      if (response.public_id !== expectedPublicId || response.signature !== 'provider-signature') {
        throw globalThis.apiError_(401, 'bad provider signature', null, 'UPLOAD_INVALID');
      }
      if (response.bytes > profile.maxBytes || response.format !== 'png') {
        throw globalThis.apiError_(422, 'invalid upload profile', null, 'UPLOAD_INVALID');
      }
      return {
        secure_url:
          'https://res.cloudinary.com/fixture-cloud/image/upload/v1/' + expectedPublicId + '.png',
        format: 'png',
        bytes: response.bytes,
      };
    },
  };

  keep('readSheetData_');
  keep('openSpreadsheet_');
  keep('cacheInvalidate_');
  keep('Props');
  keep('Utilities');
  keep('LockService');
  globalThis.readSheetData_ = (_spreadsheet, name) => {
    const tables = {
      _ledger_fixture: [sheets._ledger_fixture, parentHeaders, parentRows],
      _ledger_fixture_history: [sheets._ledger_fixture_history, historyHeaders, historyRows],
      _domain_operations: [sheets._domain_operations, operationHeaders, operationRows],
      _domain_grants: [sheets._domain_grants, grantHeaders, grantRows],
      _domain_uploads: [sheets._domain_uploads, uploadHeaders, uploadRows],
    };
    const table = tables[name];
    if (!table) throw new Error('Unexpected sheet: ' + name);
    return {
      sheet: table[0],
      headers: table[1],
      rows: table[2],
    };
  };
  globalThis.openSpreadsheet_ = () => ({
    getSheetByName: (name) => sheets[name] || null,
  });
  globalThis.cacheInvalidate_ = () => {};
  const properties = {};
  globalThis.Props = {
    get: (name) => properties[name] || null,
    require: (name) => {
      if (name === 'CLOUDINARY_CLOUD_NAME') return 'fixture-cloud';
      throw new Error('Unexpected property: ' + name);
    },
    setAll: (values) => Object.assign(properties, values),
    hashText: (value) => createHash('sha256').update(String(value)).digest('hex'),
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
  globalThis.LockService = {
    getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }),
  };
  const grant = globalThis.issueDomainGrantLocked_(
    PROFILE_ID,
    'record-1',
    'pinVerify',
    'issuer-hash',
  );
  return {
    resource,
    parentRows,
    historyRows,
    grant,
    grantRows,
    operationRows,
    uploadRows,
  };
}

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
});

afterEach(() => {
  if (originalResource === undefined) delete REGISTRY.resources[RESOURCE_ID];
  else REGISTRY.resources[RESOURCE_ID] = originalResource;
  if (originalProfile === undefined) delete REGISTRY.grantProfiles[PROFILE_ID];
  else REGISTRY.grantProfiles[PROFILE_ID] = originalProfile;
  if (originalUploadProfile === undefined) delete REGISTRY.uploadProfiles[UPLOAD_PROFILE_ID];
  else REGISTRY.uploadProfiles[UPLOAD_PROFILE_ID] = originalUploadProfile;
  if (originalAdapter === undefined) delete REGISTRY.capabilities.adapters[UPLOAD_PROFILE_ID];
  else REGISTRY.capabilities.adapters[UPLOAD_PROFILE_ID] = originalAdapter;
  Object.keys(savedGlobals).forEach((name) => {
    globalThis[name] = savedGlobals[name];
    delete savedGlobals[name];
  });
});

function send(resource, grant, detail, idempotencyKey, photo) {
  const input = { detail };
  if (photo !== undefined) input.photo = photo;
  return globalThis.dispatchDomainCommand_(resource, resource.commands.changeState, {
    method: 'POST',
    command: 'changeState',
    params: { id: 'record-1' },
    payload: { input, grant, idempotencyKey },
    user: null,
  });
}

describe('journal y grants de commands', () => {
  it('recupera una escritura interrumpida, deduplica el evento y devuelve el resultado idempotente', () => {
    const { resource, parentRows, historyRows, grant, grantRows, operationRows } = makeFixture();

    expect(() => send(resource, grant.grant, 'capturado', 'request-key-000001')).toThrow(
      'simulated journal interruption',
    );
    expect(parentRows[0].values[1]).toBe('DONE');
    expect(historyRows).toHaveLength(1);
    expect(operationRows[0].values[7]).toBe('recoverable');

    const result = send(resource, grant.grant, 'capturado', 'request-key-000001');
    expect(result).toEqual({ ok: true, id: 'record-1' });
    expect(historyRows).toHaveLength(1);
    expect(historyRows[0].values[2]).toBe('capturado');
    expect(historyRows[0].values[4]).toContain(operationRows[0].values[0]);
    expect(operationRows[0].values[7]).toBe('completed');
    expect(grantRows[0].values[6]).toBe('consumed');

    expect(send(resource, grant.grant, 'capturado', 'request-key-000001')).toEqual(result);
    expect(historyRows).toHaveLength(1);
    expect(() => send(resource, grant.grant, 'otro valor', 'request-key-000001')).toThrow(
      /clave idempotente ya se usó/,
    );
    expect(() => send(resource, grant.grant, 'otro', 'request-key-000002')).toThrow(
      /ya fue utilizada/,
    );
  });

  it('no guarda el bearer grant en la hoja auxiliar', () => {
    const { grantRows, grant } = makeFixture();
    expect(grantRows[0].values).not.toContain(grant.grant);
    expect(grantRows[0].values[1]).toMatch(/^[a-f0-9]{64}$/);
    const retry = globalThis.issueDomainGrantLocked_(
      PROFILE_ID,
      'record-1',
      'pinVerify',
      'issuer-hash',
    );
    expect(retry.grant).toBe(grant.grant);
    expect(grantRows).toHaveLength(1);
  });

  it('rechaza grants vencidos o vinculados a otra clave', () => {
    const { resource, grant, grantRows } = makeFixture();
    try {
      globalThis.domainGrantForTokenLocked_(
        grant.grant,
        PROFILE_ID,
        resource,
        'other-record',
        'changeState',
        null,
        false,
      );
      throw new Error('Expected grant scope rejection');
    } catch (error) {
      expect(error.apiStatus).toBe(403);
      expect(error.apiCode).toBe('GRANT_SCOPE_MISMATCH');
    }

    grantRows[0].values[globalThis.AUX_SHEETS._domain_grants.columns.indexOf('expires_at')] =
      new Date(Date.now() - 1000).toISOString();
    try {
      send(resource, grant.grant, 'expired', 'request-key-expired');
      throw new Error('Expected expired grant rejection');
    } catch (error) {
      expect(error.apiStatus).toBe(410);
      expect(error.apiCode).toBe('GRANT_EXPIRED');
    }
  });

  it('revoca explícitamente un grant emitido y no permite su uso', () => {
    const { resource, grant, grantRows } = makeFixture();
    globalThis.revokeDomainGrantLocked_(grantRows[0].values[0]);
    try {
      send(resource, grant.grant, 'revoked', 'request-key-revoked');
      throw new Error('Expected revoked grant rejection');
    } catch (error) {
      expect(error.apiStatus).toBe(410);
      expect(error.apiCode).toBe('GRANT_EXPIRED');
    }
  });

  it('firma una carga desde el perfil declarado y sólo persiste su URL verificada', () => {
    const { resource, grant, parentRows, uploadRows } = makeFixture({
      simulateJournalFailure: false,
    });
    const signed = globalThis.handleDomainUploadSignature(
      { grant: grant.grant },
      { params: { profile: UPLOAD_PROFILE_ID } },
    );
    const result = send(resource, grant.grant, 'capturado', 'upload-request-key-001', {
      public_id: signed.public_id,
      secure_url: 'https://client-value.invalid/image.png',
      format: 'png',
      bytes: 200,
      version: 1,
      signature: 'provider-signature',
    });

    expect(result.ok).toBe(true);
    expect(parentRows[0].values[3]).toBe(
      'https://res.cloudinary.com/fixture-cloud/image/upload/v1/' + signed.public_id + '.png',
    );
    expect(
      uploadRows[0].values[globalThis.AUX_SHEETS._domain_uploads.columns.indexOf('status')],
    ).toBe('accepted');
    expect(uploadRows[0].values).not.toContain('https://client-value.invalid/image.png');
  });
});
