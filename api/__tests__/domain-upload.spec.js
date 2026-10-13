import { createHash } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

let REGISTRY;
const originalProps = globalThis.Props;
const originalUtilities = globalThis.Utilities;

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
});

afterEach(() => {
  globalThis.Props = originalProps;
  globalThis.Utilities = originalUtilities;
});

function useCloudinaryCredentials() {
  const values = {
    CLOUDINARY_CLOUD_NAME: 'test-cloud',
    CLOUDINARY_API_KEY: 'public-api-key',
    CLOUDINARY_API_SECRET: 'private-api-secret',
    CLOUDINARY_BASE_FOLDER: 'public-api',
  };
  globalThis.Props = { require: (name) => values[name] };
  globalThis.Utilities = {
    DigestAlgorithm: { SHA_1: 'sha1' },
    Charset: { UTF_8: 'utf8' },
    computeDigest: (_algorithm, value) =>
      Array.from(createHash('sha1').update(String(value)).digest()),
  };
}

const profile = {
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxBytes: 10 * 1024 * 1024,
  ttlSeconds: 900,
  namespace: 'pickup',
};

describe('adaptador de carga Cloudinary', () => {
  it('resuelve el endpoint genérico por el perfil declarado en la ruta', () => {
    globalThis.ROUTE_TABLE_ = null;
    const route = globalThis.resolveRoute_('/p/uploads/signature/pickupPhoto');
    expect(route.kind).toBe('handler');
    expect(route.handler).toBe('handleDomainUploadSignature');
    expect(route.params.profile).toBe('pickupPhoto');
  });

  it('firma sólo carpeta, identificador, formatos y timestamp generados por backend', () => {
    useCloudinaryCredentials();
    const adapter = REGISTRY.capabilities.adapters.cloudinary;
    const signed = adapter.signUpload(profile, { id: 'random-asset-id' });

    expect(signed.public_id).toBe('public-api/pickup/random-asset-id');
    expect(signed.folder).toBe('public-api/pickup');
    expect(signed.allowed_formats).toEqual(['jpg', 'jpeg', 'png', 'webp']);
    expect(signed.signature).toBe(
      globalThis.cloudinarySign_('private-api-secret', {
        allowed_formats: 'jpg,jpeg,png,webp',
        folder: signed.folder,
        public_id: signed.public_id,
        timestamp: signed.timestamp,
      }),
    );
    expect(JSON.stringify(signed)).not.toContain('private-api-secret');
  });

  it('verifica firma del proveedor, public_id, URL, formato y tamaño', () => {
    useCloudinaryCredentials();
    const adapter = REGISTRY.capabilities.adapters.cloudinary;
    const publicId = 'public-api/pickup/random-asset-id';
    const response = {
      public_id: publicId,
      version: 123,
      format: 'png',
      bytes: 4096,
      signature: globalThis.cloudinarySign_('private-api-secret', {
        public_id: publicId,
        version: 123,
      }),
      secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v123/' + publicId + '.png',
    };

    expect(adapter.verifyUpload(profile, response, publicId)).toEqual({
      public_id: publicId,
      secure_url: response.secure_url,
      format: 'png',
      bytes: 4096,
      version: 123,
    });
    expect(() =>
      adapter.verifyUpload(
        profile,
        Object.assign({}, response, { bytes: profile.maxBytes + 1 }),
        publicId,
      ),
    ).toThrow(/tamaño máximo/);
    expect(() =>
      adapter.verifyUpload(profile, Object.assign({}, response, { public_id: 'other' }), publicId),
    ).toThrow(/no corresponde/);
    expect(() =>
      adapter.verifyUpload(profile, Object.assign({}, response, { signature: 'forged' }), publicId),
    ).toThrow(/firma de la respuesta/);
    expect(() =>
      adapter.verifyUpload(
        profile,
        Object.assign({}, response, { secure_url: 'https://attacker.example/image.png' }),
        publicId,
      ),
    ).toThrow(/URL segura/);
  });
});
