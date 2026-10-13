import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { afterEach, describe, expect, it } from 'vitest';
import { of } from 'rxjs';

import type { ResourceSchema, UiViewDescriptor, UiViewTabs } from '../../core/models/schema.model';
import { register, unregister } from '../../core/registry/render-registry';
import { ComposerHost } from './composer-host';

/** Hoja ligera para los tests (se registra y se desregistra por test). */
@Component({
  standalone: true,
  selector: 'app-hoja-h',
  template: `<p data-hoja>{{ etiqueta }}</p>`,
})
class HojaH {
  readonly etiqueta: string;
  constructor(route: ActivatedRoute) {
    let v: Record<string, unknown> = {};
    route.data.subscribe((d) => (v = d as Record<string, unknown>));
    this.etiqueta = String(v['uiView'] ?? '');
  }
}

function tabs(children: UiViewTabs['config']['children'], initial?: string): UiViewTabs {
  return { type: 'tabs', config: { children, ...(initial ? { initial } : {}) } };
}

function base(): ResourceSchema {
  return {
    id: 'demo',
    label: 'Demo',
    labelPlural: 'Demos',
    kind: 'collection',
    endpoint: {},
    keyField: 'id',
    titleField: 'name',
    listColumns: [],
    fields: [],
    uiViews: {},
  };
}

function esquemaCon(vista: UiViewDescriptor): ResourceSchema {
  return { ...base(), uiViews: { panel: vista } };
}

type Fixture = ReturnType<TestBed['createComponent']>;

/**
 * Dos ciclos estables: el primero resuelve el `load()` del slot activo, el
 * segundo monta su componente; el tercero cubre un nivel de anidación.
 */
async function flush(fixture: Fixture, cond?: () => boolean): Promise<Fixture> {
  const ciclosMax = cond === undefined ? 4 : 30;
  for (let ciclo = 0; ciclo < ciclosMax; ciclo += 1) {
    if (cond?.()) break;
    // Ceder la macrotarea: el `import()` dinámico de un descriptor no es
    // microtask puro y `whenStable` en TestBed no lo espera. Con `cond`
    // además se espera hasta que el DOM realmente avance (la suite completa
    // satura el worker y el import tarda más ciclos).
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
  }
  return fixture;
}

async function montar(schema: ResourceSchema, uiView = 'panel'): Promise<Fixture> {
  const datos = { schema, resourceId: schema.id, uiView, viewType: 'tabs' };
  TestBed.configureTestingModule({
    providers: [{ provide: ActivatedRoute, useValue: { data: of(datos) } }],
  });
  const fixture = TestBed.createComponent(ComposerHost);
  fixture.detectChanges();
  await flush(fixture);
  return fixture;
}

