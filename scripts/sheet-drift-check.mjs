#!/usr/bin/env node
// scripts/sheet-drift-check.mjs — sheet-check en Node/despliegue (R1.2, B4).
//
//   npm run api:drift
//
// Compara el schema declarativo con los headers REALES de la hoja de
// producción y clasifica el resultado. Es la mitad de B4 que faltaba: hasta
// ahora `setupDrift()` sólo era invocable a mano desde el editor de Apps
// Script (PLAN-MEJORAS.md:692), así que toda evolución de schema exigía un
// paso manual invisible que nada verificaba — exactamente lo que dejó
// perder `pin` en silencio (hallazgo R7, doc/pedidos-rectificacion.md:230).
//
// Transporte: la MISMA receta de curl que scripts/api-regression.sh, por la
// única vía probada contra el webapp de GAS. No se usa fetch: el 302 de GAS
// cambia el método en el segundo salto y `-X POST` lo rompe.
//
// Política de salida (O3: chequeo pesado en despliegue/CI, no por request):
//   ROJO (exit 1)  blocked · createdSheets · added
//                   → el schema pide algo que la hoja no tiene. Cualquier
//                     escritura falla con 500 (R1.1) hasta correr setupDrift.
//   AMARILLO (exit 0) orphans · schemaVersionChanged
//                   → sólo informativo: §14 dice que la columna no se borra,
//                     así que tras un renombre el huérfano es esperado.
//   SIN CREDENCIALES (exit 0 + aviso) no se puede comparar contra una hoja
//                   real. Los otros 5 gates siguen cubriendo lo offline.
//
// Credenciales: api/.gas-smoke.env (GAS_URL, GAS_EMAIL, GAS_PASSWORD) —
// GITIGNORED. El JWT (`GAS_TOKEN`) se cachea y renueva solo: D23.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSmokeToken, provisionInteractive } from './smoke-auth.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, 'api', '.gas-smoke.env');

/** KEY=VALUE plano: comentarios y líneas vacías se ignoran. */
function loadEnv() {
  const out = { ...process.env };
  if (!existsSync(ENV_FILE)) return out;
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const env = loadEnv();
const { GAS_URL } = env;

if (!GAS_URL) {
  console.log('· AVISO: sheet-check omitido — falta GAS_URL en api/.gas-smoke.env');
  console.log('  (sólo se puede comparar contra una hoja real; no es un skip silencioso)');
  process.exit(0);
}

// D23 (scripts/smoke-auth.mjs): el token ya NO es fijo — la Fase 2 retiró
// ADMIN_TOKEN_HASH y fija TOKEN_TTL_HOURS: 6, así que `GAS_TOKEN` caducaba
// cada 6 horas y nada lo renovaba. Ahora se pide por la misma puerta que el
// frontend (`POST /auth/login`) y se cachea en el propio fichero.
let creds;
try {
  creds = await provisionInteractive(env);
} catch (err) {
  console.error(`✗ ROJO: no se pudo aprovisionar la sesión — ${err.message}`);
  process.exit(1);
}
if (!creds) {
  console.log('· AVISO: sheet-check omitido — faltan GAS_EMAIL/GAS_PASSWORD en api/.gas-smoke.env');
  console.log('  (corre `npm run smoke:login` para aprovisionarlos; no es un skip silencioso)');
  process.exit(0);
}

let token;
try {
  token = getSmokeToken({ env: creds });
} catch (err) {
  console.error(`✗ ROJO: no se pudo obtener sesión — ${err.message}`);
  process.exit(1);
}

// Misma receta de curl que scripts/api-regression.sh, por la única vía
// probada contra el webapp de GAS (el 302 cambia el método en el 2.º salto).
const callOnce = (tok) => {
  const body = JSON.stringify({
    token: tok,
    method: 'GET',
    path: '/admin/sheet-drift',
    payload: {},
  });
  const curl = spawnSync(
    'curl',
    ['-sS', '-L', '--max-time', '60', '-H', 'Content-Type: text/plain', '--data', body, GAS_URL],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (curl.error || curl.status !== 0) {
    console.error(`✗ ROJO: curl falló: ${(curl.error && curl.error.message) || curl.stderr}`);
    process.exit(1);
  }
  try {
    return JSON.parse(curl.stdout);
  } catch {
    console.error('✗ ROJO: la respuesta no es JSON');
    console.error(curl.stdout.slice(0, 500));
    process.exit(1);
  }
};

let report = callOnce(token);

// Sesión caída en caliente (revocación, `token_version` subido): renueva UNA
// vez y reintenta. «Automático» significa que eso no exige mano de obra.
if (report && report.error && report.error.status === 401) {
  try {
    token = getSmokeToken({ force: true, env: creds });
  } catch (err) {
    console.error(`✗ ROJO: la sesión fue rechazada y no se pudo renovar — ${err.message}`);
    process.exit(1);
  }
  report = callOnce(token);
}

// El webapp devuelve HTTP 200 siempre: el estado viaja dentro del JSON.
if (report && report.error) {
  console.error(`✗ ROJO: el endpoint devolvió error — ${report.error.message || 'sin detalle'}`);
  process.exit(1);
}
if (!report || report.ok === undefined) {
  console.error('✗ ROJO: respuesta sin forma de reporte de drift');
  console.error(JSON.stringify(report).slice(0, 500));
  process.exit(1);
}

const { createdSheets = [], added = [], orphans = [], blocked = [] } = report;

console.log('── sheet-check: schema ⇄ headers reales (setupDrift dryRun)');

let rojo = 0;
const rojo_ = (m) => {
  console.log(`  ✗ ${m}`);
  rojo++;
};

for (const name of createdSheets) rojo_(`falta la hoja entera: ${name}`);
for (const col of added) rojo_(`falta la columna: ${col}`);
for (const c of blocked) {
  rojo_(`conflicto de tipo en ${c.sheet}.${c.column} fila ${c.row}: ${c.value}`);
}

for (const col of orphans) console.log(`  · huérfana (sólo informativo, §14): ${col}`);
if (report.schemaVersionChanged) {
  console.log(`  · SCHEMA_VERSION cambió → ${report.schemaVersion}`);
}

if (rojo > 0) {
  console.log(`✗ ROJO: ${rojo} hallazgo(s) — correr setupDrift desde el editor`);
  process.exit(1);
}

console.log(
  orphans.length > 0
    ? `✓ VERDE: sin faltantes (${orphans.length} huérfana(s) esperadas tras un renombre)`
    : '✓ VERDE: sin faltantes ni sobrantes',
);
process.exit(0);
