import { TestBed } from '@angular/core/testing';
import { toSignal } from '@angular/core/rxjs-interop';
import type { ParamMap } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';

import type {
  ResourceSchema,
  SelectionBinding,
  UiViewDescriptor,
} from '../../core/models/schema.model';
import { createViewContext, instanceIdFor, syntheticRoute, virtualSchemaFor } from './view-context';

const schemaBase: ResourceSchema = {
  id: 'demo',
  label: 'Demo',
  labelPlural: 'Demos',
  kind: 'collection',
  endpoint: {},
  keyField: 'id',
  titleField: 'name',
  listColumns: [],
  fields: [],
  uiViews: {
    rows: { type: 'list' },
  },
};

const nodoHijo: UiViewDescriptor = {
  type: 'kanban',
  path: '',
  config: { groupField: 'x', columns: [{ value: 'a', label: 'A' }] },
};

describe('instanceIdFor', () => {
  it('concatena padre/hijo con separador estable', () => {
    expect(instanceIdFor('panel', 'cal')).toBe('panel/cal');
    expect(instanceIdFor('a/b', 'c')).toBe('a/b/c');
  });
});

describe('virtualSchemaFor', () => {
  it('añade uiViews[instanceId] sin mutar el schema original', () => {
    const clon = virtualSchemaFor(schemaBase, 'panel/cal', nodoHijo);
    expect(clon.uiViews?.['panel/cal']).toBe(nodoHijo);
    expect(schemaBase.uiViews?.['panel/cal']).toBeUndefined();
    expect(Object.keys(schemaBase.uiViews ?? {})).toEqual(['rows']);
  });

  it('conserva las uiViews existentes (lookup estilo hoja sigue funcionando)', () => {
    const clon = virtualSchemaFor(schemaBase, 'panel/cal', nodoHijo);
    expect(clon.uiViews?.['rows']).toBe(schemaBase.uiViews?.['rows']);
    expect(clon.id).toBe('demo');
  });
});

describe('createViewContext / syntheticRoute', () => {
  it('sin emit la clave queda ausente (comportamiento local inerte)', () => {
    const ctx = createViewContext({ resourceId: 'demo', uiView: 'rows', viewType: 'list' });
    expect('emit' in ctx).toBe(false);
  });

  it('con emit la clave existe y es una función', () => {
    const ctx = createViewContext(
      { resourceId: 'demo', uiView: 'rows', viewType: 'list' },
      vi.fn(),
    );
    expect(typeof ctx.emit).toBe('function');
  });

  // R9.9.4: la hoja necesita ver el binding declarado (cualquier mode),
  // no sólo el `emit` — sin `select` en el payload la decision table no
  // puede distinguir «sin declaración» de `none`/`inline`.
  it('con select declarado la clave viaja en el payload', () => {
    const binding: SelectionBinding = { on: 'open', mode: 'inline' };
    const ctx = createViewContext({
      resourceId: 'demo',
      uiView: 'rows',
      viewType: 'list',
      select: binding,
    });
    expect(ctx.select).toEqual(binding);
  });

  it('sin select declarado la clave queda ausente (comportamiento local inerte)', () => {
    const ctx = createViewContext({ resourceId: 'demo', uiView: 'rows', viewType: 'list' });
    expect('select' in ctx).toBe(false);
  });
});

describe('syntheticRoute', () => {
  it('emite síncrono: toSignal(..., requireSync) de la hoja lee el payload sin input bindings', () => {
    const ctx = createViewContext(
      { resourceId: 'demo', uiView: 'panel/cal', viewType: 'kanban' },
      vi.fn(),
    );
    const r = syntheticRoute(ctx);
    const data = TestBed.runInInjectionContext(() => toSignal(r.data, { requireSync: true }));
    expect(data()).toEqual(ctx);
    expect(typeof data()['emit']).toBe('function');
  });
});

// ── R9.9.3 · ruta sintética completa (hojas tipo ResourcePage) ──

describe('syntheticRoute', () => {
  it('incluye paramMap síncrono además de data (ResourcePage lee ambos)', () => {
    const ruta = syntheticRoute({ resourceId: 'orders', uiView: 'x', viewType: 'list' });
    let params: ParamMap | null = null;
    ruta.paramMap.subscribe((p) => (params = p));
    expect(params).not.toBeNull();
    expect(params!.get('key')).toBeNull();

    let data: unknown = null;
    ruta.data.subscribe((d) => (data = d));
    expect(data).toMatchObject({ resourceId: 'orders', viewType: 'list' });
  });
});
