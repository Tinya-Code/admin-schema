// capabilities/adapters — Proveedores de carga declarados por capabilities.

function cloudinaryUploadFormats_(mimeTypes) {
  var formats = [];
  var formatByMime = {
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/webp': ['webp'],
  };
  mimeTypes.forEach(function (mime) {
    var mapped = formatByMime[String(mime).toLowerCase()];
    if (!mapped) throw apiError_(500, 'MIME no soportado por el adaptador Cloudinary: ' + mime);
    mapped.forEach(function (format) {
      if (formats.indexOf(format) === -1) formats.push(format);
    });
  });
  return formats;
}

function cloudinarySignDomainUpload_(profile, upload) {
  var cloudName = Props.require('CLOUDINARY_CLOUD_NAME');
  var apiKey = Props.require('CLOUDINARY_API_KEY');
  var apiSecret = Props.require('CLOUDINARY_API_SECRET');
  var baseFolder = String(Props.require('CLOUDINARY_BASE_FOLDER')).replace(/^\/+|\/+$/g, '');
  var folder = baseFolder + '/' + profile.namespace;
  var publicId = folder + '/' + upload.id;
  var timestamp = Math.floor(Date.now() / 1000);
  var formats = cloudinaryUploadFormats_(profile.mimeTypes);
  var signature = cloudinarySign_(apiSecret, {
    allowed_formats: formats.join(','),
    folder: folder,
    public_id: publicId,
    timestamp: timestamp,
  });
  return {
    cloud_name: cloudName,
    api_key: apiKey,
    timestamp: timestamp,
    signature: signature,
    folder: folder,
    public_id: publicId,
    allowed_formats: formats,
    upload_url: 'https://api.cloudinary.com/v1_1/' + cloudName + '/image/upload',
  };
}

function cloudinaryVerifyDomainUpload_(profile, response, expectedPublicId) {
  if (String(response.public_id) !== String(expectedPublicId)) {
    throw apiError_(
      403,
      'La carga no corresponde a la firma emitida',
      null,
      'UPLOAD_SCOPE_MISMATCH',
    );
  }
  var version = Number(response.version);
  if (!isFinite(version) || Math.floor(version) !== version || version <= 0) {
    throw apiError_(
      422,
      'La respuesta del proveedor no contiene una versión válida',
      null,
      'UPLOAD_INVALID',
    );
  }
  var bytes = Number(response.bytes);
  if (!isFinite(bytes) || Math.floor(bytes) !== bytes || bytes <= 0) {
    throw apiError_(
      422,
      'La respuesta del proveedor no contiene un tamaño válido',
      null,
      'UPLOAD_INVALID',
    );
  }
  if (bytes > profile.maxBytes) {
    throw apiError_(422, 'La carga excede el tamaño máximo permitido', null, 'UPLOAD_TOO_LARGE');
  }
  var format = String(response.format || '').toLowerCase();
  if (cloudinaryUploadFormats_(profile.mimeTypes).indexOf(format) === -1) {
    throw apiError_(
      422,
      'El formato de la carga no está permitido',
      null,
      'UPLOAD_FORMAT_NOT_ALLOWED',
    );
  }
  var expectedSignature = cloudinarySign_(Props.require('CLOUDINARY_API_SECRET'), {
    public_id: expectedPublicId,
    version: version,
  });
  if (
    typeof response.signature !== 'string' ||
    !constantTimeEqual_(response.signature.toLowerCase(), expectedSignature)
  ) {
    throw apiError_(
      401,
      'La firma de la respuesta del proveedor no es válida',
      null,
      'UPLOAD_INVALID',
    );
  }
  var secureUrl =
    'https://res.cloudinary.com/' +
    Props.require('CLOUDINARY_CLOUD_NAME') +
    '/image/upload/v' +
    version +
    '/' +
    expectedPublicId +
    '.' +
    format;
  if (String(response.secure_url) !== secureUrl) {
    throw apiError_(422, 'La URL segura no coincide con el asset firmado', null, 'UPLOAD_INVALID');
  }
  return {
    public_id: expectedPublicId,
    secure_url: secureUrl,
    format: format,
    bytes: bytes,
    version: version,
  };
}

registerCapability('adapters', {
  id: 'cloudinary',
  since: '1.0',
  argsSchema: null,
  run: null,
  supportedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  signUpload: cloudinarySignDomainUpload_,
  verifyUpload: cloudinaryVerifyDomainUpload_,
});
