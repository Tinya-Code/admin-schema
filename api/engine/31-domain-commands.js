// engine/31-domain-commands — Intérprete genérico del DSL de commands.
//
// Resuelve sólo contratos ya validados al cargar el registro. Una llamada
// POST acepta { input, grant?, idempotencyKey? }; Fase 3 agrega el journal y
// la reserva del grant alrededor de este mismo pipeline.

function commandIssue_(path, code, message) {
  return { path: path, code: code, message: message };
}

function commandInputErrors_(command, payload) {
  var errors = [];
  var body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  Object.keys(body).forEach(function (key) {
    if (['input', 'grant', 'idempotencyKey', 'uploads'].indexOf(key) === -1) {
      errors.push(commandIssue_(key, 'VALIDATION_UNKNOWN_FIELD', 'Campo no permitido'));
    }
  });
  var input = body.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    errors.push(commandIssue_('input', 'VALIDATION_OBJECT', 'Debe ser un objeto'));
    return errors;
  }
  Object.keys(input).forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(command.input, key)) {
      errors.push(commandIssue_('input.' + key, 'VALIDATION_UNKNOWN_FIELD', 'Campo no permitido'));
    }
  });
  Object.keys(command.input || {}).forEach(function (key) {
    var field = command.input[key];
    var value = input[key];
    var path = 'input.' + key;
    if (field.required === true && isEmptyValue_(value)) {
      errors.push(commandIssue_(path, 'VALIDATION_REQUIRED', 'Campo obligatorio'));
      return;
    }
    if (isEmptyValue_(value)) return;
    if (field.type === 'secret') {
      if (typeof value !== 'string') {
        errors.push(commandIssue_(path, 'VALIDATION_SECRET', 'Debe ser texto'));
      } else if (field.maxLength !== undefined && value.length > field.maxLength) {
        errors.push(commandIssue_(path, 'VALIDATION_MAX_LENGTH', 'Excede el máximo permitido'));
      }
      return;
    }
    if (field.type === 'upload') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(commandIssue_(path, 'VALIDATION_UPLOAD', 'Debe ser la respuesta de una carga'));
        return;
      }
      var uploadKeys = ['public_id', 'secure_url', 'format', 'bytes', 'version', 'signature'];
      Object.keys(value).forEach(function (uploadKey) {
        if (uploadKeys.indexOf(uploadKey) === -1) {
          errors.push(
            commandIssue_(path + '.' + uploadKey, 'VALIDATION_UNKNOWN_FIELD', 'Campo no permitido'),
          );
        }
      });
      ['public_id', 'secure_url', 'format', 'signature'].forEach(function (uploadKey) {
        if (typeof value[uploadKey] !== 'string' || value[uploadKey] === '') {
          errors.push(
            commandIssue_(path + '.' + uploadKey, 'VALIDATION_REQUIRED', 'Campo obligatorio'),
          );
        }
      });
      ['bytes', 'version'].forEach(function (uploadKey) {
        if (!Number.isInteger(value[uploadKey]) || value[uploadKey] <= 0) {
          errors.push(
            commandIssue_(
              path + '.' + uploadKey,
              'VALIDATION_NUMBER',
              'Debe ser un entero positivo',
            ),
          );
        }
      });
      return;
    }
    var fieldErrors = [];
    validateScalar_(null, field, value, path, fieldErrors);
    if (
      field.maxLength !== undefined &&
      typeof value === 'string' &&
      value.length > field.maxLength
    ) {
      fieldErrors.push(commandIssue_(path, 'VALIDATION_MAX_LENGTH', 'Excede el máximo permitido'));
    }
    if (
      field.minLength !== undefined &&
      typeof value === 'string' &&
      value.length < field.minLength
    ) {
      fieldErrors.push(
        commandIssue_(path, 'VALIDATION_MIN_LENGTH', 'No alcanza el mínimo requerido'),
      );
    }
    if (
      field.pattern !== undefined &&
      typeof value === 'string' &&
      !new RegExp(field.pattern).test(value)
    ) {
      fieldErrors.push(commandIssue_(path, 'VALIDATION_PATTERN', 'Formato inválido'));
    }
    errors = errors.concat(fieldErrors);
  });
  return errors;
}

function commandConditionMatches_(condition, record) {
  var operator = REGISTRY.ops[condition.op];
  if (typeof operator !== 'function') {
    throw apiError_(500, 'Operador no registrado: ' + condition.op);
  }
  return operator(record[condition.field], condition.value) === true;
}

