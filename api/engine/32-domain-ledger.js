// engine/32-domain-ledger — Grants e idempotencia recuperable para commands.
//
// Todas las funciones *Locked_ requieren el lock global ya adquirido. Sheets
// no ofrece transacciones: los efectos del comando son repetibles y cada
// evento lleva un operation id para recuperarse sin duplicarlo.

var DOMAIN_GRANT_SECRET_PROPERTY_ = 'DOMAIN_GRANT_SECRET';
var DOMAIN_OPERATION_STATES_ = ['prepared', 'applying', 'recoverable', 'completed', 'failed'];

function domainSecret_() {
  var secret = Props.get(DOMAIN_GRANT_SECRET_PROPERTY_);
  if (secret !== null) return secret;
  secret = Props.generateToken();
  Props.setAll({ DOMAIN_GRANT_SECRET: secret });
  return secret;
}

function domainHmac_(value) {
  var bytes = Utilities.computeHmacSha256Signature(
    String(value),
    domainSecret_(),
    Utilities.Charset.UTF_8,
  );
  return bytes
    .map(function (byte) {
      return (byte + 256).toString(16).slice(-2);
    })
    .join('');
}

function domainCanonical_(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(domainCanonical_).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(function (key) {
          return JSON.stringify(key) + ':' + domainCanonical_(value[key]);
        })
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

function domainNow_() {
  return new Date().toISOString();
}

function domainDateMs_(value) {
  if (value instanceof Date) return value.getTime();
  var parsed = Date.parse(String(value || ''));
  return isFinite(parsed) ? parsed : NaN;
}

function domainRowObject_(headers, values) {
  var row = {};
  headers.forEach(function (header, index) {
    row[header] = values[index];
  });
  return row;
}

function domainReadRows_(name) {
  var data = readSheetData_(openSpreadsheet_(), name);
  var missing = AUX_SHEETS[name].columns.filter(function (column) {
    return data.headers.indexOf(column) === -1;
  });
  if (missing.length > 0) {
    throw apiError_(
      500,
      'La hoja ' + name + ' no tiene columnas: ' + missing.join(', ') + '. Correr setupDrift.',
    );
  }
  return {
    sheet: data.sheet,
    headers: data.headers,
    rows: data.rows.map(function (row) {
      return {
        at: row.at,
        values: row.values,
        record: domainRowObject_(data.headers, row.values),
      };
    }),
  };
}

function domainAppendRow_(name, values) {
  var data = domainReadRows_(name);
  var row = data.headers.map(function (header) {
    return Object.prototype.hasOwnProperty.call(values, header) ? values[header] : '';
  });
  data.sheet.appendRow(row);
  return data.sheet.getLastRow();
}

function domainUpdateRow_(data, row, patch) {
  var values = row.values.slice();
  Object.keys(patch).forEach(function (key) {
    var index = data.headers.indexOf(key);
    if (index === -1) throw apiError_(500, 'Columna ausente en hoja auxiliar: ' + key);
    values[index] = patch[key];
  });
  data.sheet.getRange(row.at, 1, 1, data.headers.length).setValues([values]);
  row.values = values;
  row.record = domainRowObject_(data.headers, values);
}

function domainFindGrantByIssuer_(issuerId, issuerHash) {
  var data = domainReadRows_('_domain_grants');
  for (var i = 0; i < data.rows.length; i++) {
    var record = data.rows[i].record;
    if (
      String(record.issuer_id) === String(issuerId) &&
      constantTimeEqual_(String(record.issuer_hash), String(issuerHash))
    ) {
      return { data: data, row: data.rows[i] };
    }
  }
  return null;
}

function domainGrantToken_(grantId) {
  return domainHmac_('domain-grant:v1:' + grantId);
}

function issueDomainGrantLocked_(profileId, resourceKey, issuerId, issuerHash) {
  var profile = REGISTRY.grantProfiles[profileId];
  if (!profile) throw apiError_(500, 'Perfil de grant no registrado');
  if (
    issuerId === undefined ||
    issuerId === null ||
    String(issuerId) === '' ||
    typeof issuerHash !== 'string' ||
    issuerHash === ''
  ) {
    throw apiError_(500, 'El emisor del grant debe aportar un identificador y un hash');
  }
  var existing = domainFindGrantByIssuer_(issuerId, issuerHash);
  if (existing !== null) {
    var old = existing.row.record;
    var oldExpiry = domainDateMs_(old.expires_at);
    if (!isFinite(oldExpiry) || oldExpiry <= Date.now()) {
      throw apiError_(410, 'La autorización ya expiró', null, 'GRANT_EXPIRED');
    }
    if (
      old.purpose !== profile.purpose ||
      old.resource !== profile.resource ||
      String(old.resource_key) !== String(resourceKey) ||
      old.command !== profile.command
    ) {
      throw apiError_(409, 'La autorización existente no coincide con el propósito solicitado');
    }
    return {
      grant: domainGrantToken_(String(old.id)),
      expires_at: new Date(oldExpiry).toISOString(),
    };
  }

  var now = domainNow_();
  var id = Utilities.getUuid();
  var expiry = new Date(Date.now() + profile.ttlSeconds * 1000).toISOString();
  domainAppendRow_('_domain_grants', {
    id: id,
    secret_hash: Props.hashText(domainGrantToken_(id)),
    purpose: profile.purpose,
    resource: profile.resource,
    resource_key: String(resourceKey),
    command: profile.command,
    status: 'issued',
    expires_at: expiry,
    max_uses: profile.maxUses,
    uses: 0,
    used_operation_ids: '[]',
    created_at: now,
    updated_at: now,
    issuer_id: issuerId,
    issuer_hash: issuerHash,
    operation_id: '',
  });
  return { grant: domainGrantToken_(id), expires_at: expiry };
}

function domainGrantForTokenLocked_(
  token,
  profileId,
  resource,
  key,
  command,
  operationId,
  lookupOnly,
) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) {
    throw apiError_(401, 'Autorización inválida', null, 'GRANT_INVALID');
  }
  var suppliedHash = Props.hashText(token);
  var data = domainReadRows_('_domain_grants');
  var found = null;
  data.rows.some(function (row) {
    if (constantTimeEqual_(String(row.record.secret_hash), suppliedHash)) {
      found = row;
      return true;
    }
    return false;
  });
  if (found === null) throw apiError_(401, 'Autorización inválida', null, 'GRANT_INVALID');
  var record = found.record;
  var profile = REGISTRY.grantProfiles[profileId];
  if (
    !profile ||
    record.purpose !== profile.purpose ||
    record.resource !== resource.id ||
    String(record.resource_key) !== String(key) ||
    record.command !== command
  ) {
    throw apiError_(
      403,
      'La autorización no corresponde a este comando',
      null,
      'GRANT_SCOPE_MISMATCH',
    );
  }
  if (lookupOnly === true) {
    return { data: data, row: found, id: String(record.id), record: record };
  }
  var sameOperation =
    operationId !== null &&
    operationId !== undefined &&
    String(record.operation_id) === String(operationId);
  var expiry = domainDateMs_(record.expires_at);
  var usedOperationIds = domainOperationIds_(record.used_operation_ids);
  if (
    (!isFinite(expiry) || expiry <= Date.now()) &&
    !(record.status === 'reserved' && sameOperation) &&
    !(usedOperationIds.indexOf(String(operationId)) !== -1 && sameOperation)
  ) {
    if (record.status === 'issued') {
      domainUpdateRow_(data, found, { status: 'expired', updated_at: domainNow_() });
    }
    throw apiError_(410, 'La autorización expiró', null, 'GRANT_EXPIRED');
  }
  if (record.status === 'revoked' || record.status === 'expired') {
    throw apiError_(410, 'La autorización ya no está activa', null, 'GRANT_EXPIRED');
  }
  if (record.status === 'reserved' && !sameOperation) {
    var priorOperation = domainOperationById_(String(record.operation_id));
    if (priorOperation && priorOperation.row.record.status === 'completed') {
      releaseDomainGrantLocked_(found, String(record.operation_id));
      return domainGrantForTokenLocked_(
        token,
        profileId,
        resource,
        key,
        command,
        operationId,
        false,
      );
    }
    throw apiError_(409, 'La autorización está siendo utilizada', null, 'GRANT_IN_PROGRESS');
  }
  if (record.status === 'consumed' && !sameOperation) {
    throw apiError_(409, 'La autorización ya fue utilizada', null, 'GRANT_CONSUMED');
  }
  if (Number(record.uses) >= Number(record.max_uses) && !sameOperation) {
    throw apiError_(409, 'La autorización agotó sus usos', null, 'GRANT_CONSUMED');
  }
  return { data: data, row: found, id: String(record.id), record: record };
}