describe('ComposerHost', () => {
  afterEach(() => unregister('view', 'hoja-h'));

  it('renderiza los hijos en orden declarado con tablist accesible', async () => {
    register('view', { kind: 'view', type: 'hoja-h', since: '9.9', load: async () => HojaH });
    const fixture = await montar(
      esquemaCon(
        tabs([
          { id: 'a', label: 'Uno', type: 'hoja-h' },
          { id: 'b', label: 'Dos', type: 'hoja-h' },
          { id: 'c', label: 'Tres', type: 'hoja-h' },
        ]),
      ),
    );
    const tabsDom = [...fixture.nativeElement.querySelectorAll('[role="tab"]')];
    expect(tabsDom.map((t) => t.textContent?.trim())).toEqual(['Uno', 'Dos', 'Tres']);
    expect(fixture.nativeElement.querySelector('[role="tablist"]')).toBeTruthy();
    // el primer hijo está activo por defecto: sólo su panel está montado
    expect(fixture.nativeElement.querySelectorAll('[role="tabpanel"]').length).toBe(1);
    expect(tabsDom[0].getAttribute('aria-selected')).toBe('true');
    expect(tabsDom[0].getAttribute('tabindex')).toBe('0');
    expect(tabsDom[1].getAttribute('tabindex')).toBe('-1');
  });

  it('respeta `initial` para la pestaña activa al montar', async () => {
    register('view', { kind: 'view', type: 'hoja-h', since: '9.9', load: async () => HojaH });
    const fixture = await montar(
      esquemaCon(
        tabs(
          [
            { id: 'a', label: 'Uno', type: 'hoja-h' },
            { id: 'b', label: 'Dos', type: 'hoja-h' },
          ],
          'b',
        ),
      ),
    );
    const selected = [...fixture.nativeElement.querySelectorAll('[role="tab"]')].filter(
      (t) => t.getAttribute('aria-selected') === 'true',
    );
    expect(selected.map((t) => t.textContent?.trim())).toEqual(['Dos']);
    expect(fixture.nativeElement.querySelector('[role="tabpanel"]')?.textContent).toContain(
      'panel/b',
    );
  });

  it('clic en pestaña activa el panel y destruye el no retenido', async () => {
    register('view', { kind: 'view', type: 'hoja-h', since: '9.9', load: async () => HojaH });
    const fixture = await montar(
      esquemaCon(
        tabs([
          { id: 'a', label: 'Uno', type: 'hoja-h' },
          { id: 'b', label: 'Dos', type: 'hoja-h' },
        ]),
      ),
    );
    const panels = () => fixture.nativeElement.querySelectorAll('[role="tabpanel"]');
    expect(panels().length).toBe(1);
    expect(panels()[0].textContent).toContain('panel/a');
    [...fixture.nativeElement.querySelectorAll('[role="tab"]')][1].click();
    await flush(fixture);
    expect(panels().length).toBe(1);
    expect(panels()[0].textContent).toContain('panel/b');
    // no retenido: el panel de 'a' ya no existe en el DOM
    expect(panels()[0].textContent).not.toContain('panel/a');
  });

  it('retain:true conserva el panel montado pero oculto tras cambiar de pestaña', async () => {
    register('view', { kind: 'view', type: 'hoja-h', since: '9.9', load: async () => HojaH });
    const fixture = await montar(
      esquemaCon(
        tabs([
          { id: 'a', label: 'Uno', type: 'hoja-h', retain: true },
          { id: 'b', label: 'Dos', type: 'hoja-h' },
        ]),
      ),
    );
    [...fixture.nativeElement.querySelectorAll('[role="tab"]')][1].click();
    await flush(fixture);
    const panels = [...fixture.nativeElement.querySelectorAll('[role="tabpanel"]')];
    expect(panels.length).toBe(2);
    const oculto = panels.find((p) => p.textContent?.includes('panel/a'));
    expect(oculto).toBeTruthy();
    expect(oculto!.classList.contains('hidden')).toBe(true);
    const visible = panels.find((p) => p.textContent?.includes('panel/b'));
    expect(visible!.classList.contains('hidden')).toBe(false);
  });

  it('flechas/Home/End mueven la selección y el tabindex (roving)', async () => {
    register('view', { kind: 'view', type: 'hoja-h', since: '9.9', load: async () => HojaH });
    const fixture = await montar(
      esquemaCon(
        tabs([
          { id: 'a', label: 'Uno', type: 'hoja-h' },
          { id: 'b', label: 'Dos', type: 'hoja-h' },
          { id: 'c', label: 'Tres', type: 'hoja-h' },
        ]),
      ),
    );
    const tablist = fixture.nativeElement.querySelector('[role="tablist"]');
    const tabsDom = [...tablist.querySelectorAll('[role="tab"]')];
    const tecla = (key: string) => {
      tablist.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      fixture.detectChanges();
    };
    tecla('ArrowRight');
    expect(tabsDom[1].getAttribute('aria-selected')).toBe('true');
    expect(tabsDom[1].getAttribute('tabindex')).toBe('0');
    expect(tabsDom[0].getAttribute('tabindex')).toBe('-1');
    tecla('End');
    expect(tabsDom[2].getAttribute('aria-selected')).toBe('true');
    tecla('Home');
    expect(tabsDom[0].getAttribute('aria-selected')).toBe('true');
    tecla('ArrowLeft'); // desde el primero ⇒ envuelve al último
    expect(tabsDom[2].getAttribute('aria-selected')).toBe('true');
  });

  it('config inválida (no-tabs) ⇒ estado de error, sin montar hijos', async () => {
    const fixture = await montar(esquemaCon({ type: 'list' }));
    expect(fixture.nativeElement.textContent).toContain('inválida');
    expect(fixture.nativeElement.querySelector('[role="tablist"]')).toBeFalsy();
  });

  it('ciclo de composición ⇒ error validado antes del render (D2)', async () => {
    const conRef: UiViewTabs = {
      type: 'tabs',
      config: { children: [{ id: 'loop', label: 'Loop', ref: 'panel' }] },
    };
    const fixture = await montar(esquemaCon(conRef));
    expect(fixture.nativeElement.textContent).toContain('ciclo');
    expect(fixture.nativeElement.querySelector('[role="tablist"]')).toBeFalsy();
  });

  it('profundidad sobre el límite ⇒ error validado antes del render (D2)', async () => {
    register('view', { kind: 'view', type: 'hoja-h', since: '9.9', load: async () => HojaH });
    const schema: ResourceSchema = {
      ...base(),
      uiViews: {
        a: tabs([{ id: 'n1', label: 'N1', ref: 'b' }]),
        b: tabs([{ id: 'n2', label: 'N2', ref: 'c' }]),
        c: tabs([{ id: 'n3', label: 'N3', ref: 'd' }]),
        d: tabs([{ id: 'n4', label: 'N4', type: 'hoja-h' }]),
      },
    };
    const fixture = await montar(schema, 'a');
    expect(fixture.nativeElement.textContent).toContain('profundidad');
    expect(fixture.nativeElement.querySelector('[role="tablist"]')).toBeFalsy();
  });

  it('visibleWhen sin record evalúa contra vacío: empty pasa, eq no', async () => {
    register('view', { kind: 'view', type: 'hoja-h', since: '9.9', load: async () => HojaH });
    const fixture = await montar(
      esquemaCon(
        tabs([
          { id: 'a', label: 'Siempre', type: 'hoja-h' },
          {
            id: 'b',
            label: 'Condicional',
            type: 'hoja-h',
            visibleWhen: [{ field: 'estado', operator: 'eq', value: 'activo' }],
          },
          {
            id: 'c',
            label: 'Sin filtro',
            type: 'hoja-h',
            visibleWhen: [{ field: 'estado', operator: 'empty' }],
          },
        ]),
      ),
    );
    const labels = [...fixture.nativeElement.querySelectorAll('[role="tab"]')].map((t) =>
      t.textContent?.trim(),
    );
    expect(labels).toEqual(['Siempre', 'Sin filtro']);
  });

  it('si la pestaña activa queda oculta, cae visiblemente a la primera visible', async () => {
    register('view', { kind: 'view', type: 'hoja-h', since: '9.9', load: async () => HojaH });
    const fixture = await montar(
      esquemaCon(
        tabs([
          {
            id: 'oculta',
            label: 'Oculta',
            type: 'hoja-h',
            visibleWhen: [{ field: 'estado', operator: 'eq', value: 'activo' }],
          },
          { id: 'visible', label: 'Visible', type: 'hoja-h' },
        ]),
      ),
    );
    const tabsDom = [...fixture.nativeElement.querySelectorAll('[role="tab"]')];
    expect(tabsDom.map((t) => t.textContent?.trim())).toEqual(['Visible']);
    expect(tabsDom[0].getAttribute('aria-selected')).toBe('true');
    expect(fixture.nativeElement.querySelector('[role="tabpanel"]')?.textContent).toContain(
      'panel/visible',
    );
  });

  it('anida tabs inline: el hijo contenedor monta sus propios hijos', async () => {
    register('view', { kind: 'view', type: 'hoja-h', since: '9.9', load: async () => HojaH });
    const anidado: UiViewTabs = tabs([
      {
        id: 'hijo',
        label: 'Hijo',
        type: 'tabs',
        config: { children: [{ id: 'nieto', label: 'Nieto', type: 'hoja-h' }] },
      },
    ]);
    const fixture = await montar(esquemaCon(anidado));
    await flush(fixture, () => fixture.nativeElement.querySelectorAll('[role="tab"]').length >= 2);
    const labels = [...fixture.nativeElement.querySelectorAll('[role="tab"]')].map((t) =>
      t.textContent?.trim(),
    );
    expect(labels).toEqual(['Hijo', 'Nieto']);
    // el nieto vive bajo instanceId de cadena: panel/hijo (parentInstanceId)
    expect(fixture.nativeElement.querySelector('[role="tabpanel"]')?.textContent).toContain(
      'panel/hijo',
    );
  });
});
