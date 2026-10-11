import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import type { ResourceSchema } from '../../core/models/schema.model';
import { ActionService } from '../../actions/action-service';
import { ApiService } from '../../core/services/api.service';
import { API_URL } from '../../core/tokens';
import { DetailView } from './detail-view';

describe('DetailView', () => {
  let fixture: ComponentFixture<DetailView>;

  const mockSchema: ResourceSchema = {
    id: 'orders',
    label: 'Pedido',
    labelPlural: 'Pedidos',
    kind: 'collection',
    endpoint: { list: '/admin/orders', get: '/admin/orders/{key}' },
    keyField: 'ref',
    titleField: 'customer_name',
    listColumns: [],
    fields: [
      { key: 'ref', label: 'Referencia', type: 'text' },
      { key: 'customer_name', label: 'Cliente', type: 'text' },
      { key: 'pickup_date', label: 'Fecha Retiro', type: 'date' },
      {
        key: 'status',
        label: 'Estado',
        type: 'select',
        options: [
          { value: 'PENDIENTE', label: 'Pendiente' },
          { value: 'ENTREGADO', label: 'Entregado' },
        ],
      },
    ],
    detail: {
      enabled: true,
      headerFields: ['ref', 'status'],
      allowEdit: true,
      allowDelete: false,
    },
  };

  const mockRecord = {
    ref: 'ORD-42',
    customer_name: 'Ana García',
    pickup_date: '2026-10-10',
    status: 'PENDIENTE',
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DetailView],
      providers: [
        {
          provide: ApiService,
          useValue: {
            get: () => of(null),
            request: () => of(null),
          },
        },
        // `AuthService` pide `API_URL` (convención de specs, R7.5)
        { provide: API_URL, useValue: '/api' },
        // R8.8: `DetailView` inyecta `Router` (trigger → confirmación +
        // ruta) — convención de list-view.quick-edit.spec.
        provideRouter([]),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DetailView);
  });

  /**
   * Monta la vista y espera los display del registro.
   *
   * `fixture.whenStable()` no basta: el `load()` de cada descriptor es un
   * `import()` ajeno al rastreo de Angular. Se espera acotadamente mientras
   * quede algún `<app-skeleton>`; si un componente nunca monta, la espera se
   * agota y falla la aserción del test (acotación, no espera infinita).
   */
  async function montar(fixture: ComponentFixture<DetailView>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    for (
      let intento = 0;
      intento < 100 && fixture.nativeElement.querySelector('app-skeleton');
      intento++
    ) {
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    fixture.detectChanges();
  }

  it('1. renderiza la cabecera con el título del registro y los badges de headerFields', async () => {
    fixture.componentRef.setInput('schema', mockSchema);
    fixture.componentRef.setInput('record', mockRecord);
    await montar(fixture);

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Ana García');
    // badge de ref y status en la cabecera
    expect(root.textContent).toContain('ORD-42');
    expect(root.textContent).toContain('Pendiente');
    // Los headerFields salen como chips (R4.2): `ref` en neutral y
    // `status` en la clase de estado que ya usaba la ficha.
    const cabeceras = root.querySelectorAll('header app-badge');
    expect(cabeceras.length, 'deben ser 2 los chips de la cabecera').toBe(2);
    expect(cabeceras[0].className).toContain('bg-neutral');
    expect(cabeceras[1].className).toContain('bg-accent/20');
  });

  it('2. renderiza las secciones de campos con sus valores', async () => {
    fixture.componentRef.setInput('schema', mockSchema);
    fixture.componentRef.setInput('record', mockRecord);
    await montar(fixture);

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Ana García');
    expect(root.textContent).toContain('2026');
    // label del campo
    expect(root.textContent).toContain('Referencia');
    expect(root.textContent).toContain('Cliente');
  });

  it('3. emite el evento edit al hacer clic en el botón Editar', () => {
    fixture.componentRef.setInput('schema', mockSchema);
    fixture.componentRef.setInput('record', mockRecord);
    fixture.detectChanges();

    let emitted: Record<string, unknown> | null = null;
    fixture.componentInstance.edit.subscribe((rec) => {
      emitted = rec as Record<string, unknown>;
    });

    const root = fixture.nativeElement as HTMLElement;
    const editBtn = Array.from(root.querySelectorAll<HTMLButtonElement>('button[app-button]')).find(
      (b) => b.textContent?.trim().includes('Editar'),
    );
    expect(editBtn, 'debe existir el botón Editar').toBeDefined();
    editBtn!.click();
    fixture.detectChanges();

    expect(emitted).toEqual(mockRecord);
  });

  it('4. emite el evento back al hacer clic en el botón Volver', () => {
    fixture.componentRef.setInput('schema', mockSchema);
    fixture.componentRef.setInput('record', mockRecord);
    fixture.detectChanges();

    let emitted = false;
    fixture.componentInstance.back.subscribe(() => {
      emitted = true;
    });

    const root = fixture.nativeElement as HTMLElement;
    const backBtn = Array.from(root.querySelectorAll<HTMLButtonElement>('button[app-button]')).find(
      (b) => b.textContent?.trim().includes('Volver'),
    );
    expect(backBtn, 'debe existir el botón Volver').toBeDefined();
    backBtn!.click();
    fixture.detectChanges();

    expect(emitted).toBe(true);
  });

  it('5. renderiza secciones de historial (tipo list) cuando existen', async () => {
    const listSchema: ResourceSchema = {
      ...mockSchema,
      fields: [
        ...mockSchema.fields,
        {
          key: 'history',
          label: 'Historial',
          type: 'list',
          itemFields: [
            { key: 'action', label: 'Acción', type: 'text' },
            { key: 'detail', label: 'Detalle', type: 'text' },
          ],
        },
      ],
    };
    const recordWithHistory = {
      ...mockRecord,
      history: [{ action: 'PEDIDO_CREADO', detail: 'Pedido registrado' }],
    };
    fixture.componentRef.setInput('schema', listSchema);
    fixture.componentRef.setInput('record', recordWithHistory);
    await montar(fixture);

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Pedido registrado');
  });

  it('6. R8.8: renderiza el botón de un trigger y lo dispara vía actionService', async () => {
    const triggerSchema: ResourceSchema = {
      ...mockSchema,
      actions: [
        {
          id: 'regenerate_pin',
          type: 'trigger',
          name: 'regenerate-pin',
          label: 'Regenerar PIN',
        },
      ],
    };
    fixture.componentRef.setInput('schema', triggerSchema);
    fixture.componentRef.setInput('record', mockRecord);
    await montar(fixture);

    const root = fixture.nativeElement as HTMLElement;
    const triggerBtn = Array.from(
      root.querySelectorAll<HTMLButtonElement>('button[app-button]'),
    ).find((b) => b.textContent?.trim() === 'Regenerar PIN');
    expect(triggerBtn, 'debe existir el botón Regenerar PIN').toBeDefined();

    // El clic delega en actionService.run (la confirmación y la ruta son
    // cosa del descriptor, no de la vista — R3.11).
    const runSpy = vi
      .spyOn(TestBed.inject(ActionService), 'run')
      .mockResolvedValue({ ok: true, reload: true });
    triggerBtn!.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(runSpy).toHaveBeenCalledTimes(1);
    const [action, request] = runSpy.mock.calls[0];
    expect(action).toMatchObject({ id: 'regenerate_pin', name: 'regenerate-pin' });
    expect(request.resource).toBe('orders');
    expect(request.keyField).toBe('ref');
  });
});
