import type { ResourceSchema } from '../core/models/schema.model';

export const dashboardSchema: ResourceSchema = {
  id: 'dashboard',
  label: 'Panel',
  labelPlural: 'Dashboard',
  kind: 'dashboard',
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
      width: 4,
    },
    {
      type: 'metric-card',
      key: 'entregados',
      label: 'Entregados',
      hint: 'Retirados con éxito',
      width: 4,
    },
    {
      type: 'metric-card',
      key: 'cancelados',
      label: 'Cancelados',
      hint: 'Anulados',
      width: 4,
    },
    {
      type: 'record-list',
      key: 'pendientes_recientes',
      label: 'Pedidos que Requieren Atención',
      resource: 'orders',
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
      // la respuesta — no existe una vista `pipeline_entregas`.
      source: 'payload',
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
      actions: [
        { label: '+ Nuevo Pedido', navigateTo: '/orders/new', variant: 'primary' },
        { label: 'Ver Todos los Pedidos', navigateTo: '/orders', variant: 'secondary' },
      ],
      width: 12,
    },
  ],
};
