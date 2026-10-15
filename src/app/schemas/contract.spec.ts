import { describe, expect, it } from 'vitest';

import { actionTypes } from '../actions/action-registry';
import type { ResourceAction, ResourceSchema } from '@tinya-code/gas-admin-ui';
import { schemas } from './registry';

/**
 * R1.7 / D17 — contrato runtime ↔ tipos del front.
 *
 * **Qué NO cubre esto, y por qué:** `FieldSchema`, `ListColumnFormat` y
 * `ResourceAction` son uniones de TypeScript, así que un `type`/`format`/
 * `action` inventado ya rompe `npm run build`. No hace falta duplicarlo.
 *
 * **Qué cubre:** el catálogo y el recorrido de acciones — una acción que
 * declara un schema tiene que existir en el registro (R3.10) y ser ejecutable
 * de verdad por `ActionService` (R3.9/R3.11), no degradarse a «próximamente».
 * La lista válida se toma **del registro**, así que dar de baja un descriptor
 * pone este test rojo en cuanto algún schema lo declare.
 *
 * **El recorrido de `field.type` se mudó** a
 * `src/app/core/registry/contract.spec.ts` (R3.7), que recorre campos y
 * widgets contra el registro de render en un solo sitio. Allí se explica
 * además por qué `column.format` y `action.type` todavía no tienen
 * descriptor y qué test los obligará a tenerlo.
 *
 * Ruta corregida respecto al plan: el registro real es
 * `src/app/schemas/registry.ts` y `configSchema` tampoco existe — esa
 * cláusula de R1.7 se descartó.
 */

function todasLasAcciones(schema: ResourceSchema): { donde: string; type: string }[] {
  const fmt = (a: ResourceAction): string => a.type ?? 'navigate';
  return [
    ...(schema.actions ?? []).map((a) => ({ donde: 'actions', type: fmt(a) })),
    ...(schema.postCreate?.actions ?? []).map((a) => ({
      donde: 'postCreate.actions',
      type: fmt(a),
    })),
  ];
}

describe('R1.7 — contrato de tipos del front', () => {
  it('el catálogo expone al menos un schema', () => {
    expect(schemas.length).toBeGreaterThan(0);
  });

  it('toda acción declarada es una que el registro sabe ejecutar', () => {
    const ejecutables = actionTypes();
    const infractores: string[] = [];
    for (const schema of schemas) {
      for (const { donde, type } of todasLasAcciones(schema)) {
        if (!ejecutables.includes(type)) {
          infractores.push(`${schema.id}.${donde}: type '${type}'`);
        }
      }
    }
    expect(infractores).toEqual([]);
  });
});
