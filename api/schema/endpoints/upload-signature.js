// schema/endpoints/upload-signature — Endpoint no-CRUD declarado (§9).
//
// Declarado, no cableado: el router deriva su ruta de
// `REGISTRY.endpoints` (Fase 2). El handler (firma Cloudinary en dos
// pasos) vive en `primitives/handlers/upload-signature`.
// `method`/`access`/`limits` son DATOS declarativos: el router resuelve la
// política de la ruta y aplica el rate-limit genérico (F6, §8) desde
// `limits`; el handler ya no tiene limitador propio.

REGISTRY.endpoints.uploadSignature = {
  route: '/admin/upload-signature',
  method: 'POST',
  access: 'admin',
  limits: '10/min',
  handler: 'handleUploadSignature',
};
