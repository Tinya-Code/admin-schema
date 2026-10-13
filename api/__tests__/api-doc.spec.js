// api/__tests__/api-doc.spec — R5.2: la documentación NO se escribe a mano.
//
// Lo que éste archivo cubre y ninguna otra parte cubre:
//
//  1. **El doc sale del registro**: `renderDoc(REGISTRY.endpoints)` contiene
//     los 13 endpoints con su ruta, método, acceso, límites, `since`, `input`
//     y `output`. Si mañana se declara un endpoint nuevo, éste test lo exige
//     en el documento (y `api:check` exige que esté regenerado).
//  2. **El contrato para el front**: envelope, 422 con `errors[]` y el código
//     `VALIDATION_*`, y 500 de salida en dev — sin eso el front no sabe qué
//     mirar.
//  3. **La detección de desfase**: `firstDiff_` señala la PRIMERA línea que
//     no coincide, que es lo que `npm run api:check` imprime en rojo.
//
// `--check` en sí se prueba como gate (mutación: cambiar una declaración sin
// regenerar ⇒ `npm run api:check` ROJO).

import { describe, expect, it } from 'vitest';

import { buildMarkdown, firstDiff_, renderDoc } from '../../scripts/api-doc.mjs';
import { loadBackend } from './_harness.js';

const REGISTRY = loadBackend();

/** Tablas alineadas por prettier: se comparan sin espacios de relleno. */
const flat = (md) =>
  md
    .split('\n')
    .map((l) => l.replace(/\s*\|\s*/g, '|').trim())
    .join('\n');

