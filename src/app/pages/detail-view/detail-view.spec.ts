import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, beforeEach } from 'vitest';

import type { ResourceSchema } from '../../core/models/schema.model';
import { ApiService } from '../../core/services/api.service';
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
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DetailView);
  });

  it('1. renderiza la cabecera con el título del registro y los badges de headerFields', () => {
    fixture.componentRef.setInput('schema', mockSchema);
    fixture.componentRef.setInput('record', mockRecord);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Ana García');
    // badge de ref y status en la cabecera
    expect(root.textContent).toContain('ORD-42');
    expect(root.textContent).toContain('Pendiente');
  });

  it('2. renderiza las secciones de campos con sus valores', () => {
    fixture.componentRef.setInput('schema', mockSchema);
    fixture.componentRef.setInput('record', mockRecord);
    fixture.detectChanges();

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

  it('5. renderiza secciones de historial (tipo list) cuando existen', () => {
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
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Pedido registrado');
  });
});
