// @ts-ignore — `node:fs` no tiene tipos en este proyecto (sin @types/node);
// el runtime de tests corre en Node y el builtin resuelve igual.
import { readFileSync } from 'node:fs';
// @ts-ignore — idem para `node:url`.
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * R9.9 · slice 3 — Guardia arquitectónica sobre el compositor (D2).
 *
 * El host debe ser GENÉRICO: sin imports de hojas, sin strings de dominio y
 * sin `switch` de tipos — cualquier página nueva declarada en un schema se
 * compone sin tocar el compositor. Este test lee el fuente REAL desde disco
 * (no el bundle) y falla si aparece un acoplamiento al dominio.
 */
function fuente(nombre: string): string {
  return readFileSync(fileURLToPath(new URL(nombre, import.meta.url)), 'utf8');
}

const COMPOSITOR = ['composer-host.ts', 'view-slot.ts', 'view-context.ts'];

describe('composer source-scan: el compositor no conoce el dominio', () => {
  it('no importa hojas, páginas ni vistas de dominio', () => {
    for (const nombre of COMPOSITOR) {
      const codigo = fuente(nombre);
      expect(codigo, `${nombre} importa una hoja/página de dominio`).not.toMatch(
        /from ['"](\.\.\/)+(pages|views\/(calendar-view|kanban-view))/,
      );
      expect(codigo, `${nombre} referencia una hoja por import dinámico`).not.toMatch(
        /import\(['"](\.\.\/)+(pages|views\/(calendar-view|kanban-view))/,
      );
      expect(codigo, `${nombre} menciona un tipo de dominio`).not.toMatch(
        /'calendar'|'kanban'|'resource-page'|'form-view'|'detail-view'/,
      );
    }
  });

  it('no contiene un switch de tipos (dispatch exclusivamente por registro)', () => {
    for (const nombre of COMPOSITOR) {
      expect(fuente(nombre), `${nombre} contiene un switch`).not.toMatch(/@?switch\s*\(/);
    }
  });

  it('resuelve hijos sólo vía get(kind, type) del registro, nunca resolve()', () => {
    for (const nombre of ['view-slot.ts']) {
      const codigo = fuente(nombre);
      expect(codigo, `${nombre} usa resolve() (fallback silencioso prohibido)`).not.toMatch(
        /\bresolve\(\s*'view'/,
      );
      expect(codigo, `${nombre} no usa get('view', type)`).toMatch(/get\(\s*'view'\s*,/);
    }
  });
});