function reserveDomainGrantLocked_(grant, operationId) {
  if (grant === null) return;
  if (String(grant.row.record.operation_id) === String(operationId)) return;
  if (grant.row.record.status !== 'issued') {
    throw apiError_(409, 'La autorización no está disponible', null, 'GRANT_CONSUMED');
  }
  domainUpdateRow_(grant.data, grant.row, {
    status: 'reserved',
    operation_id: operationId,
    updated_at: domainNow_(),
  });
}

function revokeDomainGrantLocked_(grantId) {
  var data = domainReadRows_('_domain_grants');
  var found = null;
  data.rows.some(function (row) {
    if (String(row.record.id) === String(grantId)) {
      found = row;
      return true;
    }
    return false;
  });
  if (found === null) throw apiError_(404, 'Grant no encontrado', null, 'GRANT_NOT_FOUND');
  if (found.record.status === 'reserved') {
    throw apiError_(409, 'No se puede revocar un grant reservado', null, 'GRANT_IN_PROGRESS');
  }
  if (found.record.status === 'consumed') {
    throw apiError_(409, 'No se puede revocar un grant consumido', null, 'GRANT_CONSUMED');
  }
  if (found.record.status === 'revoked') return;
  domainUpdateRow_(data, found, { status: 'revoked', updated_at: domainNow_() });
}

