#!/usr/bin/env node
// scripts/api-doc.mjs — documentación de endpoints generada del registro (R5.2 · B2).
//
//   npm run api:doc                    → regenera doc/api-endpoints.md
//   node scripts/api-doc.mjs --check   → no escribe; ROJO si el doc está viejo
//
// La fuente es `REGISTRY.endpoints` (api/schema/endpoints/*.js) + la sección
// de `REGISTRY.resources` (api/schema/resources/*.js, CRUD por recurso —
// plan en doc/plan-doc-recursos.md): la doc NO se escribe a mano, así que una
// declaración nueva sólo puede quedar vieja en el documento — y eso lo
// convierte en rojo dentro de `npm run api:check`.
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

/** Valores ilustrativos para construir un envelope desde el contrato de input. */
function sampleValue_(key, field) {
  if (field.type === 'secret') return `<${key.toUpperCase()}>`;
  if (field.default !== undefined) return field.default;
  const choices = field.enum ?? field.options;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0];
    if (typeof first === 'string' || typeof first === 'number') return first;
    if (first && typeof first === 'object') return first.value ?? first.key ?? `<${key}>`;
  }
  switch (field.type) {
    case 'boolean':
      return true;
    case 'number':
    case 'currency':
      return field.min ?? 1;
    case 'email':
      return 'usuario@example.com';
    case 'url':
      return 'https://example.com';
    case 'date':
      return '2026-01-31';
    case 'time':
      return '09:00';
    case 'select':
      return `<${key}>`;
    case 'multiselect':
      return [];
    case 'group':
      return {};
    case 'text':
    case 'textarea':
    case 'readonly-text':
    case 'slug':
      return field.minLength ? 'x'.repeat(field.minLength) : `<${key}>`;
    default:
      return `<${key}>`;
  }
}

function sampleShape_(shape) {
  return Object.fromEntries(
    Object.entries(shape ?? {}).map(([key, field]) => [
      key,
      field && typeof field.type === 'string' ? sampleValue_(key, field) : sampleShape_(field),
    ]),
  );
}

/** Construye el payload de ejemplo; `params` pertenece a la ruta, no al body. */
function samplePayload_(input) {
  const payload = {};
  for (const [key, entry] of Object.entries(input ?? {})) {
    if (key === 'params') continue;
    if (entry && typeof entry.type === 'string') {
      payload[key] = sampleValue_(key, entry);
      continue;
    }
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      payload[key] = sampleShape_(entry);
    }
  }
  return payload;
}

/** Error statuses comunes que el router puede producir para este endpoint. */
function commonErrorSummary_(endpoint) {
  const malformed = endpoint.route.includes('/:')
    ? '400 (JSON, envelope, método o clave mal formados)'
    : '400 (JSON, envelope o método mal formados)';
  const errors = [malformed];
  if (endpoint.access !== 'public') errors.push('401/403 (sesión o acceso)');
  errors.push('404 (ruta o registro inexistente)');
  if (endpoint.input) errors.push('422 (contrato de entrada)');
  if (endpoint.limits !== undefined && endpoint.limits !== null) errors.push('429 (límite)');
  errors.push('500 (error interno)');
  return errors.join(' · ');
}

// ── Recursos CRUD (REGISTRY.resources) — plan §4 ────────────────────────────
//
// La fuente son los resources del back, NO el schema del front: el contract
// ya valida ese contra este. Rutas y campos publicables salen de
// `projectResourceSchema_` (handlers/schema.js) — la MISMA proyección que
// sirve GET /admin/schema, así el doc nunca promete una ruta que el router
// no resuelva. Un campo `secret` (R7.6) jamás se nombra.

/** Legible para el doc: `FIELD_TYPES.readable === false` o `type: 'secret'`. */
function readable_(field) {
  const ft = globalThis.FIELD_TYPES;
  const meta = ft ? ft[field.type] : undefined;
  if (meta && meta.readable === false) return false;
  return field.type !== 'secret';
}

/** field.key → 'create · uuid' para lo que genera el back en el alta. */
function generatedBy_(resource) {
  const map = new Map();
  const ops = resource.operations ?? {};
  for (const op of ['create', 'update']) {
    const decl = ops[op];
    const computed = decl && typeof decl === 'object' ? decl.computed : null;
    if (!Array.isArray(computed)) continue;
    for (const d of computed) {
      if (d && typeof d.field === 'string' && typeof d.transform === 'string') {
        map.set(d.field, `${op} · ${d.transform}`);
      }
    }
  }
  return map;
}

/**
 * Tabla de campos del back. Misma cabecera que `FIELD_HEADER`, más la marca
 * de generación en la columna de reglas. `itemFields` (type: list) anida con
 * prefijo `hijo.` — los hijos de `history` se leen como `history.at`.
 */