function commandValue_(reference, input, request, key) {
  if (Object.prototype.hasOwnProperty.call(reference, 'from')) {
    var name = reference.from.slice('input.'.length);
    return input[name];
  }
  if (Object.prototype.hasOwnProperty.call(reference, 'value')) return reference.value;
  if (reference.generated === 'now') return nowStamp_();
  if (reference.generated === 'key') return key;
  if (reference.generated === 'actor') {
    return request.user && request.user.id ? String(request.user.id) : 'public';
  }
  throw apiError_(500, 'Referencia de command no soportada');
}

function commandCandidate_(resource, command, request, current, key) {
  var input = request.payload.input;
  var next = {};
  Object.keys(current || {}).forEach(function (field) {
    next[field] = current[field];
  });
  var changes = {};
  Object.keys(command.changes || {}).forEach(function (field) {
    var reference = command.changes[field];
    if (
      typeof reference.from === 'string' &&
      /^input\./.test(reference.from) &&
      !Object.prototype.hasOwnProperty.call(input, reference.from.slice('input.'.length))
    ) {
      return;
    }
    var value = commandValue_(reference, input, request, key);
    changes[field] = value;
    next[field] = value;
  });
  // Los campos de sistema calculados con `now` se mantienen bajo el control
  // del motor, incluso si un schema omite declararlos explícitamente.
  (resource.fields || []).forEach(function (field) {
    if (field.computed === 'now' && field.system === true) {
      changes[field.key] = nowStamp_();
      next[field.key] = changes[field.key];
    }
  });
  return { record: next, changes: changes };
}

function commandOutput_(resource, command, candidate, key) {
  var output = {};
  Object.keys(command.output || {}).forEach(function (field) {
    if (field === 'ok' && command.output[field].type === 'boolean') {
      output[field] = true;
    } else if (field === 'key' || field === resource.keyField) {
      output[field] = key;
    } else if (Object.prototype.hasOwnProperty.call(candidate, field)) {
      output[field] = candidate[field];
    }
  });
  return output;
}

function commandPreconditionError_(command, condition) {
  var declared = (command.errors || []).filter(function (error) {
    return error.code === 'COMMAND_PRECONDITION_FAILED';
  })[0];
  return apiError_(
    declared ? declared.status : 409,
    declared ? declared.message : 'El estado actual no permite completar el comando',
    null,
    'COMMAND_PRECONDITION_FAILED',
  );
}

function commandAudit_(ss, resource, commandName, key, request) {
  if (resource.policies && resource.policies.audit) {
    appendAuditRow_(
      ss,
      'command:' + commandName,
      resource.id,
      key,
      'Ejecución de comando ' + commandName,
      request.user && request.user.id ? String(request.user.id) : 'public',
    );
  }
}

function appendCommandEvents_(
  ss,
  resource,
  map,
  command,
  input,
  request,
  key,
  operationId,
  eventNow,
) {
  (command.events || []).forEach(function (event, eventIndex) {
    var child = childSpec_(map, event.appendTo);
    if (!child || child.type !== 'list') {
      throw apiError_(500, 'La lista de eventos no está disponible: ' + event.appendTo);
    }
    var item = {};
    Object.keys(event.values || {}).forEach(function (field) {
      item[field] = commandValue_(event.values[field], input, request, key);
    });
    var eventId = operationId + ':' + eventIndex;
    if (event.operationIdField) {
      item[event.operationIdField] = eventId;
      var prior = readSheetData_(ss, child.sheet);
      var alreadyWritten = childRowsToItems_(child, prior.headers, prior.rows, key).some(
        function (saved) {
          return String(saved[event.operationIdField]) === eventId;
        },
      );
      if (alreadyWritten) return;
    }
    child.itemFields.forEach(function (field) {
      if (field.computed === 'now') item[field.key] = eventNow || nowStamp_();
    });
    var data = readSheetData_(ss, child.sheet);
    var existing = childRowsToItems_(child, data.headers, data.rows, key);
    existing.push(item);
    var rows = itemsToRows_(child, data.headers, existing, key);
    var finalRows = spliceChildRows_(data, child, key, rows);
    writeRowsBlock_(data.sheet, data.headers, finalRows);
  });
}

function persistCommandChanges_(ss, resource, map, key, changes) {
  var data = readSheetData_(ss, map.sheet);
  var entries = flatEntries_(map, data);
  var index = entryIndexOf_(entries, map.keyField, key);
  if (index === -1) throw apiError_(404, 'No existe el registro solicitado');
  var row = entries[index].values.slice();
  var flat = contractToFlat_(map, changes);
  Object.keys(flat).forEach(function (name) {
    setHeaderCell_(row, data.headers, name, flat[name]);
  });
  map.columns.forEach(function (column) {
    if (column.computed === 'now') {
      setHeaderCell_(
        row,
        data.headers,
        column.flatKey,
        Object.prototype.hasOwnProperty.call(changes, column.key)
          ? changes[column.key]
          : nowStamp_(),
      );
    }
  });
  data.sheet.getRange(entries[index].at, 1, 1, data.headers.length).setValues([row]);
}