function domainOperationIds_(raw) {
  try {
    var parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (error) {
    throw apiError_(500, 'El registro de usos del grant está dañado');
  }
}

function domainGrantRecordForTokenLocked_(token) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) {
    throw apiError_(401, 'Autorización inválida', null, 'GRANT_INVALID');
  }
  var hash = Props.hashText(token);
  var data = domainReadRows_('_domain_grants');
  var found = null;
  data.rows.some(function (row) {
    if (constantTimeEqual_(String(row.record.secret_hash), hash)) {
      found = row;
      return true;
    }
    return false;
  });
  if (found === null) throw apiError_(401, 'Autorización inválida', null, 'GRANT_INVALID');
  return { data: data, row: found, id: String(found.record.id), record: found.record };
}

function domainFindUpload_(id) {
  var data = domainReadRows_('_domain_uploads');
  var found = null;
  data.rows.some(function (row) {
    if (String(row.record.id) === String(id)) {
      found = row;
      return true;
    }
    return false;
  });
  return found === null ? null : { data: data, row: found };
}

function domainFindUploadByPublicId_(publicId) {
  var data = domainReadRows_('_domain_uploads');
  var found = null;
  data.rows.some(function (row) {
    if (String(row.record.public_id) === String(publicId)) {
      found = row;
      return true;
    }
    return false;
  });
  return found === null ? null : { data: data, row: found };
}

function verifyDomainCommandUploadsLocked_(resource, command, request, key, grant) {
  var input = {};
  Object.keys(request.payload.input || {}).forEach(function (name) {
    input[name] = request.payload.input[name];
  });
  var verifiedUploads = [];
  Object.keys(command.input || {}).forEach(function (name) {
    var declaration = command.input[name];
    if (declaration.type !== 'upload' || input[name] === undefined || input[name] === null) return;
    if (!grant) throw apiError_(401, 'La carga requiere una autorización', null, 'GRANT_REQUIRED');
    var profile = REGISTRY.uploadProfiles[declaration.profile];
    if (!profile || profile.resource !== resource.id || profile.grant !== command.grant) {
      throw apiError_(500, 'Perfil de carga fuera del contrato del comando');
    }
    var upload = domainFindUploadByPublicId_(input[name].public_id);
    if (upload === null) {
      throw apiError_(
        403,
        'La carga no fue emitida para esta autorización',
        null,
        'UPLOAD_SCOPE_MISMATCH',
      );
    }
    var record = upload.row.record;
    if (
      String(record.grant_id) !== String(grant.id) ||
      record.profile !== declaration.profile ||
      record.resource !== resource.id ||
      String(record.resource_key) !== String(key) ||
      record.provider !== profile.provider
    ) {
      throw apiError_(403, 'La carga no corresponde a este comando', null, 'UPLOAD_SCOPE_MISMATCH');
    }
    var expiry = domainDateMs_(record.expires_at);
    if (!isFinite(expiry) || expiry <= Date.now()) {
      if (record.status === 'issued') {
        domainUpdateRow_(upload.data, upload.row, { status: 'expired', updated_at: domainNow_() });
      }
      throw apiError_(410, 'La carga temporal expiró', null, 'UPLOAD_EXPIRED');
    }
    if (record.status !== 'issued') {
      throw apiError_(
        409,
        'La carga ya fue aceptada o está vinculada a otra operación',
        null,
        'UPLOAD_CONSUMED',
      );
    }
    var adapter = REGISTRY.capabilities.adapters[profile.provider];
    if (!adapter || typeof adapter.verifyUpload !== 'function') {
      throw apiError_(
        503,
        'El proveedor de carga no está disponible',
        null,
        'UPLOAD_PROVIDER_UNAVAILABLE',
      );
    }
    var verified = adapter.verifyUpload(profile, input[name], String(record.public_id));
    input[name] = verified.secure_url;
    verifiedUploads.push({
      id: String(record.id),
      secure_url: verified.secure_url,
      format: verified.format,
      bytes: verified.bytes,
    });
  });
  return { input: input, uploads: verifiedUploads };
}

