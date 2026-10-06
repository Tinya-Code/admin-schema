// api/__tests__/_harness — Carga el backend de Apps Script en Node.
//
// El backend son 35 scripts planos SIN import/export que comparten UN solo
// scope global, igual que en Apps Script ("all .gs files share the same
// global scope — no modules, no namespaces"). Acá se reproduce ejecutando
// cada fichero con vm.runInThisContext, que corrige en el scope global del
// proceso: las declaraciones `function` y `var` de arriba terminan en
// globalThis y son alcanzables desde los tests.
//
// Orden de carga: orden alfabético de la ruta completa, que reproduce el
// filePushOrder de clasp (baseapi §3, criterio 5: los prefijos 00-/10-/20-
// ya vienen numerados en orden de dependencias).
//
// Top-level NO hay ninguna llamada a APIs de Google: sólo var CONFIG, var
// PROP_MANIFEST y declaraciones de función. Los 7 globales de Google sólo
// se tocan dentro de funciones, así que bastan stubs inertes para cargar.
// Si un fichero empezara a ejecutar algo al cargar, el error lleva su nombre.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const API_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Globales de Google presentes en api/ — se stubbean, no se mockean a fondo. */
const GOOGLE_GLOBALS = [
  'CacheService',
  'LockService',
  'Logger',
  'PropertiesService',
  'Session',
  'SpreadsheetApp',
  'Utilities',
];

/**
 * Stub inerte: sólo evita que una llamada accidental reviente al cargar.
 *
 * Los traps devuelven el PROXY y no el target crudo. `CacheService
 * .getScriptCache().put(…)` encadena dos accesos: con el target, el segundo
 * caía en `undefined is not a function` y sólo se veía al recorrer el write
 * path real de 24-crud (el único que llama a cacheInvalidate_).
 * `then` sigue devolviendo undefined para no romper `await`.
 */
function inertStub(name) {
  const stub = () => proxy;
  const proxy = new Proxy(stub, {
    get: (target, prop) => {
      if (prop === 'then') return undefined;
      if (prop === Symbol.toPrimitive) return () => null;
      return proxy;
    },
    apply: () => proxy,
    construct: () => proxy,
  });
  return proxy;
}

function installStubs() {
  for (const name of GOOGLE_GLOBALS) {
    if (globalThis[name] === undefined) globalThis[name] = inertStub(name);
  }
  if (globalThis.ContentService === undefined) {
    globalThis.ContentService = {
      MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
      createTextOutput: (text) => ({
        getContent: () => text,
        setMimeType: function () {
          return this;
        },
      }),
    };
  }
}

/** Todos los .js de api/, excluyendo esta misma carpeta de tests. */
function listBackendFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...listBackendFiles(full));
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

function isLoaded() {
  return vm.runInThisContext('typeof REGISTRY !== "undefined"');
}

/**
 * Carga (una sola vez por proceso) y devuelve `REGISTRY`.
 *
 * `REGISTRY` se declara con `const` en 00-registry, así que vive en el
 * global lexical scope de V8 y NO aparece en globalThis. Lo proyectamos a
 * propósito para que los tests lo alcancen como `globalThis.REGISTRY`.
 */
export function loadBackend() {
  if (isLoaded()) return projectRegistry();

  installStubs();
  const files = listBackendFiles(API_ROOT).sort();
  for (const file of files) {
    try {
      vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file });
    } catch (err) {
      err.message = `No se pudo cargar ${file}: ${err.message}`;
      throw err;
    }
  }
  return projectRegistry();
}

function projectRegistry() {
  vm.runInThisContext('globalThis.REGISTRY = REGISTRY;', { filename: '_harness' });
  return globalThis.REGISTRY;
}
