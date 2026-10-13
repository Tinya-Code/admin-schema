// schema/endpoints/upload-signature — Endpoint no-CRUD declarado (§9).
//
// Declarado, no cableado: el router deriva su ruta de
// `REGISTRY.endpoints` (Fase 2). El handler (firma Cloudinary en dos
// pasos) vive en `capabilities/handlers/upload-signature`.
// `method`/`access`/`limits` son DATOS declarativos: el router resuelve la
// política de la ruta y aplica el rate-limit genérico (F6, §8) desde
// `limits`; el handler ya no tiene limitador propio.

REGISTRY.endpoints.uploadSignature = {
  route: '/admin/upload-signature',
  method: 'POST',
  access: 'admin',
  limits: '10/min',
  handler: 'handleUploadSignature',
  since: '1.0',
};

REGISTRY.endpoints.domainUploadSignature = {
  route: '/p/uploads/signature/:profile',
  method: 'POST',
  access: 'public',
  limits: '10/min',
  handler: 'handleDomainUploadSignature',
  input: {
    params: { profile: { type: 'text', required: true } },
    grant: { type: 'secret', required: true, maxLength: 256 },
  },
  output: {
    cloud_name: { type: 'text', required: true },
    api_key: { type: 'text', required: true },
    timestamp: { type: 'number', required: true },
    signature: { type: 'text', required: true },
    folder: { type: 'text', required: true },
    public_id: { type: 'text', required: true },
    allowed_formats: { type: 'text', required: true },
    upload_url: { type: 'url', required: true },
    expires_at: { type: 'text', required: true },
  },
  errors: [
    { status: 401, description: 'Falta un grant válido o la firma del proveedor no coincide.' },
    { status: 403, description: 'El grant no corresponde al perfil de carga.' },
    { status: 404, description: 'El perfil de carga no está declarado.' },
    { status: 409, description: 'El grant está reservado o la carga ya fue utilizada.' },
    { status: 410, description: 'El grant o la carga temporal expiró.' },
    { status: 422, description: 'La respuesta del proveedor no cumple el perfil.' },
    { status: 429, description: 'Se agotó el límite de solicitudes de firma.' },
    { status: 503, description: 'El proveedor de carga no está disponible.' },
  ],
  since: '1.0',
};

REGISTRY.uploadProfiles.pickupPhoto = {
  provider: 'cloudinary',
  resource: 'orders',
  grant: 'pickupGrant',
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxBytes: 10 * 1024 * 1024,
  ttlSeconds: 900,
  namespace: 'pickup',
};