function backFieldRows_(fields, generated, prefix = '') {
  const rows = [];
  for (const field of fields ?? []) {
    if (!readable_(field)) continue;
    const path = prefix + field.key;
    const marks = [];
    const g = generated.get(field.key);
    if (g) marks.push(`generado: ${g}`);
    if (field.computed === 'now') marks.push('generado: now');
    if (field.system) marks.push('sistema');
    const rules = [rules_(field), ...marks].filter((p) => p && p !== '—').join(' · ');
    rows.push(
      `| \`${path}\` | \`${field.type}\` | ${field.required ? 'sí' : 'no'} | ${rules || '—'} |`,
    );
    if (Array.isArray(field.itemFields)) {
      rows.push(...backFieldRows_(field.itemFields, new Map(), `${path}.`));
    }
  }
  return rows;
}

/** Operaciones efectivas: proyectadas; fallback si el handler no cargó. */
function projectedOps_(resource) {
  if (typeof globalThis.projectResourceSchema_ === 'function') {
    return globalThis.projectResourceSchema_(resource).operations ?? {};
  }
  const base = '/admin/' + resource.id;
  const ruta = { list: base, create: base, update: base, remove: base, get: base + '/{key}' };
  const metodo = { list: 'GET', get: 'GET', create: 'POST', update: 'PUT', remove: 'DELETE' };
  const out = {};
  for (const [name, declared] of Object.entries(resource.operations ?? {})) {
    if (!declared) continue;
    if (name === 'remove' && typeof declared === 'object' && declared.mode === 'forbidden')
      continue;
    out[name] = { method: metodo[name] ?? 'GET', path: ruta[name] ?? base };
  }
  return out;
}

/** Ficha completa de un recurso (plan §4). */
function resourceBlock_(resource) {
  const proy =
    typeof globalThis.projectResourceSchema_ === 'function'
      ? globalThis.projectResourceSchema_(resource)
      : {};
  const generated = generatedBy_(resource);
  const pol = resource.policies ?? {};
  const commandBase =
    resource.commandsRoute || resource.route || `/${resource.scope ?? 'admin'}/${resource.id}`;
  const commands = Object.entries(proy.commands ?? {}).map(([name, command]) => {
    const errors = (command.errors ?? [])
      .map((error) => `${error.status} \`${error.code}\`: ${error.message}`)
      .join('; ');
    return [
      `#### \`${name}\``,
      '',
      `Ruta: POST \`${commandBase}/{${resource.keyField}}/commands/${name}\``,
      '',
      `Acceso: \`${command.access}\` · grant requerido: ${command.grantRequired ? 'sí' : 'no'} · idempotencia: \`${command.idempotency}\`${
        command.limits ? ` · límite: \`${command.limits}\`` : ''
      }`,
      '',
      `Input: \`${JSON.stringify(command.input)}\``,
      '',
      `Output: \`${JSON.stringify(command.output)}\``,
      '',
      `Errores: ${errors || '—'}`,
    ].join('\n');
  });
  const actions = Object.entries(resource.actions ?? {}).map(([name, decl]) => {
    const access = decl.access
      ? `\`${decl.access}\``
      : `write del recurso (\`${pol.access?.write ?? 'admin por defecto'}\`)`;
    return `| POST | \`/admin/${resource.id}/{${resource.keyField}}/actions/${name}\` | \`${
      decl.handler ?? '—'
    }\` | ${access} |`;
  });

  const opRows = Object.entries(projectedOps_(resource)).map(([name, entry]) => {
    const notas = [];
    if (name === 'create' && Array.isArray(resource.operations?.create?.computed)) {
      notas.push(
        'genera: ' +
          resource.operations.create.computed
            .map((d) => `\`${d.field}\` (${d.transform})`)
            .join(', '),
      );
    }
    if (name === 'remove') {
      notas.push(
        resource.activeField ? `baja lógica vía \`${resource.activeField}\`` : 'hard delete',
      );
    }
    if (name === 'update' && Array.isArray(resource.operations?.update?.computed)) {
      notas.push(
        'deriva: ' + resource.operations.update.computed.map((d) => `\`${d.field}\``).join(', '),
      );
    }
    return `| ${entry.method} | \`${entry.path}\` | ${notas.join(' · ') || '—'} |`;
  });

  const acceso = [
    pol.access?.read ? `read: \`${pol.access.read}\`` : null,
    pol.access?.write ? `write: \`${pol.access.write}\`` : null,
    pol.cache ? `cache: ${esc(JSON.stringify(pol.cache))}` : null,
    pol.audit ? 'audit' : null,
    pol.lock ? 'lock' : null,
    resource.exposeToFront ? 'visible en `/admin/schema`' : 'sólo back',
  ]
    .filter(Boolean)
    .join(' · ');

  const campos = backFieldRows_(resource.fields, generated);
  const listFields = (proy.listProjection ?? resource.listProjection ?? [])
    .map((k) => `\`${k}\``)
    .join(', ');
  const hasMany = Object.entries(resource.hasMany ?? {}).map(
    ([alias, declaration]) =>
      `\`${alias}\` → \`${declaration.resource}.${declaration.field}\` (máximo ${declaration.limit} por padre)`,
  );
  const publicAudience = resource.audiences?.public;
  const resourceFields = new Map((resource.fields ?? []).map((field) => [field.key, field]));
  const publicFields = (publicAudience?.listProjection ?? [])
    .filter((key) => readable_(resourceFields.get(key) ?? {}))
    .map((key) => `\`${key}\``)
    .join(', ');
  const audienceBlock = publicAudience
    ? [
        '',
        `**Audiencia pública** — operaciones CRUD: ${
          (publicAudience.operations ?? []).map((op) => `\`${op}\``).join(', ') || '—'
        }`,
        `**Proyección pública** — ${publicFields || '—'}`,
        'Las acciones y endpoints custom se declaran por separado; no son operaciones CRUD de esta audiencia.',
      ]
    : [];

  return [
    `### \`${resource.id}\``,
    '',
    `titleField: \`${resource.titleField}\` · kind: \`${resource.kind}\` · sheet: \`${
      resource.sheet ?? '—'
    }\` · keyField: \`${resource.keyField}\`${
      resource.activeField ? ` · activeField: \`${resource.activeField}\`` : ''
    }${resource.ordering ? ` · ordering: ${esc(String(resource.ordering))}` : ''}`,
    '',
    '**Operaciones**',
    '',
    '| Método | Path | Notas |',
    '| --- | --- | --- |',
    ...opRows,
    ...(actions.length > 0
      ? [
          '',
          '**Acciones de dominio**',
          '',
          '| Método | Path | Handler | Acceso |',
          '| --- | --- | --- | --- |',
          ...actions,
        ]
      : []),
    ...(commands.length > 0
      ? [
          '',
          '**Contratos de commands**',
          '',
          'Ruta de transporte y contrato derivados del schema del recurso.',
          '',
          ...commands,
        ]
      : []),
    '',
    '**Campos del CRUD del recurso — payload y respuesta (los `secret` no existen para el doc, R7.6)**',
    '',
    FIELD_HEADER,
    ...campos,
    '',
    `**Listado** — \`listProjection\`: ${listFields || '—'}`,
    ...(hasMany.length > 0
      ? [
          '',
          `**Relaciones inversas (\`hasMany\`)** — ${hasMany.join('; ')}. La expansión que exceda el límite responde **413**; no se trunca.`,
        ]
      : []),
    ...audienceBlock,
    '',
    `**Política** — ${acceso || '—'}`,
  ].join('\n');
}

