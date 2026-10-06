import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';

import type { QuickActionsWidget } from '../../core/models/schema.model';
import { QuickActions } from './quick-actions';

describe('QuickActions', () => {
  let fixture: ComponentFixture<QuickActions>;

  const widget: QuickActionsWidget = {
    type: 'quick-actions',
    key: 'acciones_rapidas',
    label: 'Accesos Directos',
    actions: [
      { label: 'Nuevo Pedido', icon: 'plus', navigateTo: '/admin/orders?action=create' },
      { label: 'Configuración', icon: 'settings', navigateTo: '/admin/pickpass' },
      { label: 'Guía Externa', icon: 'external', navigateTo: 'https://ejemplo.com/guia' },
    ],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuickActions],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(QuickActions);
  });

  it('1. renderiza todas las acciones declaradas con sus textos', () => {
    fixture.componentRef.setInput('widget', widget);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Accesos Directos');
    expect(root.textContent).toContain('Nuevo Pedido');
    expect(root.textContent).toContain('Configuración');
    expect(root.textContent).toContain('Guía Externa');
  });

  it('2. genera enlaces internos con routerLink', () => {
    fixture.componentRef.setInput('widget', widget);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const links = root.querySelectorAll('a');
    expect(links.length).toBe(3);
    expect(links[0].getAttribute('href')).toBe('/admin/orders?action=create');
    expect(links[1].getAttribute('href')).toBe('/admin/pickpass');
  });

  it('3. genera enlaces externos con target blank y rel noopener', () => {
    fixture.componentRef.setInput('widget', widget);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const links = root.querySelectorAll('a');
    expect(links[2].getAttribute('href')).toBe('https://ejemplo.com/guia');
    expect(links[2].getAttribute('target')).toBe('_blank');
  });
});
