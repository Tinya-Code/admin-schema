import { describe, expect, it } from 'vitest';

import { COLUMN_FORMAT_TYPES, columnFormatDescriptors } from '../../columns/descriptors';
import { SUPPORTED_FIELD_TYPE_LIST } from '../../fields/descriptors';
import { layoutDescriptors } from '../../layouts/descriptors';
import type {
  CalendarViewConfig,
  FieldSchema,
  KanbanColumn,
  KanbanViewConfig,
  LayoutMode,
  ListColumnFormat,
  ResourceSchema,
  TabsConfig,
  UiViewDescriptor,
  ViewChildNode,
  WidgetType,
} from '../models/schema.model';
import { fieldDescriptors } from '../../fields/descriptors';
import { viewDescriptors } from '../../views/descriptors';
import { schemas } from '../../schemas/registry';
import { MAX_DEPTH } from './composition-validator';
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
 * **Los formatos de columna entran en R4.3.** Mientras `column.format` se
 * dibujaba con un `@switch` con `@default` en `list-view` no había registro
 * que recorrer (D17). Con `kind: 'column-format'` sí: este archivo vigila
 * que cada `format` declarado en un schema —y cada nombre de la unión— tenga
 * descriptor, en paralelo a lo que ya hacía con campos y widgets.
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
const RECORRIDOS: readonly RenderKind[] = ['field', 'column-format', 'widget', 'view', 'layout'];

const LAYOUTS = [
  'grid',
  'tabs',
  'sections',
  'steps',
  'columns',
] as const satisfies readonly LayoutMode[];

/**
 * Unión `ListColumnFormat` ↔ manifiesto de formatos, en el mismo molde que
 * `TIPOS_WIDGET`. El `satisfies` + `Exclude` resuelven exhaustividad en
 * compilación (un formato nuevo obliga a nombrarlo acá y en el manifiesto)
 * y el `it` de abajo añade lo que TS no puede mirar: que cada nombre tenga
 * descriptor registrado en runtime.
 */
const FORMATOS = COLUMN_FORMAT_TYPES satisfies readonly ListColumnFormat[];

type FormatoSinLista = Exclude<ListColumnFormat, (typeof FORMATOS)[number]>;
const _formatosExhaustivos: FormatoSinLista extends never
  ? true
  : ['Falta en COLUMN_FORMAT_TYPES', FormatoSinLista] = true;

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

function todasLasUiViews(lista: readonly ResourceSchema[]): { schema: string; type: string }[] {
  return lista.flatMap((schema) =>
    Object.values(schema.uiViews ?? {}).map((view) => ({
      schema: schema.id,
      type: view.type,
    })),
  );
}

// ─────────────────────────────────────────────────────────────
// R9.8.2 — contrato de config de `uiView` calendar / kanban
// ─────────────────────────────────────────────────────────────

/** Tipos de campo válidos para cada referencia de config (R9.8.2). */
const CALENDAR_START_TYPES = ['date'] as const;
const CALENDAR_END_TYPES = ['date', 'time'] as const;
const CALENDAR_TITLE_TYPES = ['text', 'readonly-text', 'relation', 'slug'] as const;
const CALENDAR_COLOR_TYPES = ['select', 'text', 'relation'] as const;
const KANBAN_GROUP_TYPES = ['select', 'relation'] as const;

/**
 * Narrowing de `config`: `UiViewBase.type` es `string` (abierto para
 * `list`/`detail`/`form`/`dashboard`), así que comparar `view.type ===
 * 'calendar'` NO elimina al base de la unión. El `in` sí: sólo los miembros
 * discriminados (`UiViewCalendar`/`UiViewKanban`) declaran `config`.
 */
function configDe(
  view: UiViewDescriptor,
): CalendarViewConfig | KanbanViewConfig | TabsConfig | undefined {
  return 'config' in view ? view.config : undefined;
}

/** Valida una referencia de campo contra el schema (existencia + tipo). */
function problemasRef(
  donde: string,
  etiqueta: string,
  ref: string,
  tipoDeCampo: (ref: string) => string | undefined,
  permitidos: readonly string[],
): string[] {
  const tipo = tipoDeCampo(ref);
  if (tipo === undefined) {
    return [`${donde}: ${etiqueta} referencia campo inexistente '${ref}'`];
  }
  if (!permitidos.includes(tipo)) {
    return [
      `${donde}: ${etiqueta} '${ref}' tiene tipo '${tipo}' (esperado ${permitidos.join('/')})`,
    ];
  }
  return [];
}

