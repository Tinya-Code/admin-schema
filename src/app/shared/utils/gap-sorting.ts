/**
 * Ordenamiento con huecos (base.md §8).
 *
 * Reglas:
 * - Posiciones enteras con separación fija (paso 1000: 1000, 2000, 3000…).
 * - Mover entre dos vecinos → punto medio; solo cambia ese elemento.
 * - Mover al inicio → la mitad de la posición del primero.
 * - Mover al final → la del último + paso.
 * - Lista vacía → el paso.
 * - Si los vecinos quedan sin espacio (diferencia < 2) → rebalanceo:
 *   se renumera toda la lista con el paso original conservando el orden
 *   y luego se aplica el movimiento.
 * - Nuevos elementos → última posición + paso.
 *
 * El usuario nunca ve los números; la UI ordena por `position` ascendente.
 */

/** Separación fija entre posiciones. */
export const GAP = 1000;

export interface PositionedItem {
  key: string;
  position: number;
}

export interface PositionChange {
  key: string;
  position: number;
}

export interface ReorderResult {
  /** `true` → hubo rebalanceo: `changes` contiene el lote completo renumerado. */
  rebalanced: boolean;
  /** Cambios a enviar: solo el elemento movido, o el lote completo. */
  changes: PositionChange[];
}

/** Punto medio entre dos vecinos (solo el elemento movido cambia). */
export function moveBetween(prevPosition: number, nextPosition: number): number {
  return Math.floor((prevPosition + nextPosition) / 2);
}

/** Mover al inicio: la mitad de la posición del primero. */
export function moveToStart(firstPosition: number): number {
  return Math.floor(firstPosition / 2);
}

/** Mover al final: la del último + paso. */
export function moveToEnd(lastPosition: number): number {
  return lastPosition + GAP;
}

/** Posición de un elemento nuevo: al final (lista vacía → el paso). */
export function appendPosition(items: PositionedItem[]): number {
  const sorted = sortItems(items);
  if (sorted.length === 0) {
    return GAP;
  }
  return moveToEnd(sorted[sorted.length - 1].position);
}

/** ¿Falta espacio para insertar en `targetIndex`? (base.md §8) */
export function needsRebalance(
  items: PositionedItem[],
  movingKey: string,
  targetIndex: number,
): boolean {
  const without = sortItems(items.filter((item) => item.key !== movingKey));
  if (without.length === 0) {
    return false; // lista vacía → el paso siempre cabe
  }
  const index = clamp(targetIndex, 0, without.length);
  if (index === without.length) {
    return false; // al final → +paso siempre cabe
  }
  if (index === 0) {
    const first = without[0];
    return first.position - moveToStart(first.position) < 2;
  }
  const prev = without[index - 1];
  const next = without[index];
  return next.position - prev.position < 2;
}

/** Renumera la lista completa con el paso original, conservando el orden. */
export function rebalance(items: PositionedItem[], gap: number = GAP): PositionChange[] {
  return sortItems(items).map((item, index) => ({
    key: item.key,
    position: (index + 1) * gap,
  }));
}

/**
 * Calcula el resultado de soltar `movingKey` en `targetIndex`
 * (índice que ocupará en la lista SIN el elemento movido, ya ordenada).
 */
export function computeMove(
  items: PositionedItem[],
  movingKey: string,
  targetIndex: number,
): ReorderResult {
  const sorted = sortItems(items);
  if (!sorted.some((item) => item.key === movingKey)) {
    throw new Error(`Elemento no encontrado: ${movingKey}`);
  }
  const without = sorted.filter((item) => item.key !== movingKey);
  const index = clamp(targetIndex, 0, without.length);

  if (needsRebalance(sorted, movingKey, targetIndex)) {
    // Renumerar toda la lista y luego aplicar el movimiento.
    const renumbered = rebalance(without);
    const position = positionFor(renumbered, index);
    return {
      rebalanced: true,
      changes: [...renumbered, { key: movingKey, position }],
    };
  }

  return {
    rebalanced: false,
    changes: [{ key: movingKey, position: positionFor(without, index) }],
  };
}

function positionFor(without: PositionChange[], index: number): number {
  if (without.length === 0) {
    return GAP;
  }
  if (index === 0) {
    return moveToStart(without[0].position);
  }
  if (index === without.length) {
    return moveToEnd(without[without.length - 1].position);
  }
  return moveBetween(without[index - 1].position, without[index].position);
}

function sortItems(items: PositionedItem[]): PositionedItem[] {
  return [...items].sort((a, b) => a.position - b.position);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
