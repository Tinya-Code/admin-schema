import type { KanbanViewConfig, ResourceSchema } from '../../core/models/schema.model';
import type { SourceRow } from '../../core/services/data-source.service';

/**
 * Pure grouping + card-text model for the generic kanban view (R9.8.4).
 *
 * No Angular imports: everything here is a plain function over rows, so the
 * rules below are testable without a TestBed.
 *
 * Rules (decided · R9.8.1 read-only, R9.8.4 visibility):
 * - Column order is `config.columns` order; a declared column ALWAYS exists,
 *   even with zero rows (an empty column is a visible «Sin tarjetas», never
 *   a missing column).
 * - A row whose `groupField` value is empty/undefined goes to `unknown` —
 *   surfaced, never silently dropped.
 * - A value that is not declared gets its own column appended AFTER the
 *   declared ones: undeclared values are VISIBLE, not hidden.
 * - Order inside a column is the row insertion order (stable, deterministic).
 */

/** One column of the board: declared in the config or discovered in the rows. */
export interface KanbanColumnBucket {
  /** Raw `groupField` value that owns the bucket (unique across the board). */
  value: string;
  /** Visible label: the declared column's label, or the raw value. */
  label: string;
  /** Rows of the bucket, in insertion order. */
  rows: SourceRow[];
}

/** Result of grouping raw rows onto board columns (R9.8.4). */
export interface KanbanMapping {
  /** Declared columns (in declared order) + one bucket per undeclared value. */
  columns: KanbanColumnBucket[];
  /** Rows whose `groupField` value is empty — visible, never dropped. */
  unknown: SourceRow[];
}

/** Options of the grouping (all optional; the defaults are the decided rules). */
export interface KanbanMapOptions {
  /**
   * Label of buckets whose value is NOT declared in `config.columns`.
   * Default: the raw value itself, so undeclared values stay verbatim and
   * visible. The view uses the default; the hook exists for callers that
   * want to decorate the label without touching the grouping rules.
   */
  labelFor?: (value: string) => string;
}

/** Title of a card whose every candidate is empty/unreadable (never blank). */
export const CARD_NO_TITLE = 'Sin título';

/** Object cells: the readable keys, in preference order. */
const OBJECT_VALUE_KEYS = ['label', 'value', 'id'] as const;

/** Printable text of a scalar cell; `null` when it is empty or not scalar. */
function scalarText(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.trim();
    return text === '' ? null : text;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return null;
}

/**
 * Printable text of ANY cell: scalars as-is (trimmed), objects reduced to
 * their first readable `label`/`value`/`id`. `null` when there is nothing
 * readable — the caller decides (bucket → `unknown`, card → next fallback).
 *
 * Never returns `undefined` nor `[object Object]`: that is the whole point.
 */
function cellText(value: unknown): string | null {
  const scalar = scalarText(value);
  if (scalar !== null) return scalar;
  if (value !== null && typeof value === 'object') {
    const cell = value as Record<string, unknown>;
    for (const key of OBJECT_VALUE_KEYS) {
      const text = scalarText(cell[key]);
      if (text !== null) return text;
    }
  }
  return null;
}

/**
 * Pure row → board grouping (R9.8.4): the single place that decides which
 * column owns each row, which rows are «unknown» and in what order the
 * columns are painted.
 *
 * Deterministic: declared columns keep their declared order (even when
 * empty), undeclared values are appended in first-appearance order, and the
 * rows inside each column keep their insertion order.
 */
export function mapKanbanRows(
  rows: readonly SourceRow[],
  config: KanbanViewConfig,
  opts: KanbanMapOptions = {},
): KanbanMapping {
  const columns: KanbanColumnBucket[] = [];
  const byValue = new Map<string, KanbanColumnBucket>();

  // Declared columns first — always visible, even with zero rows.
  const declared = Array.isArray(config.columns) ? config.columns : [];
  for (const column of declared) {
    const value = typeof column?.value === 'string' ? column.value : '';
    // Contract (R9.8.2): `value` obligatorio y único — a duplicated or empty
    // declaration cannot own a bucket, the first valid one wins.
    if (value === '' || byValue.has(value)) continue;
    const label = typeof column.label === 'string' && column.label !== '' ? column.label : value;
    const bucket: KanbanColumnBucket = { value, label, rows: [] };
    byValue.set(value, bucket);
    columns.push(bucket);
  }

  const unknown: SourceRow[] = [];
  for (const row of rows) {
    const value = cellText(row[config.groupField]);
    if (value === null) {
      // Empty/undefined (or unreadable object): visible bucket, never dropped.
      unknown.push(row);
      continue;
    }
    let bucket = byValue.get(value);
    if (bucket === undefined) {
      // Undeclared value: its own column, appended AFTER the declared ones.
      const label = opts.labelFor !== undefined ? opts.labelFor(value) : value;
      bucket = { value, label, rows: [] };
      byValue.set(value, bucket);
      columns.push(bucket);
    }
    bucket.rows.push(row);
  }

  return { columns, unknown };
}

/**
 * Title of a card: `config.titleField` → `schema.titleField` →
 * `schema.keyField`, first candidate with readable text wins. An unreadable
 * value (empty, `undefined`, an object with no label) never reaches the DOM:
 * the chain falls through to the key, and to a visible «Sin título» when not
 * even the key has text.
 */
export function cardTitle(
  row: SourceRow,
  config: KanbanViewConfig,
  schema: ResourceSchema,
): string {
  const candidates = [config.titleField, schema.titleField, schema.keyField];
  for (const field of candidates) {
    if (typeof field !== 'string' || field === '') continue;
    const text = cellText(row[field]);
    if (text !== null) return text;
  }
  return CARD_NO_TITLE;
}

/**
 * Second line of a card: the `config.subtitleField` value when the config
 * declares one, `''` otherwise (the schema has no notion of subtitle).
 */
export function cardSubtitle(
  row: SourceRow,
  config: KanbanViewConfig,
  _schema: ResourceSchema,
): string {
  const field = config.subtitleField;
  if (typeof field !== 'string' || field === '') return '';
  return cellText(row[field]) ?? '';
}