function problemasCalendar(
  donde: string,
  config: CalendarViewConfig | undefined,
  tipoDeCampo: (ref: string) => string | undefined,
): string[] {
  if (!config) {
    return [`${donde}: vista 'calendar' sin config`];
  }
  const infractores: string[] = [];
  const { startField, endField, titleField, colorField } = config;

  if (typeof startField !== 'string' || startField === '') {
    infractores.push(`${donde}: calendar.startField obligatorio y no vacío`);
  } else {
    infractores.push(
      ...problemasRef(donde, 'calendar.startField', startField, tipoDeCampo, CALENDAR_START_TYPES),
    );
  }
  if (endField !== undefined) {
    infractores.push(
      ...problemasRef(donde, 'calendar.endField', endField, tipoDeCampo, CALENDAR_END_TYPES),
    );
  }
  if (typeof titleField !== 'string' || titleField === '') {
    infractores.push(`${donde}: calendar.titleField obligatorio y no vacío`);
  } else {
    infractores.push(
      ...problemasRef(donde, 'calendar.titleField', titleField, tipoDeCampo, CALENDAR_TITLE_TYPES),
    );
  }
  if (colorField !== undefined) {
    infractores.push(
      ...problemasRef(donde, 'calendar.colorField', colorField, tipoDeCampo, CALENDAR_COLOR_TYPES),
    );
  }
  return infractores;
}

function problemasKanban(
  donde: string,
  config: KanbanViewConfig | undefined,
  tipoDeCampo: (ref: string) => string | undefined,
): string[] {
  if (!config) {
    return [`${donde}: vista 'kanban' sin config`];
  }
  const infractores: string[] = [];
  const { groupField, columns, titleField, subtitleField } = config;

  if (typeof groupField !== 'string' || groupField === '') {
    infractores.push(`${donde}: kanban.groupField obligatorio y no vacío`);
  } else {
    infractores.push(
      ...problemasRef(donde, 'kanban.groupField', groupField, tipoDeCampo, KANBAN_GROUP_TYPES),
    );
  }

  if (!Array.isArray(columns) || columns.length === 0) {
    infractores.push(`${donde}: kanban.columns debe ser un arreglo no vacío`);
  } else {
    const vistos = new Set<string>();
    for (const col of columns) {
      const value = (col as KanbanColumn | undefined)?.value;
      if (typeof value !== 'string' || value === '') {
        infractores.push(`${donde}: kanban.columns con columna sin value`);
      } else if (vistos.has(value)) {
        infractores.push(`${donde}: kanban.columns con value duplicado '${value}'`);
      } else {
        vistos.add(value);
      }
    }
  }

  if (titleField !== undefined && tipoDeCampo(titleField) === undefined) {
    infractores.push(`${donde}: kanban.titleField referencia campo inexistente '${titleField}'`);
  }
  if (subtitleField !== undefined && tipoDeCampo(subtitleField) === undefined) {
    infractores.push(
      `${donde}: kanban.subtitleField referencia campo inexistente '${subtitleField}'`,
    );
  }
  return infractores;
}

/**
 * `tabs` (R9.9): config con `children` no vacío, ids únicos, `initial`
 * apuntando a un hijo existente y — recursivamente — la misma validez de
 * config para los hijos inline que la tienen (calendar/kanban/tabs).
 */
function problemasTabs(
  donde: string,
  config: TabsConfig | undefined,
  tipoDeCampo: (ref: string) => string | undefined,
  profundidad = 1,
): string[] {
  if (config === undefined) {
    return [`${donde}: vista 'tabs' sin config`];
  }
  if (profundidad > MAX_DEPTH) {
    return [`${donde}: tabs anidado sobre la profundidad máxima (${MAX_DEPTH})`];
  }
  if (!Array.isArray(config.children) || config.children.length === 0) {
    return [`${donde}: tabs.config.children debe ser un arreglo no vacío`];
  }

  const infractores: string[] = [];
  const ids = new Set<string>();
  for (const hijo of config.children) {
    if (ids.has(hijo.id)) {
      infractores.push(`${donde}: tabs.config.children con id duplicado '${hijo.id}'`);
    }
    ids.add(hijo.id);

    // `ref` se resuelve contra el schema en `composition-validator`; aquí
    // sólo se revisa el inline, que es el único que arrastra config.
    if ('ref' in hijo) continue;

    const dondeHijo = `${donde}.children[${hijo.id}]`;
    if (hijo.type === 'calendar') {
      infractores.push(
        ...problemasCalendar(
          dondeHijo,
          configDe(hijo) as CalendarViewConfig | undefined,
          tipoDeCampo,
        ),
      );
    } else if (hijo.type === 'kanban') {
      infractores.push(
        ...problemasKanban(dondeHijo, configDe(hijo) as KanbanViewConfig | undefined, tipoDeCampo),
      );
    } else if (hijo.type === 'tabs') {
      infractores.push(
        ...problemasTabs(
          dondeHijo,
          configDe(hijo) as TabsConfig | undefined,
          tipoDeCampo,
          profundidad + 1,
        ),
      );
    } else if (configDe(hijo) !== undefined) {
      infractores.push(`${dondeHijo}: tipo base '${hijo.type}' no debe llevar config`);
    }
  }

  if (config.initial !== undefined && !ids.has(config.initial)) {
    infractores.push(`${donde}: tabs.initial '${config.initial}' no es un hijo existente`);
  }
  return infractores;
}

