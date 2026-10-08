#!/usr/bin/env node
// scripts/smoke-auth.mjs — credenciales de los scripts de humo (D23).
//
//   npm run smoke:login              # aprovisiona credenciales (una sola vez)
//   node scripts/smoke-auth.mjs token # token válido, renovado solo si caducó
//
// ── Por qué existe (D23, doc/plan-refactor-motor.md §4) ───────────────────
//
// La Fase 2 retiró `ADMIN_TOKEN_HASH` (D21-C) y fija `TOKEN_TTL_HOURS: 6`
// (auth.md §4.2). Con eso, `GAS_TOKEN` dejó de ser una credencial fija para
// ser un JWT que caduca cada 6 horas: `api:drift` y `api-regression.sh` se
// romperían a esa cadencia y nada los renovaba.
//
// La solución es que los scripts entren por LA MISMA puerta que el frontend
// — `POST /auth/login` — y cacheen el JWT en `GAS_TOKEN`:
//
//   · aprovisionamiento: UNA vez (`npm run smoke:login`, prompt sin eco, o
//     el primer `api:drift` en una terminal);
//   · después: `getSmokeToken()` lo reutiliza mientras `exp` siga a más de
//     5 minutos y lo renueva solo. Cero pasos manuales.
//
// Cabe holgadamente en `5/15min` (R2.13): como el JWT vive 6 h hay 1 login
// cada 6 h por cuenta, muy lejos de los 5 fallos que abren la ventana de
// bloqueo — y si la contraseña cambia, el error lo dice explícitamente.
//
// ── Dónde viven las credenciales ──────────────────────────────────────────
//
// `api/.gas-smoke.env` — GITIGNORED (.gitignore:53) y `0600`. Mismo patrón
// que `.env`: secreto local que no viaja al repo. Plantilla documentada en
// `api/.gas-smoke.env.example`.
//
// El transporte es `curl`, igual que `api-regression.sh` y
// `sheet-drift-check.mjs`: es la única vía probada contra el webapp de GAS
// (el 302 de GAS cambia el método en el segundo salto y `fetch` lo rompe).

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, 'api', '.gas-smoke.env');

// Renovar con margen: una llamada de humo dura segundos, pero no se juega
// a cruzar la frontera de `exp` a mitad de una petición.
const EXPIRY_MARGIN_S = 5 * 60;

export class SmokeAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SmokeAuthError';
    this.code = code;
  }
}

// ── Env ───────────────────────────────────────────────────────────────────

/** KEY=VALUE plano: comentarios y líneas vacías se conservan tal cual. */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

export function readEnv(path = ENV_FILE) {
  if (!existsSync(path)) return {};
  return parseEnv(readFileSync(path, 'utf8'));
}

/**
 * Fusiona `updates` en el fichero SIN reescribirlo entero: sólo cambia las
 * claves pedidas, deja comentarios y orden intactos y vuelve a bajarlo a
 * 0600 por si se creó nuevo.
 */
export function writeEnv(updates, path = ENV_FILE) {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const pending = { ...updates };
  const out = [];
  for (const line of existing.split(/\r?\n/)) {
    const t = line.trim();
    const eq = t.indexOf('=');
    if (t !== '' && !t.startsWith('#') && eq > 0) {
      const key = t.slice(0, eq).trim();
      if (Object.prototype.hasOwnProperty.call(pending, key)) {
        out.push(`${key}=${pending[key]}`);
        delete pending[key];
        continue;
      }
    }
    out.push(line);
  }
  for (const [k, v] of Object.entries(pending)) out.push(`${k}=${v}`);
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  writeFileSync(path, out.join('\n') + '\n');
  chmodSync(path, 0o600);
  return { ...parseEnv(out.join('\n')) };
}

// ── JWT ───────────────────────────────────────────────────────────────────

/**
 * `exp` del payload en segundos, o `null` si no es un JWT legible.
 *
 * Se DECODIFICA, no se verifica: el token vive en un fichero local que
 * escribimos nosotros — la verificación de firma ya la hace el backend en
 * `verifySession_`, y duplicarla acá sólo añadiría una segunda regla que
 * se le contradice en cuanto cambie.
 */
// El token del back NO es un JWT de 3 partes: `issueToken_` emite
// `base64url(JSON) + '.' + firma` (2 partes) y `exp` va en MILISEGUNDOS
// (`Date.now()`), que es lo que se firma. Adivinar el formato hizo que
// `isFresh` devolviera SIEMPRE false y el humo se relogueara en cada corrida
// en vez de reusar la caché (D23).
//
// Devuelve `exp` en SEGUNDOS: es lo que esperan `isFresh` y el aviso de
// caducidad del CLI.
export function decodeExp(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 && parts.length !== 3) return null;
  // 3 partes ⇒ JWT clásico: payload en parts[1], `exp` en segundos.
  // 2 partes ⇒ formato propio del back: cuerpo en parts[0], `exp` en ms.
  const expInMs = parts.length === 2;
  const body = expInMs ? parts[0] : parts[1];
  try {
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    if (typeof payload.exp !== 'number') return null;
    return expInMs ? Math.floor(payload.exp / 1000) : payload.exp;
  } catch {
    return null;
  }
}

export function isFresh(jwt, nowSec = Math.floor(Date.now() / 1000)) {
  const exp = decodeExp(jwt);
  return exp !== null && exp - EXPIRY_MARGIN_S > nowSec;
}

// ── Transporte ────────────────────────────────────────────────────────────

