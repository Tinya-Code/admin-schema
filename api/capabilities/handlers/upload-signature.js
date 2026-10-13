// capabilities/handlers/upload-signature — Firma de subida a Cloudinary
// (baseapi §11). Resuelto desde `REGISTRY.endpoints.uploadSignature`
// (schema/endpoints/upload-signature), no por código en el router.
//
// Flujo en dos pasos (§11.2): el backend sólo EMITE la firma y el navegador
// sube directo a Cloudinary (opción B de §11.1). Así el API secret nunca
// sale de acá (§11.3, criterio 5) y el backend no habla con la nube.
//   Entrada: payload { resource }  (envelope autenticado por core/11-auth)
//   Salida:  { cloud_name, api_key, timestamp, signature, folder,
//              allowed_formats, upload_url }
// El CLIENTE NO elige carpeta ni formatos: los fija el backend (§11.3) y
// van DENTRO de la firma, así que Cloudinary los rechaza si se alteran.
// Handler: devuelve datos; el envelope lo envuelve core/12-http.

function handleUploadSignature(payload, request) {
  // ── 1) Recurso: resource.imageFolder define la carpeta (§11.2) ──
  var resourceId = payload && payload.resource;
  if (typeof resourceId !== 'string' || resourceId.trim() === '') {
    throw apiError_(400, 'Falta resource (p. ej. products)');
  }
  resourceId = resourceId.trim();
  var resource = getResourceSchema(resourceId);
  if (resource === null) {
    throw apiError_(400, 'Recurso desconocido: ' + truncate_(resourceId));
  }
  if (!resource.imageFolder) {
    throw apiError_(400, 'El recurso "' + resource.id + '" no admite archivos');
  }

  // ── 1b) Campo opcional (R9.5.3): si declara `formats`, ESA lista es la
  //  que se firma — el cliente no elige nada (§11.3). Un campo que no
  //  existe o que no es de archivo es error visible, no un fallback mudo.
  var allowedFormats = CONFIG.UPLOAD_ALLOWED_FORMATS;
  var fieldId = payload && payload.field;
  if (fieldId !== undefined && fieldId !== null && fieldId !== '') {
    if (typeof fieldId !== 'string') {
      throw apiError_(400, 'field debe ser el id de un campo del recurso');
    }
    var field = fileFieldOf_(resource, fieldId.trim());
    if (field === null) {
      throw apiError_(400, 'El recurso "' + resource.id + '" no tiene el campo "' + fieldId + '"');
    }
    if (field.type !== 'file' && field.type !== 'image') {
      throw apiError_(400, 'El campo "' + fieldId + '" no admite archivos');
    }
    if (typeof field.formats === 'string' && field.formats.trim() !== '') {
      allowedFormats = field.formats
        .split(',')
        .map(function (part) {
          return part.trim().toLowerCase();
        })
        .join(',');
    }
  }

  // ── 2) Parámetros firmados: los fija SIEMPRE el backend ──
  //  (el rate-limit ya no vive acá: lo aplica el router desde la política
  //  declarada `limits` del endpoint — F6, §8)
  var cloudName = Props.require('CLOUDINARY_CLOUD_NAME');
  var apiKey = Props.require('CLOUDINARY_API_KEY');
  var apiSecret = Props.require('CLOUDINARY_API_SECRET'); // jamás sale de acá
  var baseFolder = String(Props.require('CLOUDINARY_BASE_FOLDER')).replace(/^\/+|\/+$/g, '');
  var folder = baseFolder + '/' + resource.imageFolder;
  var timestamp = Math.floor(Date.now() / 1000);

  // ── 3) Firma ──
  var signature = cloudinarySign_(apiSecret, {
    allowed_formats: allowedFormats,
    folder: folder,
    timestamp: timestamp,
  });

  return {
    cloud_name: cloudName,
    api_key: apiKey,
    timestamp: timestamp,
    signature: signature,
    folder: folder,
    allowed_formats: allowedFormats,
    upload_url: 'https://api.cloudinary.com/v1_1/' + cloudName + '/image/upload',
  };
}