function dispatchDomainCommand_(resource, command, request) {
  if (request.method !== 'POST') {
    throw apiError_(405, 'Los comandos sólo admiten POST', null, 'METHOD_NOT_ALLOWED');
  }
  if (
    !command ||
    !resource.commands ||
    !Object.prototype.hasOwnProperty.call(resource.commands, request.command)
  ) {
    throw apiError_(404, 'Comando no encontrado', null, 'COMMAND_NOT_FOUND');
  }
  var key = request.params && request.params[resource.keyField];
  if (key === undefined || key === null || String(key) === '') {
    throw apiError_(400, 'Falta la clave del registro en la ruta', null, 'INVALID_RESOURCE_KEY');
  }
  key = String(key);
  var inputErrors = commandInputErrors_(command, request.payload);
  if (inputErrors.length > 0) throw validationError_(inputErrors);
  var ss = openSpreadsheet_();
  var map = storageMap_(resource);
  return withLock_('command:' + resource.id + ':' + key, function () {
    if (typeof command.handler === 'string') {
      var current = readDetail_(ss, resource, map, key);
      (command.preconditions || []).forEach(function (condition) {
        if (!commandConditionMatches_(condition, current)) {
          throw commandPreconditionError_(command, condition);
        }
      });
      var handler = REGISTRY.handlers[command.handler];
      if (typeof handler !== 'function') {
        throw apiError_(500, 'Handler no registrado: ' + command.handler);
      }
      var handled = handler(request.payload.input, request);
      var handlerErrors = validateEndpointOutput_(command.output, handled);
      if (handlerErrors.length > 0) {
        throw apiError_(500, 'Salida de command fuera de contrato', handlerErrors);
      }
      return handled;
    }
    if (typeof command.grant === 'string' || command.idempotency !== 'none') {
      return executeDomainCommandLocked_(resource, command, request, key, ss, map);
    }
    var plan = prepareDomainCommandPlan_(resource, command, request, key, ss, map);
    applyPreparedCommandPlan_(ss, resource, map, request, key, plan, Utilities.getUuid());
    return plan.result;
  });
}

function prepareDomainCommandPlan_(resource, command, request, key, ss, map, grant) {
  var current = readDetail_(ss, resource, map, key);
  (command.preconditions || []).forEach(function (condition) {
    if (!commandConditionMatches_(condition, current)) {
      throw commandPreconditionError_(command, condition);
    }
  });
  var uploadPlan = verifyDomainCommandUploadsLocked_(resource, command, request, key, grant);
  var safeRequest = Object.assign({}, request, {
    payload: Object.assign({}, request.payload, { input: uploadPlan.input }),
  });
  var plannedCommand = Object.assign({}, command, {
    events: (command.events || []).filter(function (event) {
      return !event.when || commandConditionMatches_(event.when, current);
    }),
  });
  var candidate = commandCandidate_(resource, command, safeRequest, current, key);
  var result = commandOutput_(resource, command, candidate.record, key);
  if (Props.isDev()) {
    var outputErrors = validateEndpointOutput_(command.output, result);
    if (outputErrors.length > 0) {
      throw apiError_(500, 'Salida de command fuera de contrato', outputErrors);
    }
  }
  var children = readChildren_(ss, map, key);
  validateAndThrow_(ss, resource, map, {
    isNew: false,
    key: key,
    scalars: mergeContract_(map, current, candidate.changes),
    incoming: candidate.changes,
    current: current,
    children: {},
    currentChildren: children,
    principalRows: flatEntries_(map, readSheetData_(ss, map.sheet)),
  });
  var safeInput = {};
  Object.keys(command.input || {}).forEach(function (name) {
    if (
      command.input[name].type !== 'secret' &&
      Object.prototype.hasOwnProperty.call(uploadPlan.input, name)
    ) {
      safeInput[name] = uploadPlan.input[name];
    }
  });
  return {
    changes: candidate.changes,
    command: plannedCommand,
    input: safeInput,
    actor: request.user && request.user.id ? String(request.user.id) : 'public',
    eventNow: nowStamp_(),
    uploads: uploadPlan.uploads,
    result: result,
  };
}

function applyPreparedCommandPlan_(ss, resource, map, request, key, plan, operationId) {
  persistCommandChanges_(ss, resource, map, key, plan.changes);
  appendCommandEvents_(
    ss,
    resource,
    map,
    plan.command,
    plan.input,
    { user: request.user || null },
    key,
    operationId,
    plan.eventNow,
  );
  commandAudit_(ss, resource, request.command, key, request);
  cacheInvalidate_(resource.id);
}
