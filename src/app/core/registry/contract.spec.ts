import { describe, expect, it } from 'vitest';

import { SUPPORTED_FIELD_TYPE_LIST } from '../../fields/descriptors';
import type { FieldSchema, ResourceSchema, WidgetType } from '../models/schema.model';
import { fieldDescriptors } from '../../fields/descriptors';
import { schemas } from '../../schemas/registry';
import { isSupported, renderKinds, type RenderKind } from './render-registry';

/**
 * R3.7 — exhaustividad del registro de render.
 *
 * **Qué garantiza.** Un `type` bien escrito en TS y A LA VEZ fuera del
 * registro de runtime: ahí `tsc` pasa y la UI no pinta nada. Lo comprueba en
 * los dos sentidos posibles:
 *
 *  1. **Declarado en un schema** → `field.type` y `widget.type` recorridos
 *     contra `isSupported`. Ése es el criterio literal de R3.7: «añadir
 *     `type: 'foo'` a cualquier schema **falla** este test».
 *  2. **De la unión de tipos** → `SUPPORTED_FIELD_TYPE_LIST` (campos, en `fields/descriptors.ts`) y
 *     `TIPOS_WIDGET` (widgets), ambos `satisfies` sobre la unión, uno a uno
 *     contra `isSupported`. Cubre el tipo que está en la unión y **todavía
 *     no declara ningún schema** — que es justo el caso que el recorrido de
 *     arriba no ve. Sin esto, dar de baja un descriptor de un widget que
 *     ningún schema usa (`chart-line`, por ejemplo) pasaría en verde.
 *
 * **Qué NO cubre, y por qué.** `column.format` aún no tiene registro: los
 * formatos se dibujan con un `@switch` con `@default` en `list-view`, con
 * degradación (D17), y crearles descriptor ahora exigiría un `load()` que
 * devuelve un componente — **un formato de columna no es un componente**.
 * Eso es R4.3, no una prueba. Mientras tanto su exhaustividad la pone `tsc`.
 *
 * **Las acciones quedaron fuera a propósito.** R3.9 les dio registro propio
 * (`actions/action-registry.ts`) y R3.10 su recorrido
 * (`actions/contract.spec.ts`): no pintan nada, así que no son un `kind` de
 * render y `renderKinds()` no debe nombrarlos. Este archivo sigue mandando
 * sólo sobre lo que el `RenderHost` dibuja.
 *
 * **El tripwire de los dos sentidos.** `renderKinds()` + `RECORRIDOS`
 * cierran el hueco que quedaría si alguien registrara un `kind` que nadie
 * recorre: el test de abajo **falla**, obligando a ampliar el recorrido. Sin
 * él, «tener registro» y «estar cubierto» serían dos afirmaciones que nadie
 * reconcilia.
 *
 * El recorrido de campos existía en `src/app/schemas/contract.spec.ts`
 * (R1.7/D17) y se muda acá para que R3.7 viva en la ruta que el plan
 * nombra — allí quedan el catálogo y las acciones.
 */

/** `kind`s que este archivo recorre de punta a punta. */
const RECORRIDOS: readonly RenderKind[] = ['field', 'widget'];

/**
 * Unión `WidgetType` ↔ registro, en el mismo molde que
 * `SUPPORTED_FIELD_TYPE_LIST` en `field-host.ts`.
 *
 * `satisfies` + `Exclude` hacen el trabajo en compilación: un widget nuevo
 * en la unión obliga a añadirlo acá, y quitarlo de acá obliga a quitarlo de
 * la unión. El `it` de abajo añade lo que TS no puede mirar — que ese nombre
 * tenga descriptor en `render-registry`.
 */
const TIPOS_WIDGET = [
  'metric-card',
  'bar-chart',
  'chart-line',
  'record-list',
  'quick-actions',
  'status-progress',
] as const satisfies readonly WidgetType[];

type WidgetSinLista = Exclude<WidgetType, (typeof TIPOS_WIDGET)[number]>;
const _widgetsExhaustivos: WidgetSinLista extends never
  ? true
  : ['Falta en TIPOS_WIDGET', WidgetSinLista] = true;

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