function reserveDomainUploadsLocked_(uploads, grantId, operationId) {
  (uploads || []).forEach(function (upload) {
    var entry = domainFindUpload_(upload.id);
    if (entry === null) throw apiError_(500, 'Carga verificada no encontrada');
    var record = entry.row.record;
    if (
      (record.status === 'completed' || record.status === 'accepted') &&
      String(record.operation_id) === String(operationId)
    ) {
      return;
    }
    if (record.status !== 'issued' || String(record.grant_id) !== String(grantId)) {
      throw apiError_(
        409,
        'La carga no está disponible para esta operación',
        null,
        'UPLOAD_CONSUMED',
      );
    }
    domainUpdateRow_(entry.data, entry.row, {
      status: 'completed',
      secure_url: upload.secure_url,
      format: upload.format,
      bytes: upload.bytes,
      operation_id: operationId,
      updated_at: domainNow_(),
    });
  });
}

function acceptDomainUploadsLocked_(uploads, operationId) {
  (uploads || []).forEach(function (upload) {
    var entry = domainFindUpload_(upload.id);
    if (entry === null) throw apiError_(500, 'Carga verificada no encontrada');
    var record = entry.row.record;
    if (record.status === 'accepted' && String(record.operation_id) === String(operationId)) return;
    if (record.status !== 'completed' || String(record.operation_id) !== String(operationId)) {
      throw apiError_(409, 'La carga perdió su reserva', null, 'UPLOAD_CONSUMED');
    }
    domainUpdateRow_(entry.data, entry.row, { status: 'accepted', updated_at: domainNow_() });
  });
}

function consumeDomainGrantLocked_(grantId, operationId) {
  if (!grantId) return;
  var data = domainReadRows_('_domain_grants');
  var found = null;
  data.rows.some(function (row) {
    if (String(row.record.id) === String(grantId)) {
      found = row;
      return true;
    }
    return false;
  });
  if (found === null) throw apiError_(500, 'Grant reservado no encontrado');
  var record = found.record;
  var usedOperationIds = domainOperationIds_(record.used_operation_ids);
  if (record.status !== 'reserved' || String(record.operation_id) !== String(operationId)) {
    throw apiError_(409, 'El grant perdió su reserva', null, 'GRANT_IN_PROGRESS');
  }
  if (usedOperationIds.indexOf(String(operationId)) !== -1) return;
  usedOperationIds.push(String(operationId));
  var uses = Number(record.uses) + 1;
  domainUpdateRow_(data, found, {
    uses: uses,
    status: 'reserved',
    used_operation_ids: JSON.stringify(usedOperationIds),
    updated_at: domainNow_(),
  });
}

function releaseDomainGrantLocked_(grant, operationId) {
  var data = domainReadRows_('_domain_grants');
  var current = null;
  data.rows.some(function (row) {
    if (String(row.record.id) === String(grant.id)) {
      current = row;
      return true;
    }
    return false;
  });
  if (current === null) throw apiError_(500, 'Grant reservado no encontrado');
  var record = current.record;
  if (record.status !== 'reserved' || String(record.operation_id) !== String(operationId)) {
    return;
  }
  var uses = Number(record.uses);
  domainUpdateRow_(data, current, {
    status: uses >= Number(record.max_uses) ? 'consumed' : 'issued',
    operation_id: '',
    updated_at: domainNow_(),
  });
}

function domainOperationById_(id) {
  var data = domainReadRows_('_domain_operations');
  var found = null;
  data.rows.some(function (row) {
    if (String(row.record.id) === String(id)) {
      found = row;
      return true;
    }
    return false;
  });
  return found === null ? null : { data: data, row: found };
}

