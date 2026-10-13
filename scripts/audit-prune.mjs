#!/usr/bin/env node
// scripts/audit-prune.mjs — poda de `_audit_log` por `retention` (R9.5.1).
//
//   npm run audit:prune                    → DRY-RUN: sólo cuenta
//   npm run audit:prune -- --apply         → borra lo vencido
//   npm run audit:prune -- --resource orders --apply
//
// La retención se declara en el schema (`policies.audit.retention`); este
// script la HACE efectiva. No corre en CI ni en ningún request (O3): es una
// operación de mantenimiento, invocada a mano o por un cron del
// despliegue — igual que sheet-drift-check corre sólo cuando se le pide.
//
// Transporte: la MISMA receta de curl que scripts/sheet-drift-check.mjs, por
// la única vía probada contra el webapp de GAS. No se usa fetch: el 302 de
// GAS cambia el método en el segundo salto y `-X POST` lo rompe.
//
// Política de salida:
//   ROJO (exit 1)  transporte caído, endpoint en `ok: false` (p. ej. la
//                  hoja `_audit_log` no existe) o recurso mal declarado.
//   VERDE (exit 0) todo lo demás — incluido «hay filas vencidas» en
//                  dry-run: contar no es un error, es el aviso para volver
//                  con `--apply`.
//
// Credenciales: api/.gas-smoke.env (GAS_URL, GAS_EMAIL, GAS_PASSWORD) —
// GITIGNORED. El JWT se cachea y renueva solo: D23.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSmokeToken, provisionInteractive } from './smoke-auth.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, 'api', '.gas-smoke.env');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const resourceIndex = args.indexOf('--resource');
const resource = resourceIndex !== -1 ? args[resourceIndex + 1] : undefined;

if (resourceIndex !== -1 && !resource) {
  console.error('✗ ROJO: --resource necesita un id (p. ej. --resource orders)');
  process.exit(1);
}
if (resource && resource.startsWith('--')) {
  console.error(`✗ ROJO: --resource no reconoce la opción "${resource}"`);
  process.exit(1);
}

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
  console.log('· AVISO: poda de auditoría omitida — falta GAS_URL en api/.gas-smoke.env');
  console.log('  (sólo se puede podar contra una hoja real; no es un skip silencioso)');
  process.exit(0);
}

let creds;
try {
  creds = await provisionInteractive(env);
} catch (err) {
  console.error(`✗ ROJO: no se pudo aprovisionar la sesión — ${err.message}`);
  process.exit(1);
}
if (!creds) {
  console.log(
    '· AVISO: poda de auditoría omitida — faltan GAS_EMAIL/GAS_PASSWORD en api/.gas-smoke.env',
  );
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

const payload = { apply };
if (resource) payload.resource = resource;

const callOnce = (tok) => {
  const body = JSON.stringify({
    token: tok,
    method: 'POST',
    path: '/admin/audit-prune',
    payload,
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

// Sesión caída en caliente: renueva UNA vez y reintenta (D23).
if (report && report.error && report.error.status === 401) {
  try {
    token = getSmokeToken({ force: true, env: creds });
  } catch (err) {
    console.error(`✗ ROJO: la sesión fue rechazada y no se pudo renovar — ${err.message}`);
    process.exit(1);
  }
  report = callOnce(token);
}

if (report && report.error) {
  console.error(`✗ ROJO: el endpoint devolvió error — ${report.error.message || 'sin detalle'}`);
  process.exit(1);
}
if (!report || report.ok === undefined) {
  console.error('✗ ROJO: respuesta sin forma de reporte de poda');
  console.error(JSON.stringify(report).slice(0, 500));
  process.exit(1);
}

const { ok, dryRun, checked, stale, removed, resources = [], reason } = report;

console.log('── audit-prune: _audit_log por policies.audit.retention');
console.log(
  `  · recursos con retention: ${resources.length > 0 ? resources.join(', ') : 'ninguno'}`,
);
console.log(`  · filas revisadas: ${checked} · vencidas: ${stale}`);

if (!ok) {
  console.error(`✗ ROJO: ${reason || 'la poda no pudo ejecutarse'}`);
  process.exit(1);
}

if (dryRun) {
  if (stale > 0) {
    console.log(`  · ${stale} fila(s) vencida(s) — correr con --apply para borrarlas`);
  } else {
    console.log('✓ VERDE: nada vencido');
  }
} else {
  console.log(`  · borradas: ${removed}`);
  console.log(
    removed > 0 ? '✓ VERDE: poda aplicada (queda fila de auditoría)' : '✓ VERDE: nada que borrar',
  );
}
process.exit(0);
