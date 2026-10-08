// api/__tests__/_auth-fixtures — Doble fiel de `Utilities` y SHA de prueba.
// NO es un spec: los specs de auth la importan.
//
// El stub inerte del harness devuelve el proxy ante CUALQUIER propiedad, así
// que un método suelto no se puede parchear: hay que reemplazar el objeto
// entero. Mismo algoritmo base64url y mismo HMAC-SHA256 que Apps Script,
// para que el sobre de sesión se pueda construir y verificar en Node sin
// tocar la red.

import { createHmac } from 'node:crypto';

let uuidCounter = 0;
export const realUtilities = {
  getUuid() {
    uuidCounter += 1;
    return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
  },
  newBlob(data) {
    if (typeof data === 'string') {
      const bytes = Array.from(Buffer.from(data, 'utf8'));
      return { getBytes: () => bytes };
    }
    const buf = Buffer.from(data);
    return { getDataAsString: () => buf.toString('utf8') };
  },
  base64EncodeWebSafe(bytes) {
    return Buffer.from(bytes).toString('base64url');
  },
  base64DecodeWebSafe(text) {
    return Array.from(Buffer.from(text, 'base64url'));
  },
  computeHmacSha256Signature(value, key) {
    return Array.from(createHmac('sha256', Buffer.from(key)).update(Buffer.from(value)).digest());
  },
};

// SHA-256 no existe en Node sin `crypto` en el código del back: el back llama
// a `Props.hashText`, que aquí se parchea. Debe ser determinista e inyectable
// —es lo que hace que `kdfHash_` calcule lo mismo en la ida y en la vuelta.
export function fakeSha(text) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < String(text).length; i++) {
    const c = String(text).charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c + i, 2654435761) >>> 0;
  }
  return (h1.toString(16) + h2.toString(16)).padStart(16, '0').repeat(2);
}
