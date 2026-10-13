import type { CalendarViewConfig, FieldSchema } from '../../core/models/schema.model';
import type { SourceRow } from '../../core/services/data-source.service';

/**
 * Pure date + event-mapping model for the generic calendar view (R9.8.3).
 *
 * Date model (decided): backend `date` fields are ISO civil dates
 * `YYYY-MM-DD` treated as CALENDAR DAYS — never shifted through the browser
 * timezone. Every parse goes through `Date.UTC` on the literal parts, never
 * `new Date('YYYY-MM-DD')` in local time (that lands on the previous day
 * west of Greenwich).
 */

/** Milliseconds in one civil day — every day-step of the model uses this. */
export const DAY_MS = 86_400_000;

/** Visible modes of the calendar. */
export type CalendarMode = 'month' | 'week' | 'day' | 'agenda';

/** Inclusive pair of civil days (`YYYY-MM-DD`) that the view paints. */
export interface CivilRange {
  desde: string;
  hasta: string;
}

/** One event painted from a source row. */
export interface CalEvent {
  key: string;
  title: string;
  /** True first day (`YYYY-MM-DD`), before any clamp to the visible range. */
  startDay: string;
  /** True last day, inclusive. Equals `startDay` for single-day events. */
  endDay: string;
  color?: string;
  row: SourceRow;
}

/** A row excluded from the grid because its interval is inconsistent. */
export interface CalendarProblem {
  row: SourceRow;
  reason: string;
}

/** Result of mapping raw rows onto calendar events (R9.8.3). */
export interface CalendarMapping {
  events: CalEvent[];
  /** Rows whose `startField` is empty or not a valid civil date. */
  undated: SourceRow[];
  /** Rows whose `endField` makes the interval impossible. */
  invalid: CalendarProblem[];
}

/** Spanish reasons shown next to problem records (UI copy). */
export const REASON_UNDATED = 'Sin fecha de inicio válida';
export const REASON_INVALID_END = 'Fecha de fin inválida';
export const REASON_END_BEFORE_START = 'El fin es anterior al inicio';

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const MONTHS_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

