import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';

import type { ResourceSchema, ViewChildNode } from '../../core/models/schema.model';
import { register, unregister } from '../../core/registry/render-registry';
import { ViewSlot } from './view-slot';

/** Hoja de prueba registrada dinámicamente: lee su canal como una hoja real. */
@Component({
  standalone: true,
  selector: 'app-hoja-prueba',
  template: `<p data-hoja>{{ uiView }}</p>`,
})
class HojaPrueba {
  readonly uiView: unknown;
  constructor(route: ActivatedRoute) {
    let valor: Record<string, unknown> = {};
    route.data.subscribe((d) => (valor = d as Record<string, unknown>));
    this.uiView = valor['uiView'];
  }
}

const schema: ResourceSchema = {
  id: 'demo',
  label: 'Demo',
  labelPlural: 'Demos',
  kind: 'collection',
  endpoint: {},
  keyField: 'id',
  titleField: 'name',
  listColumns: [],
  fields: [],
  uiViews: { rows: { type: 'list' } },
};

describe('ViewSlot', () => {
  afterEach(() => unregister('view', 'hoja-test'));

  async function montar(node: ViewChildNode, profundidad = 0) {
    const fixture = TestBed.createComponent(ViewSlot);
    fixture.componentRef.setInput('schema', schema);
    fixture.componentRef.setInput('node', node);
    fixture.componentRef.setInput('parentInstanceId', 'panel');
    fixture.componentRef.setInput('depth', profundidad);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('monta el hijo por descriptor del registro (load lazy) sin importar hojas', async () => {
    register('view', {
      kind: 'view',
      type: 'hoja-test',
      since: '9.9',
      load: async () => HojaPrueba,
    });
    const fixture = await montar({ id: 'a', label: 'A', type: 'hoja-test' });
    expect(fixture.nativeElement.querySelector('[data-hoja]')).toBeTruthy();
    // uiView del payload = instanceId virtual (parentId + '/' + id)
    expect(fixture.nativeElement.textContent).toContain('panel/a');
  });

  it('tipo sin descriptor ⇒ estado de error legible, sin fallback del registro', async () => {
    const fixture = await montar({ id: 'x', label: 'X', type: 'no-existe' });
    expect(fixture.nativeElement.textContent).toContain('descriptor');
    expect(fixture.nativeElement.querySelector('[data-hoja]')).toBeFalsy();
  });

  it('load() rechaza ⇒ error explícito con el rechazo retenido para diagnóstico', async () => {
    const rechazo = new Error('fallo de red');
    register('view', {
      kind: 'view',
      type: 'hoja-test',
      since: '9.9',
      load: async () => {
        throw rechazo;
      },
    });
    const fixture = await montar({ id: 'a', label: 'A', type: 'hoja-test' });
    expect(fixture.nativeElement.textContent).toContain('fallo de red');
    expect(fixture.componentInstance.error()).toBe(rechazo);
  });

  it('ref resuelve la uiView del schema y el payload expone su config bajo instanceId', async () => {
    register('view', {
      kind: 'view',
      type: 'hoja-test',
      since: '9.9',
      load: async () => HojaPrueba,
    });
    const schemaConRef: ResourceSchema = {
      ...schema,
      uiViews: { ...schema.uiViews, destino: { type: 'hoja-test' } },
    };
    const fixture = TestBed.createComponent(ViewSlot);
    fixture.componentRef.setInput('schema', schemaConRef);
    fixture.componentRef.setInput('node', { id: 'h', label: 'H', ref: 'destino' });
    fixture.componentRef.setInput('parentInstanceId', 'panel');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('panel/h');
    expect(fixture.componentInstance.payload()?.['schema']).toBeDefined();
  });

  it('el payload lleva `select` declarado para que la hoja conozca el binding', async () => {
    register('view', {
      kind: 'view',
      type: 'hoja-test',
      since: '9.9',
      load: async () => HojaPrueba,
    });
    const fixture = await montar({
      id: 'a',
      label: 'A',
      type: 'hoja-test',
      select: { on: 'open', mode: 'none' },
    });
    expect(fixture.componentInstance.payload()?.['select']).toEqual({ on: 'open', mode: 'none' });
  });

  it('profundidad sobre el límite ⇒ error antes de montar (guard del host)', async () => {
    const fixture = await montar({ id: 'a', label: 'A', type: 'list' }, 4);
    expect(fixture.nativeElement.textContent).toContain('profundidad');
    expect(fixture.nativeElement.querySelector('[data-hoja]')).toBeFalsy();
  });
});