function domainOperationFind_(idempotencyHash) {
  var data = domainReadRows_('_domain_operations');
  var found = null;
  data.rows.some(function (row) {
    if (constantTimeEqual_(String(row.record.idempotency_hash), idempotencyHash)) {
      found = row;
      return true;
    }
    return false;
  });
  return found === null ? null : { data: data, row: found };
}

function domainOperationWrite_(entry, patch) {
  domainUpdateRow_(entry.data, entry.row, Object.assign({ updated_at: domainNow_() }, patch));
}

function domainOperationResult_(record) {
  try {
    var result = JSON.parse(String(record.result_json || ''));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid');
    return result;
  } catch (error) {
    throw apiError_(500, 'El resultado guardado de la operación está dañado');
  }
}

// Entrada completa (`{ data, row }`) de una operación recién registrada.
// Compartida por el comando (31) y el create idempotente (R9.5.2): una sola
// forma de mirar el libro ⇒ consistencia.
function domainOperationEntry_(operationId) {
  var data = domainReadRows_('_domain_operations');
  var found = null;
  data.rows.some(function (row) {
    if (String(row.record.id) === String(operationId)) {
      found = row;
      return true;
    }
    return false;
  });
  if (found === null) throw apiError_(500, 'No se pudo registrar la operación');
  return { data: data, row: found };
}

function domainAuditOnce_(ss, resource, commandName, key, actor, operationId) {
  if (!resource.policies || !resource.policies.audit) return;
  var summary = 'operation:' + operationId;
  var data = readSheetData_(ss, '_audit_log');
  var actionIndex = data.headers.indexOf('action');
  var entityIndex = data.headers.indexOf('entity');
  var keyIndex = data.headers.indexOf('entity_key');
  var summaryIndex = data.headers.indexOf('summary');
  if (
    [actionIndex, entityIndex, keyIndex, summaryIndex].some(function (index) {
      return index < 0;
    })
  ) {
    throw apiError_(500, 'La hoja _audit_log no tiene las columnas requeridas');
  }
  var exists = data.rows.some(function (row) {
    return (
      String(row.values[actionIndex]) === 'command:' + commandName &&
      String(row.values[entityIndex]) === String(resource.id) &&
      String(row.values[keyIndex]) === String(key) &&
      String(row.values[summaryIndex]) === summary
    );
  });
  if (!exists) {
    appendAuditRow_(ss, 'command:' + commandName, resource.id, key, summary, actor);
  }
}