/** Widgets declarados: no anidan, así que el recorrido es plano. */
function todosLosWidgets(lista: readonly ResourceSchema[]): { schema: string; type: string }[] {
  return lista.flatMap((schema) =>
    (schema.widgets ?? []).map((widget) => ({ schema: schema.id, type: widget.type })),
  );
}

describe('R3.7 — exhaustividad del registro de render', () => {
  it('todo tipo de campo de todo schema lo sabe renderizar la UI', () => {
    const infractores: string[] = [];
    for (const schema of schemas) {
      for (const { path, type } of todosLosCampos(schema)) {
        if (!isSupported('field', type)) {
          infractores.push(`${schema.id}.${path}: type '${type}'`);
        }
      }
    }
    // Si esto falla, FieldSchema permite un tipo que el registro no resuelve:
    // el campo sale vacío en el form, sin ningún error en consola.
    expect(infractores).toEqual([]);
  });

  it('recorre también los campos anidados (group / list / key-value)', () => {
    // Red: si el recorrido dejara de descender, un tipo inventado dentro de
    // un group pasaría desapercibido. Garantiza que hay anidados que mirar.
    const anidados = schemas.flatMap((s) => todosLosCampos(s).filter((c) => c.path.includes('.')));
    expect(anidados.length).toBeGreaterThan(0);
  });

  it('todo widget.type de todo schema lo sabe renderizar la UI', () => {
    const infractores: string[] = [];
    for (const { schema, type } of todosLosWidgets(schemas)) {
      if (!isSupported('widget', type)) {
        infractores.push(`${schema}: widget type '${type}'`);
      }
    }
    // R3.6 registró los 6 widgets; si el schema declara un séptimo que la UI
    // no conoce, el panel queda en blanco y silencioso.
    expect(infractores).toEqual([]);
  });

  it('hay widgets declarados (el recorrido de widgets no es vacío)', () => {
    // Red: sin este guardián, borrar los widgets del dashboard dejaría la
    // aserción anterior en verde sin mirar nada.
    expect(todosLosWidgets(schemas).length).toBeGreaterThan(0);
  });

  it('todo nombre de la lista de campos tiene descriptor', () => {
    const infractores = SUPPORTED_FIELD_TYPE_LIST.filter((type) => !isSupported('field', type));
    // Dirección que el tripwire de `field-host.ts` NO cubre: allí sólo se
    // afirma que el nombre está en la unión `FieldType`.
    expect(infractores).toEqual([]);
  });

  it('todo tipo de la unión de widgets tiene descriptor', () => {
    const infractores = TIPOS_WIDGET.filter((type) => !isSupported('widget', type));
    // Es el test que dejaría en rojo la baja de un descriptor que ningún
    // schema declara todavía (hoy `bar-chart` y `chart-line` no aparecen en
    // `dashboard.schema.ts`).
    expect(infractores).toEqual([]);
  });

  it('todo descriptor de campo declara su siembra', () => {
    // D32 · la exhaustividad de `SeedKind` no puede imponerse en compilación
    // (el registro guarda `RenderDescriptor`, con `type: string`), así que la
    // obliga este test: un descriptor de campo sin `seed` rompe CI, no el
    // formulario en producción.
    const sinSiembra = fieldDescriptors
      .filter((descriptor) => descriptor.kind === 'field' && !descriptor.seed)
      .map((descriptor) => descriptor.type);
    expect(sinSiembra).toEqual([]);
  });

  it('los kind con descriptor son exactamente los que este test recorre', () => {
    // Tripwire de ambos sentidos: el día que existan descriptores de
    // `column-format` (R4.3) o de `action` (R3.9) esto se pone rojo y
    // obliga a añadir su recorrido — un kind registrado y sin recorrer es
    // exactamente el agujero que R3.7 vino a cerrar.
    expect([...renderKinds()].sort()).toEqual([...RECORRIDOS].sort());
  });
});
