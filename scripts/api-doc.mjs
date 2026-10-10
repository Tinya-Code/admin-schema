#!/usr/bin/env node
// scripts/api-doc.mjs — documentación de endpoints generada del registro (R5.2 · B2).
//
//   npm run api:doc                    → regenera doc/api-endpoints.md
//   node scripts/api-doc.mjs --check   → no escribe; ROJO si el doc está viejo
//
// La fuente es `REGISTRY.endpoints` (api/schema/endpoints/*.js): la doc NO se
// escribe a mano, así que una declaración nueva sólo puede quedar vieja en el
// documento — y eso lo convierte en rojo dentro de `npm run api:check`.
//
// Salida: **OpenAPI-lite** (resumen + una ficha por endpoint con `input` y
// `output` en el mismo vocabulario `FIELD_TYPES` que valida el router) y el
// **contrato para el front**: envelope, códigos 422 (`errors[]` con
// `VALIDATION_*`) y 500 de salida en dev. Es el documento que el front debe
// poder leer sin tocar el código del back.
//
// El texto se formatea con el MISMO prettier del repo (`npx prettier --check .`)
// para que el doc generado y el commiteado sean byte a byte idénticos: gate 5
// no puede encenderte por la doc.
//
// Uso: node scripts/api-doc.mjs [--check]   · Exit 0 = verde · Exit 1 = rojo.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import prettier from 'prettier';

// El type stripping de Node avisa MODULE_TYPELESS_PACKAGE_JSON al importar
// _harness.js (no es `type: module`); lo filtramos como contract-check.mjs.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.code !== 'MODULE_TYPELESS_PACKAGE_JSON') console.warn(w);
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DOC_PATH = join(ROOT, 'doc', 'api-endpoints.md');

/** Columnas de reglas que el doc vale la pena mostrar (el resto es ruido). */
const RULE_KEYS = [
  'minLength',
  'maxLength',
  'pattern',
  'min',
  'max',
  'minItems',
  'maxItems',
  'unique',
  'options',
  'enum',
  'default',
];

const esc = (s) => String(s).replace(/\|/g, '\\|');

/** `minLength: 3 · pattern: ^[a-z]+$` — vacío si el campo no declara reglas. */
function rules_(field) {
  const parts = [];
  for (const key of RULE_KEYS) {
    if (field[key] === undefined) continue;
    const value = field[key];
    parts.push(
      key + ': ' + (Array.isArray(value) ? `${value.length} valores` : esc(String(value))),
    );
  }
  return parts.join(' · ') || '—';
}

/** Filas de una tabla de campos; los grupos se anidan con `grupo.campo`. */
function fieldRows_(decl, prefix = '') {
  if (!decl) return [];
  const rows = [];
  for (const key of Object.keys(decl)) {
    const entry = decl[key];
    const path = prefix + key;
    if (entry && typeof entry === 'object' && typeof entry.type !== 'string') {
      rows.push(...fieldRows_(entry, path + '.'));
      continue;
    }
    rows.push(
      `| \`${path}\` | \`${entry.type}\` | ${entry.required ? 'sí' : 'no'} | ${rules_(entry)} |`,
    );
  }
  return rows;
}

const FIELD_HEADER = '| Campo | Tipo | Obligatorio | Reglas |\n| --- | --- | --- | --- |';

/** Bloque de una tabla de campos, o la ausencia de contrato declarado. */
function contractBlock_(title, decl) {
  const rows = fieldRows_(decl);
  if (rows.length === 0) return `**${title}** — sin contrato declarado.`;
  return [`**${title}**`, '', FIELD_HEADER, ...rows].join('\n');
}

