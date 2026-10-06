import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import type { PostCreateSchema, ResourceSchema } from '../../../core/models/schema.model';
import { PostCreateModal } from './post-create-modal';

describe('PostCreateModal', () => {
  let fixture: ComponentFixture<PostCreateModal>;

  const mockSchema: ResourceSchema = {
    id: 'orders',
    label: 'Pedido',
    labelPlural: 'Pedidos',
    kind: 'collection',
    endpoint: { list: '/admin/orders' },
    keyField: 'ref',
    titleField: 'customer_name',
    listColumns: [],
    fields: [
      { key: 'ref', type: 'text', label: 'Referencia' },
      { key: 'customer_name', type: 'text', label: 'Cliente' },
      { key: 'pickup_date', type: 'date', label: 'Fecha de Retiro' },
    ],
  };

  const mockConfig: PostCreateSchema = {
    mode: 'modal',
    title: '¡Pedido {ref} Creado!',
    description: 'El pedido de {customer_name} ya está listo para compartir.',
    summaryFields: ['ref', 'customer_name', 'pickup_date'],
    actions: [
      {
        id: 'share',
        type: 'copy-share',
        label: 'Copiar Enlace de Retiro',
        urlTemplate: '{public_base_url}/p/{ref}',
        shareTextTemplate: 'Hola {customer_name}, tu pedido {ref} está listo.',
      },
    ],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PostCreateModal],
    }).compileComponents();
    fixture = TestBed.createComponent(PostCreateModal);
  });

  it('1. interpola título y descripción con los datos del registro', () => {
    fixture.componentRef.setInput('schema', mockSchema);
    fixture.componentRef.setInput('config', mockConfig);
    fixture.componentRef.setInput('record', {
      ref: 'ORD-555',
      customer_name: 'Esteban Quito',
      pickup_date: '2026-10-10',
    });
    fixture.componentRef.setInput('configValues', {
      public_base_url: 'https://pickpass.app',
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('¡Pedido ORD-555 Creado!');
    expect(root.textContent).toContain('El pedido de Esteban Quito ya está listo para compartir.');
  });

  it('2. renderiza los campos de resumen especificados en summaryFields', () => {
    fixture.componentRef.setInput('schema', mockSchema);
    fixture.componentRef.setInput('config', mockConfig);
    fixture.componentRef.setInput('record', {
      ref: 'ORD-555',
      customer_name: 'Esteban Quito',
      pickup_date: '2026-10-10',
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Referencia');
    expect(root.textContent).toContain('ORD-555');
    expect(root.textContent).toContain('Cliente');
    expect(root.textContent).toContain('Esteban Quito');
    expect(root.textContent).toContain('Fecha de Retiro');
    expect(root.textContent).toContain('2026-10-10');
  });

  it('3. renderiza el componente CopyShare cuando hay una acción copy-share', () => {
    fixture.componentRef.setInput('schema', mockSchema);
    fixture.componentRef.setInput('config', mockConfig);
    fixture.componentRef.setInput('record', {
      ref: 'ORD-888',
      customer_name: 'Lucia',
    });
    fixture.componentRef.setInput('configValues', {
      public_base_url: 'https://retiro.com',
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('app-copy-share')).not.toBeNull();
    expect(root.textContent).toContain('Copiar Enlace de Retiro');
  });

  it('4. emite evento closed al hacer clic en el botón Continuar', () => {
    let closedEmitted = false;
    fixture.componentInstance.closed.subscribe(() => {
      closedEmitted = true;
    });

    fixture.componentRef.setInput('schema', mockSchema);
    fixture.componentRef.setInput('config', mockConfig);
    fixture.componentRef.setInput('record', { ref: 'ORD-1' });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const btns = Array.from(root.querySelectorAll<HTMLButtonElement>('button[app-button]'));
    const btn = btns.find((b) => b.textContent?.trim() === 'Continuar');
    btn?.click();
    fixture.detectChanges();

    expect(closedEmitted).toBe(true);
  });
});
