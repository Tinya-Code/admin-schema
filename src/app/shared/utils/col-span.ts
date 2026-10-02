/**
 * Anchos de columna del layout (base.md §4: `width` 1–12).
 *
 * `sm:col-span-*` como literales: Tailwind v4 solo genera las clases que ve
 * en el código, así que no pueden construirse por concatenación.
 */
const COL_SPANS: Record<number, string> = {
  1: 'sm:col-span-1',
  2: 'sm:col-span-2',
  3: 'sm:col-span-3',
  4: 'sm:col-span-4',
  5: 'sm:col-span-5',
  6: 'sm:col-span-6',
  7: 'sm:col-span-7',
  8: 'sm:col-span-8',
  9: 'sm:col-span-9',
  10: 'sm:col-span-10',
  11: 'sm:col-span-11',
  12: 'sm:col-span-12',
};

/** Clase `sm:col-span-*` para el ancho del campo (por defecto: 12). */
export function colSpanClass(width: number | undefined): string {
  return COL_SPANS[width ?? 12];
}