/**
 * Recorre TODOS los `uiView` de un schema y devuelve los problemas de config.
 *
 * Extraída como función para poder ejercitarla con una fixture sintética
 * (ver el `it` de abajo): ningún schema real declara `calendar`/`kanban`
 * todavía, así que el recorrido sobre `schemas` pasaría en vacío aunque el
 * validador estuviera roto.
 */
function problemasDeUiViews(schema: ResourceSchema): string[] {
  const campos = new Map(todosLosCampos(schema).map((c) => [c.path, c.type]));
  const tipoDeCampo = (ref: string): string | undefined => campos.get(ref);

  const infractores: string[] = [];
  for (const [name, view] of Object.entries(schema.uiViews ?? {})) {
    const donde = `${schema.id}.uiViews.${name}`;
    if (view.type === 'calendar') {
      infractores.push(
        ...problemasCalendar(donde, configDe(view) as CalendarViewConfig | undefined, tipoDeCampo),
      );
    } else if (view.type === 'kanban') {
      infractores.push(
        ...problemasKanban(donde, configDe(view) as KanbanViewConfig | undefined, tipoDeCampo),
      );
    } else if (view.type === 'tabs') {
      infractores.push(
        ...problemasTabs(donde, configDe(view) as TabsConfig | undefined, tipoDeCampo),
      );
    } else if (configDe(view) !== undefined) {
      // Tipos base: conservan la forma plana y NO deben arrastrar un config.
      infractores.push(`${donde}: tipo base '${view.type}' no debe llevar config`);
    }
  }
  return infractores;
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

  it('todo tipo uiViews declarado tiene descriptor y hay páginas declaradas', () => {
    const declared = todasLasUiViews(schemas);
    const unsupported = declared.filter(({ type }) => !isSupported('view', type));

    expect(declared.length).toBeGreaterThan(0);
    expect(unsupported).toEqual([]);
    expect(viewDescriptors.map((descriptor) => descriptor.type).sort()).toEqual([
      'calendar',
      'dashboard',
      'detail',
      'form',
      'kanban',
      'list',
      'tabs',
    ]);
  });

  it('todo uiView calendar/kanban declara config que apunta a campos existentes y con tipo válido', () => {
    // R9.8.2 — `calendar` y `kanban` llevan `config` con referencias a campos
    // (`startField`, `groupField`, …). Esos strings no los valida `tsc`: un
    // `startField: 'fecha'` que no existe en `fields` compila perfecto y la
    // vista se abre vacía en producción, sin un solo error en consola. Este
    // recorrido es el eslabón que falta entre el schema y la config de estas
    // vistas: field-references resueltas, tipos coherentes (`date` para
    // fechas, `select`/`relation` para columnas) y columnas sin duplicados.
    //
    // Hoy ningún schema real declara `calendar`/`kanban`, así que el recorrido
    // sobre `schemas` pasa en vacío — pero el `it` siguiente ejercita el
    // validador con una fixture sintética para que no quede en verde muerto.
    const infractores = schemas.flatMap(problemasDeUiViews);
    expect(infractores).toEqual([]);
  });

  it('el validador de config de uiViews caza errores (fixture sintética)', () => {
    // Guardián de vacío: el test de arriba no vería NADA mientras ningún
    // schema declare calendar/kanban. Esta fixture —fuera del registry real—
    // le mete mano al validador con las infracciones que debe detectar y
    // exige que al menos una vuelva en rojo. Si rompés el validador (p. ej.
    // dejás de resolver campos anidados o de comparar tipos), este test falla
    // antes de que exista un schema real que lo delate.
    const fixture: ResourceSchema = {
      id: 'fx',
      label: 'Fx',
      labelPlural: 'Fx',
      kind: 'collection',
      endpoint: {},
      keyField: 'id',
      titleField: 'title',
      listColumns: [],
      fields: [
        { key: 'id', type: 'text', label: 'ID' },
        { key: 'title', type: 'text', label: 'Título' },
        { key: 'starts_at', type: 'date', label: 'Inicio' },
        { key: 'status', type: 'select', label: 'Estado', options: [] },
        {
          key: 'meta',
          type: 'group',
          label: 'Meta',
          fields: [{ key: 'due', type: 'date', label: 'Vence' }],
        },
      ],
      uiViews: {
        // 1) calendar: `startField` apunta a un campo inexistente.
        cal: {
          type: 'calendar',
          config: { startField: 'no_existe', titleField: 'title' },
        },
        // 2) kanban: `groupField` con tipo inválido (text, no select/relation)
        //    y columnas con value duplicado.
        board: {
          type: 'kanban',
          config: {
            groupField: 'title',
            columns: [
              { value: 'a', label: 'A' },
              { value: 'a', label: 'A de nuevo' },
            ],
          },
        },
        // 3) base (list) que arrastra un config: no debería poder.
        bad: { type: 'list', config: { x: 1 } },
        // 4) tabs: hijo kanban con campo inexistente + initial huérfano.
        panels: {
          type: 'tabs',
          config: {
            initial: 'no-existe',
            children: [{ id: 'h', label: 'H', type: 'kanban', config: { groupField: 'tampoco' } }],
          },
        },
      },
    } as ResourceSchema;

    const infractores = problemasDeUiViews(fixture);

    // El validador encuentra al menos una infracción…
    expect(infractores.length).toBeGreaterThan(0);
    // …y resuelve referencias anidadas (`meta.due` es un `date` válido).
    expect(
      problemasDeUiViews({
        ...fixture,
        uiViews: {
          nested: {
            type: 'calendar',
            config: { startField: 'meta.due', titleField: 'title' },
          },
        },
      } as ResourceSchema),
    ).toEqual([]);
  });

  it('todo layout de schema tiene descriptor y el registro cubre los cinco layouts', () => {
    const declared = schemas.map((schema) => schema.layout?.mode ?? 'sections');
    expect(declared.every((type) => isSupported('layout', type))).toBe(true);
    expect(layoutDescriptors.map((descriptor) => descriptor.type).sort()).toEqual(
      [...LAYOUTS].sort(),
    );
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

  it('todo descriptor de campo declara la superficie display', () => {
    // R4.1 · F3 («cada descriptor declara si sabe pintarse en display»).
    // La ficha de detalle sólo pinta un tipo cuyo descriptor trae
    // `surfaces: ['display']`; sin la declaración el host degrada y la
    // celda sale vacía en producción. `tsc` no puede velar por esto porque
    // `surfaces` es opcional en `RenderDescriptor`.
    const sinDisplay = fieldDescriptors
      .filter(
        (descriptor) => descriptor.kind === 'field' && !descriptor.surfaces?.includes('display'),
      )
      .map((descriptor) => descriptor.type);
    expect(sinDisplay).toEqual([]);
  });

  it('todo format declarado en un schema tiene descriptor de formato', () => {
    const infractores: string[] = [];
    for (const schema of schemas) {
      for (const column of schema.listColumns ?? []) {
        if (column.format && !isSupported('column-format', column.format)) {
          infractores.push(`${schema.id}.${column.key}: format '${column.format}'`);
        }
      }
    }
    // Un format sin descriptor se pintaría como `unknown-render` en la celda:
    // la tabla dejaría de mostrar lo que siempre mostró.
    expect(infractores).toEqual([]);
  });

  it('hay columnas con format declarado (el recorrido no es vacío)', () => {
    const declarados = schemas.flatMap((schema) =>
      (schema.listColumns ?? []).filter((column) => column.format),
    );
    expect(declarados.length).toBeGreaterThan(0);
  });

  it('los 7 formatos de la unión tienen descriptor', () => {
    const infractores = FORMATOS.filter((type) => !isSupported('column-format', type));
    // Cubre `text` y `number`, que hoy ningún schema declara y que sólo se
    // ven por el `?? 'text'` de `formatOf`.
    expect(infractores).toEqual([]);
    expect(columnFormatDescriptors.length).toBe(FORMATOS.length);
  });

  it('los kind con descriptor son exactamente los que este test recorre', () => {
    // Tripwire de ambos sentidos: un `kind` registrado y sin recorrer es
    // exactamente el agujero que R3.7 vino a cerrar. `action` no cuenta:
    // R3.9 le dio registro y recorrido propios (`actions/contract.spec.ts`)
    // porque no pinta nada y no es un `kind` de render.
    expect([...renderKinds()].sort()).toEqual([...RECORRIDOS].sort());
  });
});
