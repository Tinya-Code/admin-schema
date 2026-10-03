#!/usr/bin/env node
// scripts/contract-check.mjs — Contract check: schemas back ↔ front
// (plan doc/plan-schemas-separados.md, Fase 1, decisión D2).
//
// Compara los resources de api/schema/resources/*.js con los schemas de
// src/app/schemas/*.schema.ts:
//   1. Existencia: cada recurso del front existe en el back, y cada recurso
//      del back tiene su *.schema.ts (la F7-4 ya no existe: alta de módulo =
//      1 archivo por lado).
//   2. Ruta: los endpoints del front son la ruta efectiva del back
//      (route || /<scope>/<id>), con {key} en las operaciones con clave.
//   3. kind idéntico (collection/singleton).
//   4. Por cada campo que declara el front: existe en el back y required +
//      validators (minLength, maxLength, pattern, min, max, unique) coinciden.
//   5. Campos required del back ausentes en el front = rojo (el form no
//      podría crear el registro); los opcionales ausentes = aviso.
// Los campos system del back (p. ej. position) no se exigen en el front y
// las extraColumns (string-list) quedan fuera de alcance: el modelo front
// de string-list no las representa.
//
// Este check es HIGIENE DEL MONOREPO, no una conexión: ninguno de los dos
// lados lo ejecuta en runtime y se elimina sin que la arquitectura se entere
// si algún día se separan los repos.
//
// Uso: node scripts/contract-check.mjs   (también corre dentro de api:check)
// Exit 0 = verde · Exit 1 = rojo.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// El type stripping de Node avisa MODULE_TYPELESS_PACKAGE_JSON al importar
// los *.schema.ts; lo filtramos (el resto de warnings sí interesan).
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.code !== 'MODULE_TYPELESS_PACKAGE_JSON') console.warn(w);
});

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Validators comparables en ambos lados (D2). El resto (minWords…) es solo UX front. */
const VALIDATORS = ['minLength', 'maxLength', 'pattern', 'min', 'max', 'unique'];

const rojos = [];
const avisos = [];
const rojo = (m) => rojos.push(m);
const aviso = (m) => avisos.push(m);

/** Back: resources con auto-registro (REGISTRY.resources.<id> = {…}). */
function loadBackend() {
  const REGISTRY = { resources: {}, endpoints: {} };
  const dir = path.join(ROOT, 'api', 'schema', 'resources');
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.js')) continue;
    const code = readFileSync(path.join(dir, file), 'utf8');
    new Function('REGISTRY', `${code}\n//# sourceURL=${file}`)(REGISTRY);
  }
  return REGISTRY.resources;
}

/** Front: importa los *.schema.ts con el type stripping nativo de Node. */
async function loadFrontend() {
  const dir = path.join(ROOT, 'src', 'app', 'schemas');
  const schemas = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.schema.ts')) continue;
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    const schema = Object.values(mod).find(
      (v) => v && typeof v === 'object' && typeof v.id === 'string' && Array.isArray(v.fields),
    );
    if (schema === undefined) {
      rojo(`${file}: no se encontró un ResourceSchema exportado`);
    } else {
      schemas.push(schema);
    }
  }
  return schemas;
}

/** Aplana campos anidados por path completo (address.street, images.image_url…). */
function walkFields(fields, parent = '') {
  const map = new Map();
  for (const f of fields ?? []) {
    const p = parent === '' ? f.key : `${parent}.${f.key}`;
    map.set(p, f);
    if (f.type === 'group') {
      for (const [k, v] of walkFields(f.fields, p)) map.set(k, v);
    }
    if (f.type === 'list') {
      for (const [k, v] of walkFields(f.itemFields, p)) map.set(k, v);
    }
  }
  return map;
}

/** Validators efectivos del front: top-level (TextField.maxLength, NumberField.min…) + validators.*. */
function frontValidators(f) {
  const v = {};
  for (const k of VALIDATORS) {
    if (f.validators?.[k] !== undefined) v[k] = f.validators[k];
    else if (f[k] !== undefined) v[k] = f[k];
  }
  return v;
}

