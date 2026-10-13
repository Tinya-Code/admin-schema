import type { ResourceSchema } from '../core/models/schema.model';

export const dashboardSchema: ResourceSchema = {
  id: 'dashboard',
  label: 'Panel',
  labelPlural: 'Dashboard',
  kind: 'dashboard',
  uiViews: {
    overview: { type: 'dashboard' },
  },
  endpoint: {
    get: '/admin/dashboard',
  },
  keyField: 'id',
  titleField: 'label',
  listColumns: [],
  fields: [],
  widgets: [
    {
      type: 'metric-card',
      key: 'pendientes',
      label: 'Pedidos Pendientes',
      hint: 'Por entregar',
      width: 4, // tercio de fila: 3 KPIs en una tira
    },
    {
      type: 'metric-card',
      key: 'entregados',
      label: 'Entregados',
      hint: 'Retirados con éxito',
      width: 4, // tercio de fila: 3 KPIs en una tira
    },
    {
      type: 'metric-card',
      key: 'cancelados',
      label: 'Cancelados',
      hint: 'Anulados',
      width: 4, // tercio de fila: 3 KPIs en una tira
    },
    {
      type: 'record-list',
      key: 'pendientes_recientes',
      label: 'Pedidos que Requieren Atención',
      // Las claves del payload del endpoint /admin/dashboard son los views
      // declarados de orders (handlers/dashboard): `pendientes_recientes`
      // existe con sort created_at desc + limit 5 (R8.3 verificado).
      columns: ['ref', 'customer_name', 'pickup_date', 'auth_state'],
      // Ruta real del router (shell.routes: `/:id/:key` abre el detalle de
      // cualquier colección con `detail.enabled`). Antes apuntaba a
      // `/admin/orders?id=…&view=detail`, que no existe: «Ver Ficha» caía
      // en el catch-all y recargaba el dashboard.
      action: { label: 'Ver Ficha', routeTemplate: '/orders/{ref}' },
      width: 8,
    },
    {
      type: 'status-progress',
      key: 'pipeline_entregas',
      label: 'Pipeline de Cumplimiento',
      // Compuesto: lee pendientes/entregados/cancelados, claves sueltas de
      // la respuesta — no existe una vista `pipeline_entregas`. Verificado
      // contra handlers/dashboard.js: devuelve exactamente esas claves
      // (views `count` de orders sin groupBy → escalares) (R8.3).
      source: { kind: 'payload' },
      segments: [
        { key: 'pendientes', label: 'Pendientes', color: 'warning' },
        { key: 'entregados', label: 'Entregados', color: 'success' },
        { key: 'cancelados', label: 'Cancelados', color: 'neutral' },
      ],
      width: 4,
    },
    {
      type: 'quick-actions',
      key: 'acciones_rapidas',
      label: 'Acciones Frecuentes',
      // Rutas verificadas contra shell.routes.ts: `:id/new` y `:id` (R8.3).
      actions: [
        { label: '+ Nuevo Pedido', navigateTo: '/orders/new', variant: 'primary' },
        { label: 'Ver Todos los Pedidos', navigateTo: '/orders', variant: 'secondary' },
      ],
      width: 12, // banda completa: es la última tira del panel
    },
  ],
};
