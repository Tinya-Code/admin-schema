#!/usr/bin/env node
// scripts/contract-check.mjs — Contract check: schemas back ↔ front
// (doc/refactormotor.md §5 — contrato front ↔ back, una sola fuente).
//
// Compara los resources de api/schema/resources/*.js con los schemas de
// src/app/schemas/*.schema.ts:
//   1. Existencia: cada recurso del front existe en el back, y cada recurso
//      del back tiene su *.schema.ts (la F7-4 ya no existe: alta de módulo =
//      1 archivo por lado).
//   1b. Registro: cada *.schema.ts del disco está importado en
//      src/app/schemas/registry.ts y viceversa. El catálogo NO es automático
//      (import.meta.glob no transforma en esbuild: ver plan, Fase 4 / D3), así
//      que una alta olvidada en registry.ts = recurso invisible en el menú.
//      Este check la convierte en rojo.
//   2. Ruta: los endpoints del front son la ruta efectiva del back
//      (route || /<scope>/<id>), con {key} en las operaciones con clave.
//   3. kind idéntico (collection/singleton).
//   4. Por cada campo que declara el front: existe en el back y required +
//      validators (minLength, maxLength, pattern, min, max, unique) coinciden.
//   5. Campos required del back ausentes en el front = rojo (el form no
//      podría crear el registro); los opcionales ausentes = aviso.
//   6. (R1.6) `enum` del back ↔ `options[].value` del front, resolviendo
//      tanto el array literal como la referencia con nombre a SHEET_ENUMS.
//   7. (R1.6) `default` ↔ `default`.
//   8. (R1.6) listProjection/pick (back) ⊇ listColumns (front).
//   9. (R1.6) postCreate.summaryFields y detail.headerFields apuntan a
//      campos que el front declara.
//  10. (R2.11) auth.md §5.1: las claves de `authSchema.loginFields` son
//      exactamente el `input` de `/auth/login` (y al revés), y
//      `rememberMe` es `false` — D10-3 negó `localStorage` (§9.3), así que
//      un `true` prometería un storage que nadie usa.
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