/** Misma receta de curl que el resto de scripts de humo (ver cabecera). */
function postEnvelope(env, method, path, payload, token = '') {
  const body = JSON.stringify({ token, method, path, payload });
  const curl = spawnSync(
    'curl',
    [
      '-sS',
      '-L',
      '--max-time',
      '60',
      '-H',
      'Content-Type: text/plain',
      '--data',
      body,
      env.GAS_URL,
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (curl.error || curl.status !== 0) {
    throw new SmokeAuthError(
      'network',
      `curl falló: ${(curl.error && curl.error.message) || curl.stderr}`,
    );
  }
  try {
    return JSON.parse(curl.stdout);
  } catch {
    throw new SmokeAuthError('network', `la respuesta no es JSON: ${curl.stdout.slice(0, 200)}`);
  }
}

// ── Sesión ────────────────────────────────────────────────────────────────

/** POST /auth/login con las credenciales del env → token fresco. */
export function login(env = readEnv()) {
  if (!env.GAS_URL) throw new SmokeAuthError('no_url', 'falta GAS_URL en api/.gas-smoke.env');
  if (!env.GAS_EMAIL || !env.GAS_PASSWORD) {
    throw new SmokeAuthError(
      'missing_credentials',
      'faltan GAS_EMAIL/GAS_PASSWORD en api/.gas-smoke.env — ' +
        'corre `npm run smoke:login` para aprovisionarlos',
    );
  }

  const res = postEnvelope(env, 'POST', '/auth/login', {
    email: env.GAS_EMAIL,
    password: env.GAS_PASSWORD,
  });
  if (res && typeof res.token === 'string' && res.token !== '') return res.token;

  const err = res && res.error;
  if (!err)
    throw new SmokeAuthError(
      'network',
      `respuesta sin token: ${JSON.stringify(res).slice(0, 200)}`,
    );
  if (err.code === 'RATE_LIMITED') {
    throw new SmokeAuthError(
      'rate_limited',
      'RATE_LIMITED: la cuenta superó 5 fallos en 15 minutos (auth.md §4.6). ' +
        'Espera a que pase la ventana antes de reintentar.',
    );
  }
  if (err.status === 401 || err.code === 'AUTH_INVALID') {
    throw new SmokeAuthError(
      'invalid',
      `credenciales inválidas (GAS_EMAIL/GAS_PASSWORD): ${err.message}. ` +
        '⚠ Cada fallo cuenta hacia el bloqueo de 15 minutos.',
    );
  }
  throw new SmokeAuthError('network', `${err.code || err.status}: ${err.message}`);
}

/**
 * Token válido para los scripts de humo.
 *
 * Devuelve el cacheado si `exp` no está cerca; si no, renueva con
 * `GAS_EMAIL`/`GAS_PASSWORD` y lo guarda en `GAS_TOKEN`. `force` ignora el
 * cache (únicamente cuando el backend acaba de rechazarlo — revocación,
 * `token_version` subido).
 *
 * Lanza `SmokeAuthError`; el consumidor decide si es aviso (exit 0) o rojo.
 */
export function getSmokeToken({ force = false, env = readEnv() } = {}) {
  if (!env.GAS_URL) {
    throw new SmokeAuthError('no_url', 'falta GAS_URL en api/.gas-smoke.env');
  }
  if (!force && isFresh(env.GAS_TOKEN)) return env.GAS_TOKEN;

  const token = login(env);
  writeEnv({ GAS_TOKEN: token });
  return token;
}

// ── Aprovisionamiento interactivo ─────────────────────────────────────────

/** Prompt SIN eco para la contraseña (raw mode de stdin). */
function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw === true;
    process.stdout.write(question);
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let out = '';
    const done = (value) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode?.(wasRaw);
      stdin.pause();
      process.stdout.write('\n');
      resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(out);
        if (ch === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') out = out.slice(0, -1);
        else out += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (a) => {
      rl.close();
      resolve(a);
    }),
  );
}

/**
 * Pide credenciales por terminal si faltan y las guarda.
 * Devuelve el env resultante; `null` si no hay terminal (modo CI).
 */
export async function provisionInteractive(env = readEnv()) {
  if (env.GAS_EMAIL && env.GAS_PASSWORD) return env;
  if (!process.stdin.isTTY) return null;
  if (!env.GAS_URL) throw new SmokeAuthError('no_url', 'falta GAS_URL en api/.gas-smoke.env');

  const email = (await ask('  Email del admin: ')).trim();
  const password = await ask('  Contraseña (sin eco): ');
  if (!email || !password) throw new SmokeAuthError('missing_credentials', 'credenciales vacías');
  const merged = writeEnv({ GAS_EMAIL: email, GAS_PASSWORD: password });
  return merged;
}

// ── CLI ───────────────────────────────────────────────────────────────────

const USAGE = 'uso: node scripts/smoke-auth.mjs <login|token>\n';

async function main() {
  const cmd = process.argv[2];

  if (cmd === 'token') {
    const token = getSmokeToken();
    process.stdout.write(token + '\n');
    return;
  }

  if (cmd === 'login') {
    const env = await provisionInteractive();
    if (!env) {
      throw new SmokeAuthError(
        'missing_credentials',
        'no hay terminal para pedir credenciales — define GAS_EMAIL/GAS_PASSWORD en api/.gas-smoke.env',
      );
    }
    const token = getSmokeToken({ force: true, env });
    const exp = decodeExp(token);
    const cuando = exp ? new Date(exp * 1000).toISOString().replace(/\.\d+Z$/, 'Z') : 'desconocida';
    process.stderr.write(`✓ sesión aprovisionada para ${env.GAS_EMAIL} — caduca ${cuando}\n`);
    return;
  }

  process.stderr.write(USAGE);
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`✗ ${err.message}\n`);
    process.exit(1);
  });
}
