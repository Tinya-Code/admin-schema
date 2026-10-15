import { describe, expect, it } from 'vitest';

import { actionType, actionTypes, getAction } from '@tinya-code/gas-admin-ui';
import type { ResourceAction } from '@tinya-code/gas-admin-ui';
import { schemas } from '../schemas/registry';
import '../schemas/seed-catalog';

/**
 * R3.10 — exhaustividad del registro de acciones.
 *
 * Mismo molde que `core/registry/contract.spec.ts` (R3.7), aplicado al otro
 * registro:
 *
 *  1. **Declarado en un schema** → `action.type` recorrido contra
 *     `getAction`. Cubre los tres sitios donde el modelo admite acciones
 *     (`schema.actions`, `detail.actions`, `postCreate.actions`).
 *  2. **De la unión de tipos** → `TIPOS_ACCION`, `satisfies` sobre
 *     `NonNullable<ResourceAction['type']>`, uno a uno contra el registro.
 *     Cubre el tipo que está en la unión y **todavía no declara ningún
 *     schema**: hoy `navigate` y `trigger` no los usan, y sin esta
 *     capa dar de baja su descriptor pasaría en verde.
 *
 * El registro falla ruidoso en runtime (R3.9): sin esta prueba, ese fallo
 * sólo aparecería con un schema mal declarado y en la pantalla del operador.
 */

const TIPOS_ACCION = ['copy-share', 'navigate', 'trigger'] as const satisfies readonly NonNullable<
  ResourceAction['type']
>[];

/** Todas las acciones que declara el catálogo de schemas, sea cual sea su sitio. */
function todasLasAcciones(): { origen: string; action: ResourceAction }[] {
  const resultado: { origen: string; action: ResourceAction }[] = [];
  for (const schema of schemas) {
    const sitios: [string, ResourceAction[] | undefined][] = [
      ['actions', schema.actions],
      ['detail.actions', schema.detail?.actions],
      ['postCreate.actions', schema.postCreate?.actions],
    ];
    for (const [sitio, lista] of sitios) {
      for (const action of lista ?? []) {
        resultado.push({ origen: `${schema.id}.${sitio}`, action });
      }
    }
  }
  return resultado;
}

describe('registro de acciones', () => {
  it('hay descriptores registrados (el recorrido no es vacío)', () => {
    expect(actionTypes().length).toBeGreaterThan(0);
  });

  it('hay acciones declaradas en los schemas (el recorrido de schemas no es vacío)', () => {
    expect(todasLasAcciones().length).toBeGreaterThan(0);
  });

  it('todo tipo de la unión de acciones tiene descriptor', () => {
    for (const type of TIPOS_ACCION) {
      expect(getAction(type), `falta el descriptor de «${type}»`).toBeDefined();
    }
  });

  it('el registro no contiene tipos que la unión no declare', () => {
    const union = TIPOS_ACCION as readonly string[];
    expect(actionTypes().filter((type) => !union.includes(type))).toEqual([]);
  });

  it('todo action.type de todo schema lo sabe ejecutar el motor', () => {
    for (const { origen, action } of todasLasAcciones()) {
      expect(getAction(actionType(action)), `${origen} → «${action.label}»`).toBeDefined();
    }
  });
});