// Un SOLO cargador para los dos consumidores de Node (R1.5): el mismo que
// usan los tests y que, en GAS, reproduce el filePushOrder de clasp. Al
// evaluar el árbol `api/` completo incluye `schema/validate-registry.js`,
// cuyo assert corre al cargar igual que en producción.
// Import DINÁMICO y posterior al filtro: un import estático se liga antes
// de que corra una sola línea de este fichero, y el aviso de tipo de módulo
// saldría igualmente.
const { loadBackend: loadFullBackend } = await import('../api/__tests__/_harness.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Validators comparables en ambos lados (D2). El resto (minWords…) es solo UX front. */
const VALIDATORS = ['minLength', 'maxLength', 'pattern', 'min', 'max', 'unique'];

const rojos = [];
const avisos = [];
const rojo = (m) => rojos.push(m);
const aviso = (m) => avisos.push(m);

/**
 * Back: resources con auto-registro (REGISTRY.resources.<id> = {…}).
 *
 * Devuelve el REGISTRY COMPLETO (no sólo resources): los checks de R1.6
 * necesitan `enums.sheetEnums` para resolver un `enum: 'availability'`.
 *
 * Delega en `_harness` (R1.5): el mismo cargador que los tests de Node.
 * Evaluar el árbol completo es lo que hace correr el assert de
 * `schema/validate-registry.js` acá, con idéntico código que en GAS.
 */
function loadBackend() {
  try {
    return loadFullBackend();
  } catch (err) {
    // El meta-schema falló al cargar: es el rojo más grave y no tiene
    // sentido seguir comparando contra un registro que no existe.
    console.log(`✗ ROJO: meta-schema — ${err.message}`);
    console.log('✗ ROJO: contract check — el registro de recursos no cargó');
    process.exit(1);
  }
}

/** Schemas del front que no son recursos (R2.11). */
const NO_ES_RECURSO = new Set(['auth']);

/** Front: importa los *.schema.ts con el type stripping nativo de Node. */
async function loadFrontend() {
  const dir = path.join(ROOT, 'src', 'app', 'schemas');
  const schemas = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.schema.ts')) continue;
    // Excepción deliberada (R2.11): `auth.schema.ts` es la pantalla de
    // login — un schema del front, pero NO un recurso: no tiene `id` ni
    // `fields` y no existe en api/schema/resources/. Su contrato se valida
    // en el check 10, con reglas distintas.
    if (NO_ES_RECURSO.has(file.slice(0, -'.schema.ts'.length))) continue;
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

  // ── R1.6 · contrato ampliado ─────────────────────────────────────────────

  // 6. enum (back) ↔ options[].value (front).
  //    `enum` en el back tiene DOS formas: array literal, o el NOMBRE de una
  //    lista en REGISTRY.enums.sheetEnums (SHEET_ENUMS). El front siempre
  //    los pone inline, así que hay que resolver antes de comparar.
  for (const [p, bf] of backFields) {
    if (bf.enum === undefined) continue;
    let valores;
    if (Array.isArray(bf.enum)) {
      valores = bf.enum;
    } else {
      valores = REGISTRY.enums?.sheetEnums?.[bf.enum];
      if (valores === undefined) {
        rojo(`${id}.${p}: enum con nombre '${bf.enum}' no existe en REGISTRY.enums.sheetEnums`);
        continue;
      }
    }
    const ff = frontFields.get(p);
    if (ff === undefined) continue; // ya lo cubre el check 4 de existencia
    const opciones = (ff.options ?? []).map((o) => o.value);
    if (opciones.length === 0) continue; // sin opciones el control no es un select
    const faltaEnFront = valores.filter((v) => !opciones.includes(v));
    const sobraEnFront = opciones.filter((v) => !valores.includes(v));
    if (faltaEnFront.length > 0) {
      rojo(`${id}.${p}: enum del back ausente en options del front → ${faltaEnFront.join(', ')}`);
    }
    if (sobraEnFront.length > 0) {
      rojo(
        `${id}.${p}: options del front ausente en el enum del back → ${sobraEnFront.join(', ')}`,
      );
    }
  }

  // 7. default ↔ default.
  for (const [p, bf] of backFields) {
    const ff = frontFields.get(p);
    if (ff === undefined) continue;
    if (bf.default !== ff.default) {
      rojo(
        `${id}.${p}: default back=${JSON.stringify(bf.default)} ` +
          `front=${JSON.stringify(ff.default)}`,
      );
    }
  }

  // 8. listProjection (back) ⊇ listColumns (front) — cierra R6.
  //    Lo que el back SIRVE en el listado es `operations.list.shape.pick`
  //    si está declarado, y si no, `listProjection` (F5-2: sin pick ⇒
  //    fallback). Comparar contra listProjection a secas sería mentir.
  const servidoEnListado =
    back.operations?.list?.shape?.pick ??
    (Array.isArray(back.listProjection) ? back.listProjection : []);
  for (const col of front.listColumns ?? []) {
    if (!servidoEnListado.includes(col.key)) {
      rojo(
        `${id}: listColumns '${col.key}' no lo sirve el back ` +
          '(ni en operations.list.shape.pick ni en listProjection)',
      );
    }
  }

  // 9. postCreate.summaryFields y detail.headerFields ⊇ campos declarados.
  //    Son declaraciones SOLO del front, pero apuntan a campos del propio
  //    front: un nombre colgado cae en runtime al pintar el resumen.
  const referencias = [
    ...(front.detail?.headerFields ?? []).map((k) => ['detail.headerFields', k]),
    ...(front.postCreate?.summaryFields ?? []).map((k) => ['postCreate.summaryFields', k]),
  ];
  for (const [donde, k] of referencias) {
    if (!frontFields.has(k)) {
      rojo(`${id}: ${donde} referencia '${k}', que no es un campo del front`);
    }
  }
}

/**
 * Disco ↔ registry: el catálogo es explícito (imports en registry.ts), así
 * que un *.schema.ts sin importar = recurso que no aparece en el menú ni en
 * las rutas. Se lee como texto: registry.ts no es importable en Node (sus
 * imports van sin extensión, `./categories.schema`).
 */
function checkRegistry() {
  const dir = path.join(ROOT, 'src', 'app', 'schemas');
  const registryFile = path.join(dir, 'registry.ts');
  const code = readFileSync(registryFile, 'utf8');

  const importados = new Set();
  for (const m of code.matchAll(/from\s+'\.\/([a-z0-9-]+)\.schema'/g)) {
    importados.add(m[1]);
  }

  const enDisco = readdirSync(dir)
    .filter((f) => f.endsWith('.schema.ts'))
    .map((f) => f.slice(0, -'.schema.ts'.length));

  for (const id of enDisco) {
    if (!importados.has(id)) {
      rojo(
        `registry.ts: falta importar './${id}.schema' — el archivo existe pero ` +
          'el recurso no entra al catálogo (invisible en menú y rutas)',
      );
    }
  }
  for (const id of importados) {
    if (!enDisco.includes(id)) {
      rojo(`registry.ts: importa './${id}.schema' pero src/app/schemas/${id}.schema.ts no existe`);
    }
  }
}

checkRegistry();
const REGISTRY = loadBackend();
const backend = REGISTRY.resources;
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

// ── Check 10: auth.md §5.1 ↔ input de /auth/login (R2.11) ────────────────
{
  const mod = await import(
    pathToFileURL(path.join(ROOT, 'src', 'app', 'schemas', 'auth.schema.ts')).href
  );
  const auth = mod.authSchema;
  if (auth === undefined) {
    rojo('auth.schema.ts: no exporta `authSchema` (login declarado que nadie puede leer)');
  } else {
    if (auth.rememberMe !== false) {
      rojo(
        'authSchema.rememberMe debe ser false — D10-3 negó localStorage (§9.3) y el ' +
          'token vive en sessionStorage: un true promete una sesión que no se sostiene',
      );
    }
    if (!Array.isArray(auth.providers) || auth.providers.length === 0) {
      rojo('authSchema.providers vacío — §9.1 eligió autenticación por contraseña');
    }

    const endpoint = REGISTRY.endpoints?.authLogin;
    const backKeys = new Set(Object.keys(endpoint?.input ?? {}));
    const frontKeys = new Set((auth.loginFields ?? []).map((f) => f.key));

    if (backKeys.size === 0) {
      rojo('el back no declara `input` en /auth/login — el login no tiene qué pedir');
    }
    for (const key of frontKeys) {
      if (!backKeys.has(key)) {
        rojo(
          `authSchema.loginFields: '${key}' no existe en el input de /auth/login — ` +
            'el formulario manda un campo que el back no espera',
        );
      }
    }
    for (const key of backKeys) {
      if (!frontKeys.has(key)) {
        rojo(
          `input de /auth/login: '${key}' no está en authSchema.loginFields — ` +
            'el back pide un campo que la pantalla no pinta',
        );
      }
    }
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