/** Validators del back: todos declarados top-level en el field. */
function backValidators(f) {
  const v = {};
  for (const k of VALIDATORS) {
    if (f[k] !== undefined) v[k] = f[k];
  }
  return v;
}

/** Ruta efectiva del back: la misma fórmula que resourceRoute_ (10-router). */
const backRoute = (r) => r.route ?? `/${r.scope ?? 'admin'}/${r.id}`;

function compareResource(front, back) {
  const id = front.id;
  if (front.kind !== back.kind) {
    rojo(`${id}: kind back='${back.kind}' front='${front.kind}'`);
  }

  // 2. Endpoints del front contra la ruta efectiva del back.
  const base = backRoute(back);
  const ops = front.endpoint ?? {};
  if (front.kind === 'singleton') {
    for (const op of ['list', 'create', 'remove']) {
      if (ops[op] !== undefined) rojo(`${id}: singleton declara endpoint.${op} ('${ops[op]}')`);
    }
  }
  for (const [op, route] of Object.entries(ops)) {
    const conClave = front.kind === 'collection' && ['get', 'update', 'remove'].includes(op);
    const esperado = conClave ? `${base}/{key}` : base;
    if (route !== esperado) {
      rojo(`${id}: endpoint.${op} front='${route}' back='${esperado}'`);
    }
  }

  // 4. Campos del front → existencia + required + validators en el back.
  const backFields = walkFields(back.fields);
  const frontFields = walkFields(front.fields);
  for (const [p, ff] of frontFields) {
    const bf = backFields.get(p);
    if (bf === undefined) {
      rojo(`${id}.${p}: el front declara el campo pero el back no lo tiene`);
      continue;
    }
    if ((ff.required === true) !== (bf.required === true)) {
      rojo(`${id}.${p}: required back=${bf.required} front=${ff.required}`);
    }
    const fv = frontValidators(ff);
    const bv = backValidators(bf);
    const claves = new Set([...Object.keys(fv), ...Object.keys(bv)]);
    for (const k of claves) {
      if (JSON.stringify(fv[k]) !== JSON.stringify(bv[k])) {
        rojo(`${id}.${p}: ${k} back=${JSON.stringify(bv[k])} front=${JSON.stringify(fv[k])}`);
      }
    }
  }

  // 5. Campos del back ausentes en el front: required = rojo, opcional = aviso.
  for (const [p, bf] of backFields) {
    if (frontFields.has(p) || bf.system === true) continue;
    if (bf.required === true) {
      rojo(`${id}.${p}: required en el back pero el front no lo declara (el form no podría crear)`);
    } else {
      aviso(`${id}.${p}: opcional en el back, ausente en el front`);
    }
  }
}

const backend = loadBackend();
const fronts = await loadFrontend();
const frontIds = new Set(fronts.map((f) => f.id));

for (const id of Object.keys(backend)) {
  if (!frontIds.has(id)) {
    rojo(
      `recurso '${id}': existe en el back pero no tiene src/app/schemas/${id}.schema.ts ` +
        '(alta de módulo = 1 archivo por lado)',
    );
  }
}

for (const front of fronts) {
  const back = backend[front.id];
  if (back === undefined) {
    rojo(`recurso '${front.id}': el front lo declara pero no existe en api/schema/resources/`);
    continue;
  }
  compareResource(front, back);
}

let campos = 0;
for (const front of fronts) {
  if (backend[front.id] !== undefined) campos += walkFields(front.fields).size;
}

for (const a of avisos) console.log(`· AVISO: ${a}`);
for (const r of rojos) console.log(`✗ ROJO: ${r}`);
if (rojos.length > 0) {
  console.log(
    `✗ ROJO: contract check — ${rojos.length} divergencia(s), ${avisos.length} aviso(s) ` +
      `(${fronts.length} recursos, ${campos} campos comparados)`,
  );
  process.exit(1);
}
console.log(
  `✓ VERDE: contract check — ${fronts.length} recursos, ${campos} campos comparados` +
    (avisos.length > 0 ? `, ${avisos.length} aviso(s)` : ''),
);
