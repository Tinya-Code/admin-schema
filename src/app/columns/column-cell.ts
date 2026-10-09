import type { FieldSchema, ListColumn } from '../core/models/schema.model';

type Row = Record<string, unknown>;

/**
 * Contexto de una celda de listado (R4.3 · `kind: 'column-format'`).
 *
 * Es lo que antes cada `@case` de `list-view` pedía a la vista como
 * `row`/`column` y lo que el descriptor cuelga de `extras.data`: el
 * componente de formato no conoce a la vista, sólo a su celda.
 *
 * `fields`, `canUpdate`, `saving`, `currency` y `toggle` viajan acá porque
 * son decisiones de la vista (permisos, moneda del schema, escritura de la
 * fila); un formato nuevo no necesita tocar `list-view` para leerlas.
 */
export interface ColumnCell {
  /** Fila completa. */
  row: Row;
  /** Columna que se pinta (`key`, `label`, `format`). */
  column: ListColumn;
  /** Campos del recurso: de acá salen `trueLabel`/`falseLabel`. */
  fields: FieldSchema[];
  /** `titleField` de la fila, para el `aria-label` del interruptor. */
  title: string;
  /** ¿La fila admite escritura? (`ListView.canUpdate`) */
  canUpdate: boolean;
  /** ¿La fila está guardando? (`ListView.savingKey === keyOf(row)`) */
  saving: boolean;
  /** Moneda del schema, para el formato `currency`. */
  currency: string;
  /** Escribe el valor en la fila. Sólo lo usa el interruptor `active`. */
  toggle?: (checked: boolean) => void;
}