/** El documento crudo (sin formatear). La formatación es de `renderDoc`. */
export function buildMarkdown(endpoints) {
  const ids = Object.keys(endpoints).sort((a, b) => {
    const ra = endpoints[a].route;
    const rb = endpoints[b].route;
    return ra === rb
      ? String(endpoints[a].method).localeCompare(endpoints[b].method)
      : ra.localeCompare(rb);
  });

  const summary = ids.map((id, i) => {
    const e = endpoints[id];
    const limit =
      e.limits === null || e.limits === undefined
        ? '—'
        : typeof e.limits === 'string'
          ? `\`${e.limits}\``
          : '`' + JSON.stringify(e.limits) + '`';
    return [
      `| ${i + 1} | ${e.method} | \`${e.route}\` | ${e.access} | ${limit} | ${
        e.resource ? `\`${e.resource}\`` : '—'
      } | ${e.input ? 'sí' : 'no'} | ${e.output ? 'sí' : 'no'} | \`${e.since}\` |`,
    ].join('');
  });

  const fichas = ids.map((id) => {
    const e = endpoints[id];
    const limit =
      e.limits === null || e.limits === undefined
        ? '—'
        : typeof e.limits === 'string'
          ? e.limits
          : JSON.stringify(e.limits);
    const head = [
      `### \`${e.method} ${e.route}\``,
      '',
      `| Handler | Acceso | Límites | Recurso | \`cache\` | \`since\` |`,
      `| --- | --- | --- | --- | --- | --- |`,
      `| \`${e.handler}\` | ${e.access} | ${esc(limit)} | ${
        e.resource ? `\`${e.resource}\`` : '—'
      } | ${e.cache ? '`' + JSON.stringify(e.cache) + '`' : '—'} | \`${e.since}\` |`,
      '',
      contractBlock_(
        e.input ? 'input — se valida ANTES del handler (422 si falla)' : 'input',
        e.input,
      ),
      '',
      contractBlock_(
        e.output ? 'output — se valida sólo en dev (500 si falla)' : 'output',
        e.output,
      ),
    ];
    if (e.input) {
      head.push('', 'Los campos **no declarados en `input` se ignoran** (lista blanca).');
    }
    return head.join('\n');
  });

  return [
    '# API — contrato de endpoints (OpenAPI-lite)',
    '',
    '> **Documento generado** por `scripts/api-doc.mjs` a partir de',
    '> `api/schema/endpoints/*.js`. No editar a mano: `npm run api:doc` lo',
    '> regenera y `npm run api:check` lo marca ROJO si no coincide con el',
    '> registro.',
    '',
    '## Envelope (contrato para el front)',
    '',
    'Apps Script no expone cabeceras: todo viaja en el cuerpo de un `POST`',
    '(`Content-Type: text/plain`, sin preflight — ver `doc/baseapi.md` §2).',
    '',
    '```json',
    '{ "token": "<sólo admin>", "method": "POST", "path": "/auth/login", "payload": {} }',
    '```',
    '',
    '| Código | Cuándo | Forma |',
    '| --- | --- | --- |',
    '| **422** | El `input` declarado rechaza la petición. Se valida **antes** del handler: el handler no corre. | `{ error: { status, message, errors: [{ path, message, code }] } }` |',
    '| **500** | Sólo en dev: la salida no cumple el `output` declarado. En prod el contrato documenta, no frena. | `{ error: { status, message: "Salida fuera de contrato en <ruta>: <campo> …" } }` |',
    '| **401 / 403 / 429** | Auth, `access` y límites — no los decide el contrato de `input`. | `{ error: { status, message, code } }` |',
    '',
    'Los `code` de un 422 son `VALIDATION_*` y comparten vocabulario con',
    '`src/app/core/registry/field-validators.ts` (check 11 de contract-check).',
    '',
    '## Listados de recurso (`GET /admin/<recurso>`, R6.4)',
    '',
    'Las rutas CRUD de recurso **no** salen de `REGISTRY.endpoints` (no tienen',
    '`handler` propio): las arma el motor desde el recurso. Éste es el contrato',
    'que comparten todas las de listado.',
    '',
    '### Entrada de paginación — mutuamente excluyente',
    '',
    '| Clave | Forma | Cuándo se usa |',
    '| --- | --- | --- |',
    '| `page` | `{ size: ≥1, offset?: ≥0 }` | primera página, por posición |',
    '| `cursor` | `<nextCursor>` | continuación: el token de la página anterior |',
    '',
    'Las dos a la vez, un `size`/`offset` no entero, una clave fuera de',
    '`size`/`offset` o un cursor corrupto ⇒ **422** con `errors[]`. Se valida',
    '**antes** de leer la hoja.',
    '',
    '### Salida — sobre estándar',
    '',
    "Cuando la operación declara `shape.envelope: 'list'`, la respuesta es",
    'SIEMPRE ésta, con y sin página pedida:',
    '',
    '```json',
    '{ "items": [ … ], "nextCursor": "eyJ2IjoxLCJvIjoyfQ", "total": 128 }',
    '```',
    '',
    '| Clave | Significado |',
    '| --- | --- |',
    '| `items` | la página pedida; sin paginar, la lista entera |',
    '| `nextCursor` | token **opaco** para la página siguiente; `null` en la última |',
    '| `total` | filas que coinciden con el filtro/vista **antes** del corte |',
    '',
    "Sin `envelope: 'list'` no hay dónde devolver el cursor, así que **pedir",
    'página a ese listado responde 422** en vez de cortar en silencio; lo',
    'mismo con una vista `aggregate` (devuelve UNA fila de resultado). Los',
    '`code` de éstos y de la paginación son `VALIDATION_PAGE`,',
    '`VALIDATION_PAGE_SIZE`, `VALIDATION_PAGE_OFFSET`, `VALIDATION_CURSOR` y',
    '`VALIDATION_PAGINATION`, con `path` relativo al payload.',
    '',
    '## Resumen',
    '',
    '| # | Método | Ruta | Acceso | Límites | Recurso | `input` | `output` | `since` |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...summary,
    '',
    '## Endpoints',
    '',
    fichas.join('\n\n---\n\n'),
  ].join('\n');
}

/** Primera línea que difiere entre el doc commiteado y el del registro. */
export function firstDiff_(actual, expected) {
  const a = String(actual).split('\n');
  const b = String(expected).split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return { line: i + 1, doc: a[i] ?? '(fin de fichero)', reg: b[i] ?? '(fin de fichero)' };
}

/** Documento final: crudo + formato del prettier del repo. */
export async function renderDoc(endpoints) {
  const opts = (await prettier.resolveConfig(DOC_PATH)) ?? {};
  return prettier.format(buildMarkdown(endpoints), { ...opts, parser: 'markdown' });
}

async function main(argv) {
  const { loadBackend } = await import('../api/__tests__/_harness.js');
  const doc = await renderDoc(loadBackend().endpoints);
  const check = argv.includes('--check');

  let actual = null;
  try {
    actual = readFileSync(DOC_PATH, 'utf8');
  } catch {
    /* aún no existe */
  }

  if (check) {
    if (actual === doc) {
      console.log(`✓ VERDE: doc de endpoints al día (${DOC_PATH.slice(ROOT.length + 1)})`);
      return 0;
    }
    console.log('✗ ROJO: doc de endpoints desactualizada — corre `npm run api:doc`');
    if (actual === null) {
      console.log('  (el documento no existe)');
    } else {
      const d = firstDiff_(actual, doc);
      console.log(`  primera diferencia en la línea ${d.line}:`);
      console.log(`    doc : ${d.doc}`);
      console.log(`    registro: ${d.reg}`);
    }
    return 1;
  }

  writeFileSync(DOC_PATH, doc);
  console.log(`✓ escrito: ${DOC_PATH.slice(ROOT.length + 1)} (${doc.split('\n').length} líneas)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
