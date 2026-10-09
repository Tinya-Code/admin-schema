// primitives/handlers/upload-signature — Firma de subida a Cloudinary
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
    throw apiError_(400, 'El recurso "' + resource.id + '" no admite imágenes');
  }

  // ── 2) Parámetros firmados: los fija SIEMPRE el backend ──
  //  (el rate-limit ya no vive acá: lo aplica el router desde la política
  //  declarada `limits` del endpoint — F6, §8)
  var cloudName = Props.require('CLOUDINARY_CLOUD_NAME');
  var apiKey = Props.require('CLOUDINARY_API_KEY');
  var apiSecret = Props.require('CLOUDINARY_API_SECRET'); // jamás sale de acá
  var baseFolder = String(Props.require('CLOUDINARY_BASE_FOLDER')).replace(/^\/+|\/+$/g, '');
  var folder = baseFolder + '/' + resource.imageFolder;
  var allowedFormats = CONFIG.UPLOAD_ALLOWED_FORMATS;
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
