import { describe, expect, it } from 'vitest';

import type { FieldSchema, ResourceAction, ResourceSchema } from '../core/models/schema.model';
import { isSupportedFieldType } from '../fields/field-host/field-host';
import { schemas } from './registry';

/**
 * R1.7 / D17 — contrato runtime ↔ tipos del front.
 *
 * **Qué NO cubre esto, y por qué:** `FieldSchema`, `ListColumnFormat` y
 * `ResourceAction` son uniones de TypeScript, así que un `type`/`format`/
 * `action` inventado ya rompe `npm run build`. No hace falta duplicarlo.
 *
 * **Qué SÍ cubre, y es el hueco real:** que un tipo esté bien escrito en
 * TS y A LA VEZ fuera del registro de runtime. Ahí `tsc` pasa y la UI no
 * pinta nada — el `@switch` de `field-host` no tiene `@default` y el gate
 * `isSupportedFieldType()` simplemente se lo salta.
 *
 * El viaje inverso (tipo de la unión que falta en el registro) vive en
 * `field-host.ts` como tripwire de tipos, evaluado por `npm run build` y
 * también por `npm test`: el plugin `angular-compiler` type-chequea los
 * specs, así que un `type: 'txt'` revienta con TS2820 antes de llegar a
 * ningún `it`. Por eso este archivo puede confiar en que `f.type` es un
 * miembro de `FieldSchema` y el trabajo suyo es el recorrido.
 *
 * Ruta corregida respecto al plan: el registro real es
 * `src/app/schemas/registry.ts` (`src/app/core/registry/` no existe) y
 * `configSchema` tampoco existe — esa cláusula de R1.7 se descartó.
 */

type CampoConSub = FieldSchema & {
  fields?: FieldSchema[];
  itemFields?: FieldSchema[];
  extraColumns?: FieldSchema[];
};

/** Aplana todos los campos de un schema, anidados incluidos. */
function todosLosCampos(schema: ResourceSchema): { path: string; type: string }[] {
  const out: { path: string; type: string }[] = [];
  const rec = (fields: readonly FieldSchema[] | undefined, prefix: string): void => {
    for (const raw of fields ?? []) {
      const f = raw as CampoConSub;
      const path = prefix === '' ? f.key : `${prefix}.${f.key}`;
      out.push({ path, type: f.type });
      rec(f.fields, path);
      rec(f.itemFields, path);
      rec(f.extraColumns, path);
    }
  };
  rec(schema.fields, '');
  return out;
}

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

/**
 * Tipos de acción que `ListView.runAction` **ejecuta de verdad** (no que
 * sólo degrada a «estará disponible próximamente»).
 *
 * `trigger-endpoint` está declarado en `ResourceAction` pero ningún schema
 * lo usa y el runtime no lo implementa: si alguien lo declara, este test
 * se pone rojo y obliga a elegir entre implementarlo o aceptar la degradación.
 */
const ACCIONES_EJECUTADAS = ['copy-share'];

describe('R1.7 — contrato de tipos del front', () => {
  it('el catálogo expone al menos un schema', () => {
    expect(schemas.length).toBeGreaterThan(0);
  });

  it('todo tipo de campo de todo schema lo sabe renderizar la UI', () => {
    const infractores: string[] = [];
    for (const schema of schemas) {
      for (const { path, type } of todosLosCampos(schema)) {
        if (!isSupportedFieldType(type)) {
          infractores.push(`${schema.id}.${path}: type '${type}'`);
        }
      }
    }
    // Si esto falla, FieldSchema permite un tipo que field-host no pinta:
    // el campo sale vacío en el form, sin ningún error en consola.
    expect(infractores).toEqual([]);
  });

  it('recorre también los campos anidados (group / list / key-value)', () => {
    // Red: si el recorrido dejara de descender, un tipo inventado dentro de
    // un group pasaría desapercibido. Garantiza que hay anidados que mirar.
    const anidados = schemas.flatMap((s) => todosLosCampos(s).filter((c) => c.path.includes('.')));
    expect(anidados.length).toBeGreaterThan(0);
  });

  it('toda acción declarada es una que runAction ejecuta', () => {
    const infractores: string[] = [];
    for (const schema of schemas) {
      for (const { donde, type } of todasLasAcciones(schema)) {
        if (!ACCIONES_EJECUTADAS.includes(type)) {
          infractores.push(`${schema.id}.${donde}: type '${type}'`);
        }
      }
    }
    expect(infractores).toEqual([]);
  });
});