describe('R5.2 — doc de endpoints generada del registro', () => {
  it('el doc generado contiene los 13 endpoints, ordenados por ruta', async () => {
    const doc = flat(await renderDoc(REGISTRY.endpoints));
    const rutas = Object.values(REGISTRY.endpoints)
      .map((e) => e.route)
      .sort();

    expect(rutas).toHaveLength(13);
    for (const ruta of rutas) expect(doc).toContain(`|\`${ruta}\`|`);

    // Orden estable: el resumen es alfabético por ruta (no por orden de carga).
    const orden = rutas.map((r) => doc.indexOf('|`' + r + '`|')).filter((i) => i >= 0);
    expect(orden).toHaveLength(13);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  it('cada endpoint lleva handler, acceso, límites y `since`', async () => {
    const doc = flat(await renderDoc(REGISTRY.endpoints));
    for (const e of Object.values(REGISTRY.endpoints)) {
      expect(doc).toContain(`\`${e.handler}\``);
      expect(doc).toContain(`|${e.access}|`);
      expect(doc).toContain('`' + e.since + '`');
    }
    expect(doc).toContain('`handleAuthLogin`');
    expect(doc).toContain('`orders`'); // recurso de dashboard/pin/publicOrder
  });

  it('el contrato de `input`/`output` se tabula con el vocabulario de campos', async () => {
    const doc = await renderDoc(REGISTRY.endpoints);
    expect(doc).toContain('**input — se valida ANTES del handler (422 si falla)**');
    expect(doc).toContain('**output — se valida sólo en dev (500 si falla)**');
    const tablas = flat(doc);
    expect(tablas).toContain('|`email`|`email`|no|—|');
    expect(tablas).toContain('|`password`|`secret`|no|—|');
    expect(tablas).toContain('|`token`|`text`|sí|—|');
    // Sin declaración, el doc lo DICE: no se cuela como «sin validar» en silencio.
    expect(doc).toContain('**input** — sin contrato declarado.');
    expect(doc).toContain('**output** — sin contrato declarado.');
    expect(doc).toContain(
      'Los campos **no declarados en `input` no se validan por el contrato**; el handler recibe el payload original.',
    );
  });

  it('publica el contrato que el front necesita: envelope, 422 y 500', async () => {
    const doc = await renderDoc(REGISTRY.endpoints);
    expect(doc).toContain('## Envelope (contrato para el front)');
    expect(doc).toContain('"path": "/auth/login"');
    expect(doc).toContain('errors: [{ path, message, code }]');
    expect(doc).toContain('Se valida **antes** del handler: el handler no corre.');
    expect(doc).toContain('Salida fuera de contrato en <ruta>');
    expect(doc).toContain('**410**');
    expect(doc).toContain('**413**');
    expect(doc).toContain('**503**');
    expect(doc).toContain('Apps Script devuelve éxito y errores de aplicación con HTTP 200');
    expect(doc).toContain('`VALIDATION_*`');
    expect(doc).toContain('No editar a mano');
  });

  it('documenta las relaciones inversas y su límite por padre', async () => {
    const doc = await renderDoc(REGISTRY.endpoints, REGISTRY.resources);

    expect(doc).toContain('Relaciones inversas (`hasMany`)');
    expect(doc).toContain('`products` → `products.category_slug` (máximo 100 por padre)');
    expect(doc).toContain('La expansión que exceda el límite responde **413**');
  });

  it('documenta los errores de PIN declarados y el HTTP 200 de Apps Script', async () => {
    const doc = await renderDoc(REGISTRY.endpoints);
    const pinSection = doc.split('### `POST /p/pin/:ref`')[1];

    expect(doc).toContain('**HTTP 200**');
    expect(pinSection).toContain('**Errores específicos declarados**');
    for (const status of [401, 403, 404, 409, 410, 422, 429, 500, 503]) {
      expect(pinSection).toContain(`**${status}**`);
    }
  });

  it('genera ejemplos de envelope desde input, separando params de payload', () => {
    const md = buildMarkdown({
      pinVerify: {
        route: '/p/pin/:ref',
        method: 'POST',
        access: 'public',
        limits: '5/min',
        handler: 'handlePinVerify',
        since: '1.0',
        input: {
          params: { ref: { type: 'text', required: true } },
          pin: { type: 'secret', required: true },
          options: { type: 'select', options: ['one', 'two'] },
        },
      },
    });
    const section = md.split('### `POST /p/pin/:ref`')[1];

    expect(section).toContain('"path": "/p/pin/{ref}"');
    expect(section).toContain('"payload": {\n    "pin": "<PIN>",\n    "options": "one"');
    expect(section).not.toContain('"token":');
    expect(section).toContain('`params` declarados se extraen de la ruta');
    expect(section).toContain('400 (JSON, envelope, método o clave mal formados)');
    expect(section).toContain('422 (contrato de entrada)');
    expect(section).toContain('429 (límite)');
  });

  it('documenta el transporte y cómo leer errores de Apps Script', async () => {
    const doc = await renderDoc(REGISTRY.endpoints);

    expect(doc).toContain('El `token` va en el envelope para rutas protegidas');
    expect(doc).toContain('inspecciona `body.error` aunque `response.status` sea 200');
    expect(doc).toContain('usa `error.status` como estado funcional');
    expect(doc).toContain('`meta.renewedToken`');
  });

  it('es determinista: dos renderizaciones del mismo registro son idénticas', async () => {
    const a = await renderDoc(REGISTRY.endpoints);
    const b = await renderDoc(REGISTRY.endpoints);
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(true);
  });
});

describe('R5.2 — buildMarkdown (formato crudo)', () => {
  it('tabula grupos anidados, reglas y `cache`', () => {
    const md = buildMarkdown({
      demo: {
        route: '/demo/:ref',
        method: 'POST',
        access: 'admin',
        limits: { read: '10/min' },
        handler: 'handleDemo',
        resource: 'orders',
        cache: { ttl: 60, key: ['ref'] },
        since: '1.0',
        input: {
          params: { ref: { type: 'text', required: true, pattern: '^[A-Z]+$' } },
          n: { type: 'number', min: 1, max: 10 },
        },
        output: { ok: { type: 'boolean', required: true } },
      },
    });

    const tablas = flat(md);
    expect(tablas).toContain('|`params.ref`|`text`|sí|pattern: ^[A-Z]+$|');
    expect(tablas).toContain('|`n`|`number`|no|min: 1 · max: 10|');
    expect(md).toContain('`{"ttl":60,"key":["ref"]}`');
    expect(md).toContain('`{"read":"10/min"}`');
    expect(md).toContain('`handleDemo`');
  });

  it('un endpoint sin `limits` ni `resource` muestra el guion, no `undefined`', () => {
    const md = buildMarkdown({
      x: {
        route: '/x',
        method: 'GET',
        access: 'public',
        limits: null,
        handler: 'hX',
        since: '1.0',
      },
    });
    expect(md).not.toContain('undefined');
    expect(md).toContain('**input** — sin contrato declarado.');
  });
});

describe('R5.2 — firstDiff_ (lo que api:check imprime)', () => {
  it('señala la primera línea que cambió', () => {
    const viejo = '# doc\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';
    const nuevo = '# doc\n\n| a | b |\n| - | - |\n| 1 | 3 |\n';
    expect(firstDiff_(viejo, nuevo)).toEqual({
      line: 5,
      doc: '| 1 | 2 |',
      reg: '| 1 | 3 |',
    });
  });

  it('un doc vacío se ve en la primera línea con la del registro', () => {
    // Un fichero vacío no es «fin de fichero»: es una línea en blanco, y eso
    // es exactamente lo que api:check debe enseñar.
    expect(firstDiff_('', 'nuevo\ncontenido\n')).toEqual({
      line: 1,
      doc: '',
      reg: 'nuevo',
    });
  });

  it('idénticos ⇒ ninguna línea que señalar (el gate sale verde)', () => {
    const d = firstDiff_('mismo\ntexto\n', 'mismo\ntexto\n');
    expect(d.line).toBe(4);
    expect(d.doc).toBe('(fin de fichero)');
    expect(d.reg).toBe('(fin de fichero)');
  });
});

// Sección nueva (doc/plan-doc-recursos.md, fases 1-3): el CRUD por recurso
// sale de REGISTRY.resources con la MISMA proyección que sirve /admin/schema.
describe('plan-doc-recursos — sección CRUD por recurso', () => {
  it('documenta cada recurso con sus operaciones proyectadas', async () => {
    const doc = flat(await renderDoc(REGISTRY.endpoints, REGISTRY.resources));
    expect(doc).toContain('## Recursos (CRUD por recurso)');
    for (const [id, r] of Object.entries(REGISTRY.resources)) {
      expect(doc).toContain(`### \`${id}\``);
      expect(doc).toContain(`[\`${id}\`](#${id})`);
      const ops = globalThis.projectResourceSchema_(r).operations;
      for (const entry of Object.values(ops)) {
        expect(doc).toContain(`|${entry.method}|\`${entry.path}\``);
      }
    }
  });

  it('los campos secret no aparecen ni nombrados (R7.6)', async () => {
    const doc = await renderDoc(REGISTRY.endpoints, REGISTRY.resources);
    for (const secret of ['pass_hash', 'pass_salt', 'token_version']) {
      expect(doc).not.toContain(secret);
    }
  });

  it('marca lo que genera el back: users.id (uuid), products.slug, orders.ref', async () => {
    const doc = flat(await renderDoc(REGISTRY.endpoints, REGISTRY.resources));
    expect(doc).toContain('generado: create · uuid');
    expect(doc).toContain('generado: create · slugify');
    expect(doc).toContain('generado: create · token');
  });

  it('distingue la proyección pública de orders y documenta sus acciones', async () => {
    const doc = flat(await renderDoc(REGISTRY.endpoints, REGISTRY.resources));
    const orders = doc.slice(doc.indexOf('### `orders`'), doc.indexOf('### `pickpass`'));
    const publicAudience = orders.split('**Proyección pública**')[1].split('**Política**')[0];

    expect(orders).toContain('**Audiencia pública** — operaciones CRUD: `get`');
    expect(publicAudience).not.toContain('`history`');
    expect(publicAudience).not.toContain('`pin`');
    expect(orders).toContain(
      '|POST|`/admin/orders/{ref}/actions/regenerate-pin`|`handlePinRegenerate`|write del recurso (`admin`)|',
    );
    expect(orders).toContain('visible en `/admin/schema`');
  });

  it('documenta el PIN como entrada requerida del endpoint público', async () => {
    const doc = flat(await renderDoc(REGISTRY.endpoints, REGISTRY.resources));
    expect(doc).toContain('|`params.ref`|`text`|sí|—|');
    expect(doc).toContain('|`pin`|`secret`|sí|—|');
  });

  it('proyecta sólo el contrato consumible de commands, sin reglas ni secretos', () => {
    const resource = REGISTRY.resources.orders;
    const originalCommands = resource.commands;
    const originalUploadProfiles = REGISTRY.uploadProfiles;
    try {
      REGISTRY.uploadProfiles = {
        pickupPhoto: {
          provider: 'cloudinary',
          resource: 'orders',
          grant: 'internalGrantId',
          mimeTypes: ['image/jpeg', 'image/png'],
          maxBytes: 10 * 1024 * 1024,
          ttlSeconds: 300,
          namespace: 'internal-folder-name',
        },
      };
      resource.commands = {
        registerPickupPerson: {
          input: {
            pin: { type: 'secret', required: true },
            photo: { type: 'upload', profile: 'pickupPhoto', required: true },
          },
          output: { grantToken: { type: 'text', required: true } },
          access: 'public',
          grant: 'internalGrantId',
          limits: '5/min',
          idempotency: 'required',
          errors: [{ status: 409, code: 'ALREADY_DONE', message: 'Already completed.' }],
          preconditions: [{ field: 'auth_state', op: 'eq', value: 'NINGUNO' }],
          changes: { auth_state: { value: 'ACTIVA' } },
          events: [{ appendTo: 'history', values: { action: { value: 'AUTORIZADO' } } }],
          handler: 'internalHandlerName',
        },
      };

      const projected = globalThis.projectResourceSchema_(resource).commands;
      expect(projected.registerPickupPerson).toEqual({
        access: 'public',
        input: {
          pin: { type: 'secret', required: true },
          photo: {
            type: 'upload',
            required: true,
            mimeTypes: ['image/jpeg', 'image/png'],
            maxBytes: 10 * 1024 * 1024,
          },
        },
        output: { grantToken: { type: 'text', required: true } },
        idempotency: 'required',
        grantRequired: true,
        limits: '5/min',
        errors: [{ status: 409, code: 'ALREADY_DONE', message: 'Already completed.' }],
      });
      expect(JSON.stringify(projected)).not.toContain('internalGrantId');
      expect(JSON.stringify(projected)).not.toContain('internal-folder-name');
      expect(JSON.stringify(projected)).not.toContain('internalHandlerName');
      expect(JSON.stringify(projected)).not.toContain('preconditions');
      expect(JSON.stringify(projected)).not.toContain('changes');
      expect(JSON.stringify(projected)).not.toContain('events');
    } finally {
      resource.commands = originalCommands;
      REGISTRY.uploadProfiles = originalUploadProfiles;
    }
  });

  it('documenta la ruta declarada y el contrato del command sin exponer reglas internas', async () => {
    const resource = REGISTRY.resources.orders;
    const originalCommands = resource.commands;
    try {
      resource.commands = {
        registerPickupPerson: {
          input: { authorized_name: { type: 'text', required: true, maxLength: 80 } },
          output: { ok: { type: 'boolean', required: true } },
          access: 'public',
          grant: 'internalGrantId',
          idempotency: 'required',
          errors: [{ status: 409, code: 'ALREADY_DONE', message: 'Already completed.' }],
          changes: { auth_state: { value: 'ACTIVA' } },
        },
      };
      const doc = flat(await renderDoc(REGISTRY.endpoints, REGISTRY.resources));
      const orders = doc.slice(doc.indexOf('### `orders`'), doc.indexOf('### `pickpass`'));
      const commandDoc = orders.split('**Contratos de commands**')[1].split('**Campos del CRUD')[0];
      expect(orders).toContain('**Contratos de commands**');
      expect(orders).toContain('#### `registerPickupPerson`');
      expect(commandDoc).toContain('Ruta: POST `/p/orders/{ref}/commands/registerPickupPerson`');
      expect(orders).toContain('grant requerido: sí');
      expect(orders).toContain('Errores: 409 `ALREADY_DONE`: Already completed.');
      expect(commandDoc).not.toContain('internalGrantId');
      expect(commandDoc).not.toContain('auth_state');
    } finally {
      resource.commands = originalCommands;
    }
  });

  it('sin resources el doc sigue siendo sólo endpoints (compat)', async () => {
    const sin = await renderDoc(REGISTRY.endpoints);
    const con = await renderDoc(REGISTRY.endpoints, REGISTRY.resources);
    expect(sin).not.toContain('## Recursos (CRUD por recurso)');
    expect(con).toContain('## Recursos (CRUD por recurso)');
  });
});
