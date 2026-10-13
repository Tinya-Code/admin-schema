import type { RenderDescriptor } from '../core/registry/render-registry';

export const viewDescriptors: readonly RenderDescriptor[] = [
  {
    kind: 'view',
    type: 'list',
    since: '9.1',
    load: async () => (await import('../pages/resource-page/resource-page')).ResourcePage,
  },
  {
    kind: 'view',
    type: 'detail',
    since: '9.1',
    load: async () => (await import('../pages/resource-page/resource-page')).ResourcePage,
  },
  {
    kind: 'view',
    type: 'form',
    since: '9.1',
    load: async () => (await import('../pages/form-view/form-view')).FormView,
  },
  {
    kind: 'view',
    type: 'dashboard',
    since: '9.1',
    load: async () => (await import('../pages/resource-page/resource-page')).ResourcePage,
  },
  {
    kind: 'view',
    type: 'calendar',
    since: '9.8',
    load: async () => (await import('./calendar-view/calendar-view')).CalendarView,
  },
  {
    kind: 'view',
    type: 'kanban',
    since: '9.8',
    load: async () => (await import('./kanban-view/kanban-view')).KanbanView,
  },
  {
    kind: 'view',
    type: 'tabs',
    since: '9.9',
    load: async () => (await import('./composer/composer-host')).ComposerHost,
  },
];