/** Weekday names Monday-first (the calendar's week start, decided). */
const WEEKDAYS_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** Weekday headings of the Monday-first grid, in display order. */
export const WEEKDAY_HEADINGS: readonly string[] = WEEKDAYS_SHORT;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD` → UTC milliseconds at midnight of that civil day.
 *
 * Strict: the string must be exactly three zero-padded parts and name a real
 * calendar day (`2026-02-30` is rejected, not rolled into March). Empty,
 * malformed or non-string input → `null` (the caller decides whether that
 * means "undated" or "invalid").
 */
export function parseDay(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = DAY_PATTERN.exec(value.trim());
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

/** UTC milliseconds at midnight → `YYYY-MM-DD` (inverse of `parseDay`). */
export function formatDay(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/**
 * Today as a civil day, in the USER's local calendar date — the local parts
 * are read off `new Date()` and formatted manually, so no timezone shift can
 * sneak in through a round-trip.
 */
export function todayCivil(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Day-step on civil days (safe: every `ms` is a UTC midnight). */
export function addDays(ms: number, days: number): number {
  return ms + days * DAY_MS;
}

/** 0 = Monday … 6 = Sunday (the calendar's Monday-first convention). */
export function dayOfWeekMon0(ms: number): number {
  return (new Date(ms).getUTCDay() + 6) % 7;
}

/**
 * Move a civil day by whole months, clamping the day-of-month to the target
 * month's length (Jan 31 + 1 month → Feb 28).
 */
export function shiftMonths(ms: number, months: number): number {
  const date = new Date(ms);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    Math.min(date.getUTCDate(), lastDay),
  );
}

/** Monday of the 6-week (42-day) grid that shows the cursor's month. */
function monthGridStartMs(cursorMs: number): number {
  const date = new Date(cursorMs);
  const firstOfMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  return addDays(firstOfMonth, -dayOfWeekMon0(firstOfMonth));
}

/**
 * The 42 civil days of the month grid (6 Monday-first weeks), so the grid
 * always has the same shape and the de-emphasized edge days are complete.
 */
export function monthGridDays(cursorDay: string): string[] {
  const cursor = parseDay(cursorDay);
  if (cursor === null) return [];
  const start = monthGridStartMs(cursor);
  return Array.from({ length: 42 }, (_, index) => formatDay(addDays(start, index)));
}

/** The 7 civil days of the Monday-first week containing the cursor. */
export function weekDays(cursorDay: string): string[] {
  const cursor = parseDay(cursorDay);
  if (cursor === null) return [];
  const start = addDays(cursor, -dayOfWeekMon0(cursor));
  return Array.from({ length: 7 }, (_, index) => formatDay(addDays(start, index)));
}

/** Every civil day of an inclusive range (empty when the range is invalid). */
export function daysInRange(range: CivilRange): string[] {
  const from = parseDay(range.desde);
  const to = parseDay(range.hasta);
  if (from === null || to === null || to < from) return [];
  const days: string[] = [];
  for (let ms = from; ms <= to; ms = addDays(ms, 1)) {
    days.push(formatDay(ms));
  }
  return days;
}

/**
 * Visible `{desde, hasta}` for a mode + cursor.
 *
 * - `month`: the 6-week grid range (superset of the month) — with the
 *   backend-range optimization the fetch already covers the edge weeks.
 * - `week`: the Monday-first week of the cursor.
 * - `day`: the cursor itself.
 * - `agenda`: a fixed 30-day window from the cursor.
 */
export function visibleRangeFor(mode: CalendarMode, cursorDay: string): CivilRange {
  const cursor = parseDay(cursorDay);
  if (cursor === null) return { desde: '', hasta: '' };
  switch (mode) {
    case 'month': {
      const start = monthGridStartMs(cursor);
      return { desde: formatDay(start), hasta: formatDay(addDays(start, 41)) };
    }
    case 'week': {
      const start = addDays(cursor, -dayOfWeekMon0(cursor));
      return { desde: formatDay(start), hasta: formatDay(addDays(start, 6)) };
    }
    case 'day':
      return { desde: formatDay(cursor), hasta: formatDay(cursor) };
    case 'agenda':
      return { desde: formatDay(cursor), hasta: formatDay(addDays(cursor, 29)) };
  }
}

/** Move the cursor one step of the current mode (agenda steps 30 days). */
export function shiftCursor(mode: CalendarMode, cursorDay: string, delta: 1 | -1): string {
  const cursor = parseDay(cursorDay) ?? parseDay(todayCivil()) ?? Date.UTC(1970, 0, 1);
  switch (mode) {
    case 'month':
      return formatDay(shiftMonths(cursor, delta));
    case 'week':
      return formatDay(addDays(cursor, 7 * delta));
    case 'day':
      return formatDay(addDays(cursor, delta));
    case 'agenda':
      return formatDay(addDays(cursor, 30 * delta));
  }
}

/** True when both civil days fall in the same year+month. */
export function sameMonth(a: string, b: string): boolean {
  const msA = parseDay(a);
  const msB = parseDay(b);
  if (msA === null || msB === null) return false;
  const dateA = new Date(msA);
  const dateB = new Date(msB);
  return (
    dateA.getUTCFullYear() === dateB.getUTCFullYear() && dateA.getUTCMonth() === dateB.getUTCMonth()
  );
}

/** Depth-first lookup of a field by key through `group`/`list` nesting. */
export function findFieldByKey(
  fields: readonly FieldSchema[],
  key: string,
): FieldSchema | undefined {
  for (const field of fields) {
    if (field.key === key) return field;
    if (field.type === 'group') {
      const hit = findFieldByKey(field.fields, key);
      if (hit !== undefined) return hit;
    } else if (field.type === 'list') {
      const hit = findFieldByKey(field.itemFields, key);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

/**
 * Pure row → event mapping (R9.8.3): the single place that decides what is a
 * paintable event, what is undated and what is an impossible interval.
 *
 * - Empty/invalid `startField` → `undated` (surfaced, never hidden).
 * - `endField` of type `time` → same civil day as the start (time-of-day
 *   within the start day; it never spans days).
 * - Empty `endField` (date) → single-day event on the start.
 * - `end < start` → `invalid` with a visible reason; not painted at all.
 */
export function mapCalendarRows(
  rows: readonly SourceRow[],
  config: CalendarViewConfig,
  options: { keyField: string; endFieldType?: string },
): CalendarMapping {
  const events: CalEvent[] = [];
  const undated: SourceRow[] = [];
  const invalid: CalendarProblem[] = [];

  for (const row of rows) {
    const startMs = parseDay(row[config.startField]);
    if (startMs === null) {
      undated.push(row);
      continue;
    }
    let endMs = startMs;
    if (config.endField !== undefined && options.endFieldType !== 'time') {
      const rawEnd = row[config.endField];
      const empty = rawEnd === null || rawEnd === undefined || rawEnd === '';
      if (!empty) {
        const parsedEnd = parseDay(rawEnd);
        if (parsedEnd === null) {
          invalid.push({ row, reason: REASON_INVALID_END });
          continue;
        }
        if (parsedEnd < startMs) {
          invalid.push({ row, reason: REASON_END_BEFORE_START });
          continue;
        }
        endMs = parsedEnd;
      }
    }
    const key = String(row[options.keyField] ?? '');
    const title = String(row[config.titleField] ?? '').trim() || key;
    const rawColor = config.colorField !== undefined ? row[config.colorField] : undefined;
    const color = typeof rawColor === 'string' && rawColor !== '' ? rawColor : undefined;
    events.push({ key, title, startDay: formatDay(startMs), endDay: formatDay(endMs), color, row });
  }

  return { events, undated, invalid };
}

/**
 * Bucket events per civil day inside the visible range.
 *
 * A multi-day event appears under EVERY day it touches; the painted span is
 * clamped to the range (the event keeps its true `startDay`/`endDay` — only
 * the buckets are limited), which also keeps long intervals cheap.
 */
export function eventsByDay(
  events: readonly CalEvent[],
  range: CivilRange,
): Map<string, CalEvent[]> {
  const byDay = new Map<string, CalEvent[]>();
  const from = parseDay(range.desde);
  const to = parseDay(range.hasta);
  if (from === null || to === null || to < from) return byDay;
  for (const event of events) {
    const start = parseDay(event.startDay);
    const end = parseDay(event.endDay);
    if (start === null || end === null) continue;
    const paintFrom = Math.max(start, from);
    const paintTo = Math.min(end, to);
    for (let ms = paintFrom; ms <= paintTo; ms = addDays(ms, 1)) {
      const day = formatDay(ms);
      const bucket = byDay.get(day);
      if (bucket === undefined) byDay.set(day, [event]);
      else bucket.push(event);
    }
  }
  return byDay;
}

/** "12 de octubre de 2026" — civil parts, UTC-based (no TZ shift). */
export function dayLabel(day: string): string {
  const ms = parseDay(day);
  if (ms === null) return day;
  const date = new Date(ms);
  return `${date.getUTCDate()} de ${MONTHS[date.getUTCMonth()]} de ${date.getUTCFullYear()}`;
}

/** Short weekday of a civil day, Monday-first ("lunes" → "lun"). */
export function weekdayShort(day: string): string {
  const ms = parseDay(day);
  if (ms === null) return '';
  return WEEKDAYS_SHORT[dayOfWeekMon0(ms)];
}

/** Full weekday of a civil day ("lunes"). */
export function weekdayFull(day: string): string {
  const ms = parseDay(day);
  if (ms === null) return '';
  return WEEKDAYS[dayOfWeekMon0(ms)];
}

/** "lunes, 12 de octubre de 2026" — agenda/day heading. */
export function agendaDayLabel(day: string): string {
  const weekday = weekdayFull(day);
  return weekday !== '' ? `${weekday}, ${dayLabel(day)}` : dayLabel(day);
}

/**
 * Header label for the visible range, built from civil parts with a fixed
 * Spanish vocabulary (deterministic regardless of the runtime locale).
 */
export function rangeLabelFor(mode: CalendarMode, cursorDay: string): string {
  const cursor = parseDay(cursorDay);
  if (cursor === null) return '';
  const date = new Date(cursor);
  if (mode === 'month') {
    return `${MONTHS[date.getUTCMonth()]} de ${date.getUTCFullYear()}`;
  }
  const range = visibleRangeFor(mode, cursorDay);
  const desde = parseDay(range.desde);
  const hasta = parseDay(range.hasta);
  if (desde === null || hasta === null) return '';
  const startDate = new Date(desde);
  const endDate = new Date(hasta);
  const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();
  const left = `${startDate.getUTCDate()} ${MONTHS_SHORT[startDate.getUTCMonth()]}${
    sameYear ? '' : ` ${startDate.getUTCFullYear()}`
  }`;
  return `${left} – ${endDate.getUTCDate()} ${MONTHS_SHORT[endDate.getUTCMonth()]} ${endDate.getUTCFullYear()}`;
}