// Campo de archivo (`file`/`image`) de un recurso, plano o anidado en un
// group/list. Devuelve `null` si no existe (el caller decide el error).
function fileFieldOf_(resource, fieldId) {
  var found = null;
  var walk = function (fields) {
    (fields || []).forEach(function (field) {
      if (found !== null || !field || typeof field !== 'object') return;
      if (field.key === fieldId) {
        found = field;
        return;
      }
      walk(field.fields);
      walk(field.itemFields);
    });
  };
  walk(resource.fields);
  return found;
}

function handleDomainUploadSignature(payload, request) {
  var profileId = request && request.params ? request.params.profile : null;
  var token = payload && payload.grant;
  if (typeof profileId !== 'string' || profileId === '') {
    throw apiError_(400, 'Falta el perfil de carga en la ruta');
  }
  if (typeof token !== 'string' || token === '') {
    throw apiError_(401, 'Falta la autorización para la carga', null, 'GRANT_REQUIRED');
  }
  var profile = REGISTRY.uploadProfiles[profileId];
  if (!profile)
    throw apiError_(404, 'Perfil de carga no encontrado', null, 'UPLOAD_PROFILE_NOT_FOUND');

  return withLock_('domain-upload:' + profileId, function () {
    var grant = domainGrantRecordForTokenLocked_(token);
    var grantProfile = REGISTRY.grantProfiles[profile.grant];
    var resource = getResourceSchema(profile.resource);
    if (
      !grantProfile ||
      !resource ||
      grant.record.resource !== resource.id ||
      grantProfile.resource !== resource.id ||
      grant.record.command !== grantProfile.command
    ) {
      throw apiError_(
        403,
        'La autorización no corresponde a este perfil',
        null,
        'GRANT_SCOPE_MISMATCH',
      );
    }
    domainGrantForTokenLocked_(
      token,
      profile.grant,
      resource,
      String(grant.record.resource_key),
      grantProfile.command,
      null,
      false,
    );
    var adapter = REGISTRY.capabilities.adapters[profile.provider];
    if (!adapter || typeof adapter.signUpload !== 'function') {
      throw apiError_(
        503,
        'El proveedor de carga no está disponible',
        null,
        'UPLOAD_PROVIDER_UNAVAILABLE',
      );
    }
    var id = Utilities.getUuid();
    var expiresAt = Math.min(
      Date.now() + profile.ttlSeconds * 1000,
      domainDateMs_(grant.record.expires_at),
    );
    if (!isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw apiError_(410, 'La autorización expiró', null, 'GRANT_EXPIRED');
    }
    var signed = adapter.signUpload(profile, { id: id, grant: grant.record });
    signed.allowed_formats = signed.allowed_formats.join(',');
    domainAppendRow_('_domain_uploads', {
      id: id,
      grant_id: grant.id,
      profile: profileId,
      resource: resource.id,
      resource_key: String(grant.record.resource_key),
      provider: profile.provider,
      public_id: signed.public_id,
      secure_url: '',
      format: '',
      bytes: '',
      status: 'issued',
      expires_at: new Date(expiresAt).toISOString(),
      created_at: domainNow_(),
      updated_at: domainNow_(),
      operation_id: '',
    });
    signed.expires_at = new Date(expiresAt).toISOString();
    return signed;
  });
}

// Firma Cloudinary: parámetros ordenados ALFABÉTICAMENTE, `k=v` unidos con
// '&', el API secret al FINAL y SHA-1 en hex (el algoritmo de Cloudinary).
// El secreto no se registra ni se refleja en ninguna respuesta.
function cloudinarySign_(apiSecret, params) {
  var toSign =
    Object.keys(params)
      .sort()
      .map(function (name) {
        return name + '=' + params[name];
      })
      .join('&') + apiSecret;
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_1,
    toSign,
    Utilities.Charset.UTF_8,
  );
  return bytes
    .map(function (b) {
      return (b + 256).toString(16).slice(-2);
    })
    .join('');
}

// Se registra por la puerta única (R3.14): era de los últimos handlers que
// el router resolvía sólo por su fallback a globalThis.
registerCapability('handlers', {
  id: 'handleUploadSignature',
  since: '1.0',
  argsSchema: null,
  run: handleUploadSignature,
});

registerCapability('handlers', {
  id: 'handleDomainUploadSignature',
  since: '1.0',
  argsSchema: null,
  run: handleDomainUploadSignature,
});
