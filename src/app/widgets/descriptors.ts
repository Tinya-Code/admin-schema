import type { RenderDescriptor } from '../core/registry/render-registry';

import { descriptor as barChartDescriptor } from './bar-chart/bar-chart.descriptor';
import { descriptor as chartLineDescriptor } from './chart-line/chart-line.descriptor';
import { descriptor as metricCardDescriptor } from './metric-card/metric-card.descriptor';
import { descriptor as quickActionsDescriptor } from './quick-actions/quick-actions.descriptor';
import { descriptor as recordListDescriptor } from './record-list/record-list.descriptor';
import { descriptor as statusProgressDescriptor } from './status-progress/status-progress.descriptor';

/**
 * Manifiesto de descriptores de widget (R3.6 · registro único de render).
 *
 * Mismo criterio que `fields/descriptors.ts`: una línea por tipo y el
 * registro los recoge al importar este módulo. Es la **única** lista manual
 * del catálogo de widgets — `import.meta.glob` no sobrevive a `ng build`
 * (D9-1), así que se mantiene el «registro manual de una línea».
 *
 * Añadir un widget ⇒ crear la carpeta + su `.descriptor.ts` + una línea
 * acá. **Ningún host se toca** (R3.8): si el componente sigue la forma
 * estándar `{widget, data}` ni siquiera hay que escribir `inputs`.
 */
export const widgetDescriptors: readonly RenderDescriptor[] = [
  barChartDescriptor,
  chartLineDescriptor,
  metricCardDescriptor,
  quickActionsDescriptor,
  recordListDescriptor,
  statusProgressDescriptor,
];