/** Sección completa: índice de recursos + ficha por recurso (orden alfabético). */
function resourceSection_(resources) {
  const ids = Object.keys(resources ?? {}).sort();
  if (ids.length === 0) return [];
  const head = [
    '## Recursos (CRUD por recurso)',
    '',
    '> **Generado** de `api/schema/resources/*.js` (este bloque no se edita a',
    '> mano). Las rutas salen de la misma proyección que sirve',
    '> `GET /admin/schema`: una operación apagada no aparece acá porque',
    '> responde 405. Los campos `secret` jamás se nombran.',
    '',
    '| # | Recurso | keyField | Operaciones | Acceso (write) |',
    '| --- | --- | --- | --- | --- |',
  ];
  ids.forEach((id, i) => {
    const r = resources[id];
    const ops = Object.keys(projectedOps_(r))
      .sort()
      .map((o) => `\`${o}\``)
      .join(', ');
    head.push(
      `| ${i + 1} | [\`${id}\`](#${id}) | \`${r.keyField}\` | ${ops} | ${
        r.policies?.access?.write ? `\`${r.policies.access.write}\`` : '—'
      } |`,
    );
  });
  for (const id of ids) head.push('', resourceBlock_(resources[id]));
  return head;
}

/** El documento crudo (sin formatear). La formatación es de `renderDoc`.
 *  `resources` (REGISTRY.resources) añade la sección de CRUD por recurso. */
export function buildMarkdown(endpoints, resources = null) {
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
    const examplePath = String(e.route).replace(/:([A-Za-z0-9_]+)/g, '{$1}');
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
      '',
      '**Cómo llamar** — envía siempre un `POST` HTTP a `API_URL`; el método de la operación va en `method` dentro del envelope.',
      'Sustituye los parámetros `{...}` de `path` por valores URL-encoded. Los campos y filtros van en `payload`; los `params` declarados se extraen de la ruta y no se repiten en el body. El ejemplo usa valores ilustrativos, no necesariamente válidos para todas las reglas.',
      '',
      '```json',
      JSON.stringify(
        {
          ...(e.access === 'public' ? {} : { token: '<token de sesión/admin>' }),
          method: e.method,
          path: examplePath,
          payload: samplePayload_(e.input),
        },
        null,
        2,
      ),
      '```',
      '',
      `**Errores comunes del router** — ${commonErrorSummary_(e)}. Los detalles específicos del handler se listan aparte cuando están declarados.`,
    ];
    if (Array.isArray(e.errors) && e.errors.length > 0) {
      head.push(
        '',
        '**Errores específicos declarados** — `status` es el código de aplicación dentro de `error`; Apps Script responde HTTP 200.',
        '',
        '| `status` | `code` | Significado |',
        '| --- | --- | --- |',
        ...e.errors.map(
          ({ status, code, description }) =>
            `| **${status}** | ${code ? `\`${esc(code)}\`` : '—'} | ${esc(description)} |`,
        ),
      );
    }
    if (e.input) {
      head.push(
        '',
        'Los campos **no declarados en `input` no se validan por el contrato**; el handler recibe el payload original.',
      );
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
    '> Guía de flujo público de retiro: `doc/integracion-autorizacion-publica.md`.',
    '',
    '## Envelope (contrato para el front)',
    '',
    'Apps Script no expone cabeceras: todo viaja en el cuerpo de un `POST`',
    '(`Content-Type: text/plain`, sin preflight — ver `doc/baseapi.md` §2).',
    'El `token` va en el envelope para rutas protegidas y se omite en rutas `public`; no se envía en una cabecera ni en la URL. `path` es la ruta lógica, no la URL del web app. Las query strings se descartan: envía filtros en `payload`.',
    '',
    '```json',
    '{ "token": "<token de sesión>", "method": "GET", "path": "/admin/orders", "payload": {} }',
    '```',
    '',
    'La respuesta exitosa es el JSON plano del handler (no se envuelve en `data`). Para errores, inspecciona `body.error` aunque `response.status` sea 200; usa `error.status` como estado funcional y, si existe, `error.code` para distinguir el caso. En validación, procesa todos los elementos de `error.errors` usando su `path`.',
    '',
    '```json',
    '{ "error": { "status": 422, "message": "Errores de validación", "errors": [{ "path": "pin", "message": "...", "code": "VALIDATION_*" }] } }',
    '```',
    '',
    'En producción, `output` es documentación del contrato; sólo se valida en modo dev. Una respuesta puede añadir `meta.renewedToken` cuando se renueva una sesión.',
    '',
    '| Código de aplicación | Cuándo | Forma |',
    '| --- | --- | --- |',
    '| **HTTP 200** | Apps Script devuelve éxito y errores de aplicación con HTTP 200; el estado funcional está en el JSON. | JSON plano en éxito; `{ error: { status, message, code?, errors? } }` en error. |',
    '| **400** | JSON/envelope inválido, método o payload mal formados, o clave de ruta inválida. | `{ error: { status, message } }` |',
    '| **401** | Sesión no válida o rechazo de credenciales/PIN. | `{ error: { status, message, code? } }` |',
    '| **403** | Acceso insuficiente o la operación no está permitida para el estado actual. | `{ error: { status, message } }` |',
    '| **404** | Ruta, recurso o registro inexistente; algunos endpoints ocultan recursos no disponibles con este estado. | `{ error: { status, message } }` |',
    '| **409** | Conflicto de estado, como un PIN ya utilizado. | `{ error: { status, message } }` |',
    '| **410** | Recurso temporal vencido, como un PIN expirado. | `{ error: { status, message } }` |',
    '| **413** | Expansión `hasMany` supera el límite por padre declarado en el schema. | `{ error: { status, message } }` |',
    '| **422** | El `input` declarado rechaza la petición. Se valida **antes** del handler: el handler no corre. | `{ error: { status, message, errors: [{ path, message, code }] } }` |',
    '| **429** | Límite de peticiones o intentos excedido. | `{ error: { status, message, code? } }` |',
    '| **500** | Error interno; en dev también si la salida incumple `output` (en producción ese chequeo de contrato no frena la respuesta). | `{ error: { status, message: "Salida fuera de contrato en <ruta>: <campo> …" } }` para salida inválida. |',
    '| **503** | Dependencia o configuración temporalmente no disponible. | `{ error: { status, message } }` |',
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
    ...(resources ? resourceSection_(resources) : []),
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
export async function renderDoc(endpoints, resources = null) {
  const opts = (await prettier.resolveConfig(DOC_PATH)) ?? {};
  return prettier.format(buildMarkdown(endpoints, resources), { ...opts, parser: 'markdown' });
}

async function main(argv) {
  const { loadBackend } = await import('../api/__tests__/_harness.js');
  const backend = loadBackend();
  const doc = await renderDoc(backend.endpoints, backend.resources);
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
