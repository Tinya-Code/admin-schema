// __tests__/upload-signature.spec.js — R9.5.3 · tipo `file`
//
// El handler de firma (§11.2) acepta ahora un `field` OPCIONAL: si ese campo
// declara `formats`, ESA lista es la que se firma (el cliente no elige nada,
// §11.3). Un campo inexistente o que no es de archivo es error visible.

import { createHash } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadBackend } from './_harness.js';

let REGISTRY;
const RESOURCE_ID = '__file_fixture';
const originalResource = globalThis.REGISTRY?.resources?.[RESOURCE_ID];
const originalProps = globalThis.Props;
const originalUtilities = globalThis.Utilities;

beforeAll(() => {
  loadBackend();
  REGISTRY = globalThis.REGISTRY;
});

afterEach(() => {
  globalThis.Props = originalProps;
  globalThis.Utilities = originalUtilities;
  if (originalResource === undefined) delete REGISTRY.resources[RESOURCE_ID];
  else REGISTRY.resources[RESOURCE_ID] = originalResource;
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

function registerFixture(options = {}) {
  // `'imageFolder' in options` respeta un `undefined` explícito (el default
  // del parámetro se comería ese caso).
  const imageFolder = 'imageFolder' in options ? options.imageFolder : 'adjuntos';
  REGISTRY.resources[RESOURCE_ID] = {
    id: RESOURCE_ID,
    kind: 'collection',
    route: '/p/file-fixture',
    sheet: '__file_fixture',
    keyField: 'id',
    imageFolder,
    fields: [
      { key: 'id', type: 'text', required: true, unique: true },
      { key: 'foto', type: 'image' },
      { key: 'adjunto', type: 'file', formats: 'PDF,docx' },
      { key: 'titulo', type: 'text' },
      {
        key: 'grupo',
        type: 'group',
        fields: [{ key: 'interno', type: 'file', formats: ' csv ' }],
      },
    ],
  };
}

function sign(payload) {
  return globalThis.handleUploadSignature(payload, {});
}

describe('upload-signature · campo opcional (R9.5.3)', () => {
  it('sin `field` firma la lista global, como antes', () => {
    useCloudinaryCredentials();
    registerFixture();
    const out = sign({ resource: RESOURCE_ID });
    expect(out.allowed_formats).toBe('jpg,jpeg,png,webp');
    expect(out.folder).toBe('public-api/adjuntos');
    expect(out.signature).toBe(
      globalThis.cloudinarySign_('private-api-secret', {
        allowed_formats: out.allowed_formats,
        folder: out.folder,
        timestamp: out.timestamp,
      }),
    );
  });

  it('un campo `file` con `formats` manda sobre la lista global y va a la firma', () => {
    useCloudinaryCredentials();
    registerFixture();
    const out = sign({ resource: RESOURCE_ID, field: 'adjunto' });
    expect(out.allowed_formats).toBe('pdf,docx');
    expect(out.signature).toBe(
      globalThis.cloudinarySign_('private-api-secret', {
        allowed_formats: 'pdf,docx',
        folder: 'public-api/adjuntos',
        timestamp: out.timestamp,
      }),
    );
  });

  it('un `image` sin `formats` conserva la lista global', () => {
    useCloudinaryCredentials();
    registerFixture();
    const out = sign({ resource: RESOURCE_ID, field: 'foto' });
    expect(out.allowed_formats).toBe('jpg,jpeg,png,webp');
  });

  it('encuentra el campo dentro de un group y normaliza el formato', () => {
    useCloudinaryCredentials();
    registerFixture();
    const out = sign({ resource: RESOURCE_ID, field: 'interno' });
    expect(out.allowed_formats).toBe('csv');
  });

  it('un campo inexistente es 400 con el recurso y el campo a la vista', () => {
    useCloudinaryCredentials();
    registerFixture();
    let error = null;
    try {
      sign({ resource: RESOURCE_ID, field: 'no-existe' });
    } catch (caught) {
      error = caught;
    }
    expect(error).not.toBeNull();
    expect(error.apiStatus).toBe(400);
    expect(error.message).toContain(RESOURCE_ID);
    expect(error.message).toContain('no-existe');
  });

  it('un campo que no es de archivo es 400, no un fallback mudo', () => {
    useCloudinaryCredentials();
    registerFixture();
    expect(() => sign({ resource: RESOURCE_ID, field: 'titulo' })).toThrow(/no admite archivos/);
  });

  it('un `field` que no es string es 400', () => {
    useCloudinaryCredentials();
    registerFixture();
    expect(() => sign({ resource: RESOURCE_ID, field: 7 })).toThrow(/field debe ser el id/);
  });

  it('un recurso sin `imageFolder` sigue rechazando la firma', () => {
    useCloudinaryCredentials();
    registerFixture({ imageFolder: undefined });
    expect(() => sign({ resource: RESOURCE_ID })).toThrow(/no admite archivos/);
  });

  it('el secreto jamás aparece en la salida', () => {
    useCloudinaryCredentials();
    registerFixture();
    const out = sign({ resource: RESOURCE_ID, field: 'adjunto' });
    expect(JSON.stringify(out)).not.toContain('private-api-secret');
  });
});