function executeDomainCommandLocked_(resource, command, request, key, ss, map) {
  var profileId = command.grant;
  var token = request.payload.grant;
  if (typeof profileId === 'string' && typeof token !== 'string') {
    throw apiError_(401, 'Falta la autorización para este comando', null, 'GRANT_REQUIRED');
  }
  if (command.idempotency === 'required') {
    if (
      typeof request.payload.idempotencyKey !== 'string' ||
      request.payload.idempotencyKey.length < 16 ||
      request.payload.idempotencyKey.length > 128
    ) {
      throw validationError_([
        commandIssue_(
          'idempotencyKey',
          'VALIDATION_IDEMPOTENCY_KEY',
          'Debe ser una clave de 16 a 128 caracteres',
        ),
      ]);
    }
  }
  if (
    request.payload.idempotencyKey !== undefined &&
    (typeof request.payload.idempotencyKey !== 'string' ||
      request.payload.idempotencyKey.length < 16 ||
      request.payload.idempotencyKey.length > 128)
  ) {
    throw validationError_([
      commandIssue_(
        'idempotencyKey',
        'VALIDATION_IDEMPOTENCY_KEY',
        'Debe ser una clave de 16 a 128 caracteres',
      ),
    ]);
  }

  var grant =
    typeof profileId === 'string'
      ? domainGrantForTokenLocked_(token, profileId, resource, key, request.command, null, true)
      : null;
  var idemKey =
    typeof request.payload.idempotencyKey === 'string'
      ? request.payload.idempotencyKey
      : Utilities.getUuid();
  var idempotencyHash = domainHmac_(
    'idempotency:v1|' + resource.id + '|' + key + '|' + request.command + '|' + idemKey,
  );
  var requestHash = domainHmac_(
    'request:v1|' +
      domainCanonical_({
        resource: resource.id,
        key: key,
        command: request.command,
        grantId: grant ? grant.id : null,
        input: request.payload.input,
        uploads: request.payload.uploads || null,
      }),
  );
  var existing = domainOperationFind_(idempotencyHash);
  if (existing !== null) {
    var record = existing.row.record;
    if (!constantTimeEqual_(String(record.request_hash), requestHash)) {
      throw apiError_(
        409,
        'La clave idempotente ya se usó con otra solicitud',
        null,
        'IDEMPOTENCY_CONFLICT',
      );
    }
    if (String(record.grant_id || '') !== String(grant ? grant.id : '')) {
      throw apiError_(
        409,
        'La operación no corresponde a esta autorización',
        null,
        'GRANT_SCOPE_MISMATCH',
      );
    }
    if (record.status === 'completed') {
      if (grant !== null) releaseDomainGrantLocked_(grant, String(record.id));
      return domainOperationResult_(record);
    }
    if (grant !== null) {
      grant = domainGrantForTokenLocked_(
        token,
        profileId,
        resource,
        key,
        request.command,
        String(record.id),
        false,
      );
    }
    if (record.status === 'failed') {
      throw apiError_(409, 'La operación falló y no puede reintentarse', null, 'OPERATION_FAILED');
    }
    if (DOMAIN_OPERATION_STATES_.indexOf(String(record.status)) === -1) {
      throw apiError_(500, 'Estado de operación desconocido');
    }
    return resumeDomainOperationLocked_(existing, grant, ss, resource, request);
  }

  if (grant !== null) {
    grant = domainGrantForTokenLocked_(
      token,
      profileId,
      resource,
      key,
      request.command,
      null,
      false,
    );
  }
  var plan = prepareDomainCommandPlan_(resource, command, request, key, ss, map, grant);
  var operationId = Utilities.getUuid();
  var operation = {
    id: operationId,
    idempotency_hash: idempotencyHash,
    request_hash: requestHash,
    grant_id: grant ? grant.id : '',
    resource: resource.id,
    resource_key: key,
    command: request.command,
    status: 'prepared',
    stage: 'prepared',
    plan_json: JSON.stringify(plan),
    result_json: JSON.stringify(plan.result),
    created_at: domainNow_(),
    updated_at: domainNow_(),
  };
  domainAppendRow_('_domain_operations', operation);
  var entry = domainOperationEntry_(operationId);
  if (grant !== null) reserveDomainGrantLocked_(grant, operationId);
  return applyDomainOperationLocked_(entry, grant, ss, resource, request);
}

function resumeDomainOperationLocked_(entry, grant, ss, resource, request) {
  if (entry.row.record.status === 'prepared') {
    domainOperationWrite_(entry, { status: 'applying', stage: 'applying' });
  }
  return applyDomainOperationLocked_(entry, grant, ss, resource, request);
}

function applyDomainOperationLocked_(entry, grant, ss, resource, request) {
  var record = entry.row.record;
  var plan;
  try {
    plan = JSON.parse(String(record.plan_json || ''));
  } catch (error) {
    throw apiError_(500, 'El plan guardado de la operación está dañado');
  }
  var operationId = String(record.id);
  try {
    domainOperationWrite_(entry, { status: 'applying', stage: 'applying' });
    reserveDomainUploadsLocked_(plan.uploads, grant ? grant.id : '', operationId);
    persistCommandChanges_(
      ss,
      resource,
      storageMap_(resource),
      String(record.resource_key),
      plan.changes,
    );
    domainOperationWrite_(entry, { status: 'applying', stage: 'record_written' });
    appendCommandEvents_(
      ss,
      resource,
      storageMap_(resource),
      plan.command,
      plan.input,
      { user: { id: plan.actor } },
      String(record.resource_key),
      operationId,
      plan.eventNow,
    );
    domainOperationWrite_(entry, { status: 'applying', stage: 'events_written' });
    domainAuditOnce_(
      ss,
      resource,
      String(record.command),
      String(record.resource_key),
      plan.actor,
      operationId,
    );
    cacheInvalidate_(resource.id);
    acceptDomainUploadsLocked_(plan.uploads, operationId);
    if (grant !== null) consumeDomainGrantLocked_(grant.id, operationId);
    domainOperationWrite_(entry, {
      status: 'completed',
      stage: 'completed',
      result_json: JSON.stringify(plan.result),
    });
    if (grant !== null) releaseDomainGrantLocked_(grant, operationId);
    return plan.result;
  } catch (error) {
    try {
      domainOperationWrite_(entry, {
        status: 'recoverable',
        stage: String(entry.row.record.stage),
      });
    } catch (journalError) {
      console.error('[domain-operation] No se pudo marcar recoverable: ' + journalError.message);
    }
    throw error;
  }
}
