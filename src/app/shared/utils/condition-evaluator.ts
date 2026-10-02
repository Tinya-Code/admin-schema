import type { FieldCondition } from '../../core/models/schema.model';

/**
 * Evaluador de condiciones `visibleWhen` / `readonlyWhen` (base.md §4):
 * comparaciones simples (igual, distinto, está vacío, contiene) sobre otros
 * campos del mismo nivel o del registro raíz.
 *
 * Nota de arquitectura: la importación de `FieldCondition` es SOLO de tipo
 * (se elimina en compilación) — no hay dependencia de runtime con `core`.
 */

/** Resuelve una condición. Se resuelve contra el nivel propio; si la clave
 * no existe ahí, contra la raíz del registro. */
export function evaluateCondition(
  condition: FieldCondition,
  siblingValues: Record<string, unknown>,
  rootValues: Record<string, unknown> = {},
): boolean {
  const source = condition.field in siblingValues ? siblingValues : rootValues;
  const actual = source[condition.field];
  const expected = condition.value;

  switch (condition.operator) {
    case 'eq':
      return actual === expected;
    case 'ne':
      return actual !== expected;
    case 'empty':
      return isEmpty(actual);
    case 'contains':
      return contains(actual, expected);
  }
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === '') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

function contains(actual: unknown, expected: unknown): boolean {
  if (typeof actual === 'string') {
    return actual.includes(String(expected));
  }
  if (Array.isArray(actual)) {
    return actual.includes(expected);
  }
  return false;
}
