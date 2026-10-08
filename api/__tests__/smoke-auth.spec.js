// api/__tests__/smoke-auth — el cliente de humo (scripts/smoke-auth.mjs).
//
// Vive en `api/__tests__/` porque el runner sólo incluye `api/**/*.spec.js`
// (ver vitest.config.ts): acá es donde ya se busca, y no se cambia la
// composición de un gate para acomodar un fichero.
//
// Qué cubre, y por qué importa: `decodeExp`/`isFresh` son la ÚNICA red que
// detecta que el formato del token cambió. Fallan en silencio — el humo
// sigue pasando porque se reloguea en cada corrida — así que la única
// señal de que la caché murió es este spec.
//
// El token real NO es un JWT: `issueToken_` (core/11-auth) emite
// `base64url(JSON) + '.' + firma` — 2 partes — y `exp` va en MILISEGUNDOS
// porque es lo que se firma. Adivinar «3 partes, segundos» hizo que
// `isFresh` devolviera siempre false (D23).

import { describe, expect, it } from 'vitest';

import { decodeExp, isFresh } from '../../scripts/smoke-auth.mjs';

const AHORA = 1_700_000_000; // segundos — el reloj que isFresh recibe por parámetro

/** Token con el formato del back: cuerpo base64url + firma. */
function tokenDe(payload, partes = 2) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return partes === 2 ? `${body}.firma` : `hdr.${body}.firma`;
}

describe('decodeExp', () => {
  it('2 partes (formato del back): exp en ms se devuelve en SEGUNDOS', () => {
    const t = tokenDe({ sub: 'u1', exp: (AHORA + 3600) * 1000 });
    expect(t.split('.')).toHaveLength(2);
    expect(decodeExp(t)).toBe(AHORA + 3600);
  });

  it('3 partes (JWT): exp ya está en segundos y no se vuelve a dividir', () => {
    expect(decodeExp(tokenDe({ exp: AHORA + 3600 }, 3))).toBe(AHORA + 3600);
  });

  it('basura ⇒ null (nunca un número inventado)', () => {
    expect(decodeExp(undefined)).toBe(null);
    expect(decodeExp(null)).toBe(null);
    expect(decodeExp('no-tiene-puntos')).toBe(null); // 1 parte
    expect(decodeExp('a.b.c.d')).toBe(null); // 4 partes
    expect(decodeExp('abc.def')).toBe(null); // 2 partes pero no es JSON
    expect(decodeExp(tokenDe({ sub: 'u1' }))).toBe(null); // sin exp
    expect(decodeExp(tokenDe({ exp: 'no-numerico' }))).toBe(null);
  });
});

describe('isFresh', () => {
  it('vigente ⇒ true: la caché SÍ se reusa', () => {
    expect(isFresh(tokenDe({ exp: (AHORA + 3600) * 1000 }), AHORA)).toBe(true);
  });

  it('vencido ⇒ false', () => {
    expect(isFresh(tokenDe({ exp: (AHORA - 60) * 1000 }), AHORA)).toBe(false);
  });

  it('dentro del margen de 5 min ⇒ false: se reloguea ANTES de que caduque', () => {
    const margenS = 5 * 60;
    expect(isFresh(tokenDe({ exp: (AHORA + margenS - 30) * 1000 }), AHORA)).toBe(false);
    expect(isFresh(tokenDe({ exp: (AHORA + margenS + 30) * 1000 }), AHORA)).toBe(true);
  });

  it('token ilegible ⇒ false: jamás se reusa algo que no se pudo leer', () => {
    expect(isFresh('abc.def', AHORA)).toBe(false);
    expect(isFresh('', AHORA)).toBe(false);
  });
});
