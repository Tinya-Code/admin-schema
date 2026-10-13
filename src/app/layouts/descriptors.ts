import type { LayoutDescriptor } from '../core/registry/render-registry';

export const layoutDescriptors: readonly LayoutDescriptor[] = [
  { kind: 'layout', type: 'grid', since: '9.2' },
  { kind: 'layout', type: 'tabs', since: '9.2' },
  { kind: 'layout', type: 'sections', since: '9.2' },
  { kind: 'layout', type: 'steps', since: '9.2' },
  { kind: 'layout', type: 'columns', since: '9.2' },
];
